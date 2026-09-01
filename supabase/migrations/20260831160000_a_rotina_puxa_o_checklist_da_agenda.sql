-- A rotina puxa o checklist da agenda.
--
-- O PROBLEMA. A rotina de pagamentos volta nos dias 5, 10, 15, 20, 25 e 30 — mas
-- o QUE se paga muda todo dia. Clonar o checklist da ocorrência anterior, que é
-- o que o gerador fazia, entrega no dia 20 a lista do dia 15. A informação certa
-- já existe e não está no Hub: está no Google Calendar, onde ~60 eventos
-- recorrentes de dia inteiro descrevem cada pagamento, quatro pessoas escrevem e
-- o formulário de notas externas deposita "Valor NF / Link NF PDF".
--
-- O DESENHO. `agenda_eventos` é o espelho de uma janela da agenda, mantido pela
-- Edge Function `agenda-sync`. O gerador (SQL puro, pg_cron — não fala com o
-- Google) monta o checklist da ocorrência do dia D a partir desse espelho: uma
-- subtarefa por pagamento daquele dia, com o valor no rótulo.
--
-- A DIREÇÃO É UMA SÓ, de propósito: o calendário escreve, o Hub lê. O caminho
-- inverso (o Hub criando evento) faria duas fontes de verdade sem dono — o
-- evento criado pelo Hub voltaria pelo sync e viraria subtarefa, gerando
-- duplicata. Se um dia o Hub precisar criar evento (compra aprovada no
-- Facilities, rescisão), que seja com marcação própria e ficando FORA da leitura.

-- ========================================================= espelho da agenda ==
create table if not exists public.agenda_eventos (
  id           uuid primary key default gen_random_uuid(),
  -- id da INSTÂNCIA (a recorrência expandida vem como "..._20260820"), não da
  -- série: é a instância que tem data, e é a data que interessa aqui.
  event_id     text not null,
  dia          date not null,
  dia_inteiro  boolean not null default true,
  titulo       text not null,
  descricao    text,
  cor          text,
  link         text,
  valor        numeric,
  -- Evento de dia inteiro que não é reunião/fechamento/conferência. O filtro
  -- mora em supabase/functions/_shared/agenda.ts e espelha o de
  -- src/lib/pagamentos.ts — as duas leituras da agenda (card do briefing e
  -- checklist da rotina) têm de concordar sobre o que é pagamento.
  eh_pagamento boolean not null default false,
  -- O que vira a subtarefa: título + valor quando o título ainda não o traz.
  -- Formatado em TypeScript de propósito: `to_char` depende do lc_numeric do
  -- servidor e devolveria "1,444.00" onde se lê "1.444,00".
  rotulo       text not null,
  atualizado_em timestamptz not null default now(),
  unique (event_id, dia)
);

create index if not exists idx_agenda_eventos_dia
  on public.agenda_eventos(dia) where eh_pagamento;

comment on table public.agenda_eventos is
  'Espelho de uma janela do Google Calendar de financeiro@takeat.app, mantido pela Edge Function agenda-sync. Fonte do checklist das rotinas com subtarefas da agenda.';

alter table public.agenda_eventos enable row level security;

drop policy if exists "agenda_eventos_read" on public.agenda_eventos;
create policy "agenda_eventos_read" on public.agenda_eventos
  for select to authenticated using (true);
-- Sem policy de escrita: quem escreve é a `agenda-sync`, com a service role.

revoke all on public.agenda_eventos from anon;

-- ================================================= a rotina escolhe a fonte ==
alter table public.tarefas
  add column if not exists rotina_subtarefas_fonte text;

alter table public.tarefas
  drop constraint if exists tarefas_rotina_subtarefas_fonte_ck;
alter table public.tarefas
  add constraint tarefas_rotina_subtarefas_fonte_ck
  check (rotina_subtarefas_fonte is null or rotina_subtarefas_fonte in ('agenda'));

comment on column public.tarefas.rotina_subtarefas_fonte is
  'De onde vem o checklist da próxima ocorrência. NULL = clona o da ocorrência anterior (padrão). ''agenda'' = uma subtarefa por pagamento do dia, lido de agenda_eventos.';

-- ======================================= o checklist do dia, vindo da agenda ==
-- Separado em função própria para a tela poder mostrar a MESMA prévia que o
-- gerador vai produzir ("no dia 20 seriam 9 pagamentos"), sem duplicar a regra.
create or replace function public.agenda_checklist_do_dia(p_dia date, p_responsavel text default null)
returns jsonb
language sql
-- VOLATILE, e nao stable: ela chama gen_random_uuid() para dar id a cada
-- subtarefa. Declarar stable autorizaria o planejador a avaliar a funcao uma vez
-- so por consulta — e duas ocorrencias geradas na mesma rodada sairiam com os
-- MESMOS ids de subtarefa, que e o defeito que o arrasto da tela expoe.
volatile
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',          gen_random_uuid()::text,
        'titulo',      e.rotulo,
        'responsavel', p_responsavel,
        'done',        false
      )
      -- Ordena por valor decrescente: numa lista de conferência, o pagamento de
      -- R$ 7.142 importa mais do que o de R$ 90, e é ele que tem de estar no
      -- alto quando alguém confere com pressa. Sem valor vai para o fim.
      order by e.valor desc nulls last, e.titulo
    ), '[]'::jsonb)
  from public.agenda_eventos e
  where e.dia = p_dia
    and e.eh_pagamento;
$$;

comment on function public.agenda_checklist_do_dia(date, text) is
  'O checklist de pagamentos de um dia, no formato de tarefas.subtarefas. Usado pelo gerador de rotinas e pela prévia da tela.';

grant execute on function public.agenda_checklist_do_dia(date, text) to authenticated;
revoke all on function public.agenda_checklist_do_dia(date, text) from anon;

-- ============================================== o gerador aprende a escolher ==
create or replace function public.tarefas_rotinas_gerar(p_hoje date default current_date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criadas int := 0;
  r         record;
  d         date;
  v_subs    jsonb;
  v_id      uuid;
begin
  for r in
    select distinct on (t.rotina_serie_id) t.*
      from public.tarefas t
     where t.rotina_serie_id is not null
       and t.rotina_cadencia is not null
       and t.rotina_ativa
     order by t.rotina_serie_id, t.created_at desc
  loop
    for d in
      select * from public.rotina_datas(r.rotina_cadencia, p_hoje, p_hoje + r.rotina_antecedencia_dias)
    loop
      continue when exists (
        select 1 from public.tarefas x
         where x.rotina_serie_id = r.rotina_serie_id
           and x.prazo = d
      );

      if r.rotina_subtarefas_fonte = 'agenda' then
        -- Uma subtarefa por pagamento do dia. Pode vir vazio (agenda ainda não
        -- sincronizada, ou dia sem pagamento) e a ocorrência nasce assim mesmo:
        -- a rotina daquele dia existe, e um checklist vazio é um sinal honesto
        -- de que não há nada marcado — bem diferente de não criar a tarefa.
        v_subs := public.agenda_checklist_do_dia(d, r.responsavel);
      else
        -- O checklist volta zerado e com ids novos: reaproveitar o id da
        -- subtarefa faria duas ocorrências compartilharem a mesma linha no
        -- arrasto da tela.
        select coalesce(jsonb_agg(
                 jsonb_set(jsonb_set(s, '{done}', 'false'::jsonb),
                           '{id}', to_jsonb(gen_random_uuid()::text))
               ), '[]'::jsonb)
          into v_subs
          from jsonb_array_elements(coalesce(r.subtarefas, '[]'::jsonb)) s;
      end if;

      insert into public.tarefas (
        ordem, titulo, responsavel, status, prioridade, prazo, observacao, subtarefas,
        cat_natureza, cat_area, cat_origem, rotina,
        rotina_cadencia, rotina_serie_id, rotina_ativa, rotina_antecedencia_dias,
        rotina_subtarefas_fonte
      ) values (
        (select coalesce(max(ordem), 0) + 1 from public.tarefas),
        r.titulo, r.responsavel, 'Backlog', r.prioridade, d, r.observacao, v_subs,
        r.cat_natureza, r.cat_area, r.cat_origem, true,
        r.rotina_cadencia, r.rotina_serie_id, true, r.rotina_antecedencia_dias,
        r.rotina_subtarefas_fonte
      ) returning id into v_id;

      insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario)
      values (v_id, r.titulo, 'criada',
              format('Criada pela rotina · prazo %s%s', to_char(d, 'DD/MM/YYYY'),
                     case when r.rotina_subtarefas_fonte = 'agenda'
                          then format(' · %s pagamento(s) da agenda', jsonb_array_length(v_subs))
                          else '' end),
              'Rotina');

      v_criadas := v_criadas + 1;
    end loop;
  end loop;

  return v_criadas;
end;
$$;

grant execute on function public.tarefas_rotinas_gerar(date) to authenticated;
revoke all on function public.tarefas_rotinas_gerar(date) from anon;

-- ======================================== o painel mostra de onde vem a lista ==
drop view if exists public.tarefas_rotinas;
create view public.tarefas_rotinas as
with modelo as (
  select distinct on (rotina_serie_id) *
    from public.tarefas
   where rotina_serie_id is not null
     and rotina_cadencia is not null
   order by rotina_serie_id, created_at desc
)
select
  m.rotina_serie_id                as serie_id,
  m.id                             as tarefa_modelo_id,
  m.titulo,
  m.responsavel,
  m.prioridade,
  m.cat_area,
  m.cat_natureza,
  m.rotina_cadencia                as cadencia,
  m.rotina_ativa                   as ativa,
  m.rotina_antecedencia_dias       as antecedencia_dias,
  m.rotina_subtarefas_fonte        as subtarefas_fonte,
  (select count(*) from public.tarefas t
    where t.rotina_serie_id = m.rotina_serie_id)                          as ocorrencias,
  (select count(*) from public.tarefas t
    where t.rotina_serie_id = m.rotina_serie_id
      and t.status = 'Concluído')                                         as concluidas,
  (select max(t.concluido_em) from public.tarefas t
    where t.rotina_serie_id = m.rotina_serie_id
      and t.status = 'Concluído')                                         as ultima_conclusao,
  (select t.id from public.tarefas t
    where t.rotina_serie_id = m.rotina_serie_id
      and t.status <> 'Concluído'
      and t.arquivada_em is null
    order by t.prazo nulls last limit 1)                                  as aberta_id,
  (select min(t.prazo) from public.tarefas t
    where t.rotina_serie_id = m.rotina_serie_id
      and t.status <> 'Concluído'
      and t.arquivada_em is null)                                         as aberta_prazo,
  (select min(x) from public.rotina_datas(
      m.rotina_cadencia, current_date, current_date + 400) x)             as proxima_data,
  -- Quantos pagamentos a agenda já tem marcados para a próxima data. É o número
  -- que responde "o que vai cair no checklist da próxima" sem abrir a tarefa —
  -- e um zero aqui, numa rotina de agenda, denuncia que o espelho não rodou.
  (select count(*) from public.agenda_eventos e
    where m.rotina_subtarefas_fonte = 'agenda'
      and e.eh_pagamento
      and e.dia = (select min(x) from public.rotina_datas(
                     m.rotina_cadencia, current_date, current_date + 400) x)) as proxima_itens
from modelo m;

alter view public.tarefas_rotinas set (security_invoker = on);

comment on view public.tarefas_rotinas is
  'Uma linha por rotina (série de tarefas com cadência): o que é, quando volta, de onde vem o checklist, última conclusão e ocorrência aberta.';

grant select on public.tarefas_rotinas to authenticated;
revoke all on public.tarefas_rotinas from anon;

-- ===================================================================== cron ==
-- 09:00 UTC = 06:00 BRT, DEZ MINUTOS ANTES do gerador de rotinas (09:10 UTC).
-- A ordem importa: o gerador lê o espelho, então um espelho velho entregaria o
-- checklist de ontem. A segunda passada (18:00 UTC = 15:00 BRT) pega o
-- pagamento que alguém marcou na agenda durante a manhã.
-- O token do cron entra em `internal_cron_tokens` como os outros; o comando do
-- job NUNCA o carrega em texto — quem o lê é `disparar_automacao`, na hora do
-- disparo, para que rotacionar o token valha no disparo seguinte.
insert into public.internal_cron_tokens (name, token)
values ('agenda-sync', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

do $do$
declare
  v_anon  text;
  v_extra text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  /* O GATEWAY DO SUPABASE EXIGE `Authorization` ANTES da função rodar: sem ele a
     chamada morre em "Missing authorization header" e o x-cron-token nem chega a
     ser lido (medido, não suposto). A anon key é lida do comando de um cron que
     já existe em vez de recopiada aqui — ela é pública, mas duplicar chave num
     arquivo de migração é como se perde o rastro de qual é a boa. */
  select substring(command from '''apikey''\s*,\s*''([^'']+)''')
    into v_anon
    from cron.job where jobname = 'omie-contas-pagar-sync-diario';

  if v_anon is null then
    raise exception 'não achei a anon key no comando de omie-contas-pagar-sync-diario';
  end if;

  v_extra := format('jsonb_build_object(%L, %L, %L, %L)',
                    'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon);

  perform cron.unschedule('agenda-sync-diaria')
    where exists (select 1 from cron.job where jobname = 'agenda-sync-diaria');

  perform cron.schedule('agenda-sync-diaria', '0 9,18 * * *', format(
    $cmd$select public.disparar_automacao(%L, %L, '{"action":"sync","trigger":"cron"}'::jsonb, %L, %s, 120000);$cmd$,
    'agenda-sync-diaria',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/agenda-sync',
    'agenda-sync',
    v_extra
  ));
end;
$do$;
