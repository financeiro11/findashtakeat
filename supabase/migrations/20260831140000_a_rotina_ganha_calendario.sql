-- A rotina ganha calendário: "É rotina" deixa de ser adjetivo e vira agenda.
--
-- O que existia: `tarefas.rotina`, um booleano carimbado pelo gatilho a partir de
-- palavras no título ("mensal", "toda segunda") e usado só pela Análise Semanal,
-- para somar quanto do esforço da semana é repetição. O checkbox dizia "volta
-- sozinha toda semana/mês" — e não voltava: quem criava a tarefa da semana
-- seguinte era uma pessoa que lembrou. Pior: a cadência ESTAVA escrita no título
-- e o carimbo a jogava fora, guardando só sim/não. Não havia onde dizer "dia 5",
-- porque não havia nada atrás para executar isso.
--
-- O que passa a existir:
--   * `rotina_cadencia` (jsonb) — quando ela volta, em dado e não em prosa;
--   * `rotina_serie_id`  — o fio que liga todas as ocorrências da MESMA rotina;
--   * `rotina_ativa`     — pausar sem apagar;
--   * `rotina_antecedencia_dias` — criar com folga antes do prazo.
--
-- A rotina não é um cadastro à parte: ela É a série de tarefas. A ocorrência mais
-- recente da série é o modelo da próxima — então editar a rotina é editar a
-- tarefa, sem uma segunda tela de cadastro para sair de sincronia com a primeira.
--
-- O espelho em TypeScript (mesmas contas, para a tela mostrar "próxima: 05/09"
-- enquanto a pessoa configura) mora em src/lib/tarefas/rotina.ts. Mudou aqui,
-- mude lá.

-- ============================================================== as colunas ==
alter table public.tarefas
  add column if not exists rotina_cadencia jsonb,
  add column if not exists rotina_serie_id uuid,
  add column if not exists rotina_ativa boolean not null default true,
  add column if not exists rotina_antecedencia_dias int not null default 0;

alter table public.tarefas
  drop constraint if exists tarefas_rotina_antecedencia_ck;
alter table public.tarefas
  add constraint tarefas_rotina_antecedencia_ck
  check (rotina_antecedencia_dias between 0 and 30);

comment on column public.tarefas.rotina_cadencia is
  'Quando a rotina volta. {"tipo":"diaria","somente_uteis":bool} | {"tipo":"semanal","dias":[1..7]} (1=segunda, ISO) | {"tipo":"mensal","dias":[1..31],"ultimo_dia":bool,"ajuste_fds":"antecipar"|"adiar"}. NULL = tarefa comum (ou rotina só observada, sem agenda).';
comment on column public.tarefas.rotina_serie_id is
  'Todas as ocorrências da mesma rotina compartilham este id. A mais recente (created_at) é o modelo da próxima.';
comment on column public.tarefas.rotina_ativa is
  'Pausa a geração sem apagar a rotina. Vale o valor da ocorrência mais recente da série.';
comment on column public.tarefas.rotina_antecedencia_dias is
  'Quantos dias antes do prazo a ocorrência é criada. 0 = nasce no próprio dia.';

create index if not exists idx_tarefas_rotina_serie
  on public.tarefas(rotina_serie_id) where rotina_serie_id is not null;

-- ================================================== o fio da série, sozinho ==
-- Quem escreve uma cadência não deveria ter de inventar um uuid de série. E
-- cadência sem `rotina = true` faria a tarefa aparecer no painel de rotinas e
-- sumir da conta da Análise Semanal ao mesmo tempo — as duas leituras precisam
-- concordar.
create or replace function public.fn_tarefa_rotina_serie()
returns trigger
language plpgsql
as $$
begin
  if NEW.rotina_cadencia is not null then
    NEW.rotina_serie_id := coalesce(NEW.rotina_serie_id, gen_random_uuid());
    NEW.rotina := true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_tarefa_rotina_serie on public.tarefas;
create trigger trg_tarefa_rotina_serie
  before insert or update of rotina_cadencia, rotina_serie_id on public.tarefas
  for each row execute function public.fn_tarefa_rotina_serie();

-- ================================================== as datas de uma cadência ==
-- Varre dia a dia de propósito, em vez de fazer aritmética de mês. É a varredura
-- que resolve fevereiro sozinha: uma rotina "todo dia 31" simplesmente NÃO TEM
-- data em fevereiro — e é isso que "dia 31" quer dizer. Quem quer dizer "fim do
-- mês" marca `ultimo_dia`, que é uma opção separada justamente porque as duas
-- coisas são diferentes e confundi-las erra o prazo de um fechamento.
--
-- A janela varrida é 3 dias maior dos dois lados porque o ajuste de fim de semana
-- move a data: um dia 1º que cai no domingo, com "adiar", vira dia 2 — e o dia 1º
-- pode estar fora do intervalo pedido enquanto o dia 2 está dentro.
create or replace function public.rotina_datas(cad jsonb, de date, ate date)
returns setof date
language sql
immutable
as $$
  with varredura as (
    select g::date as d
      from generate_series(de - 3, ate + 3, interval '1 day') g
  ),
  bate as (
    select d
      from varredura
     where case cad->>'tipo'
             when 'diaria' then
               not coalesce((cad->>'somente_uteis')::boolean, false)
               or extract(isodow from d) < 6
             when 'semanal' then
               exists (select 1
                         from jsonb_array_elements_text(coalesce(cad->'dias', '[]'::jsonb)) x
                        where x ~ '^\d+$' and x::int = extract(isodow from d))
             when 'mensal' then
               exists (select 1
                         from jsonb_array_elements_text(coalesce(cad->'dias', '[]'::jsonb)) x
                        where x ~ '^\d+$' and x::int = extract(day from d))
               or (coalesce((cad->>'ultimo_dia')::boolean, false)
                   and d = (date_trunc('month', d) + interval '1 month - 1 day')::date)
             else false
           end
  ),
  ajustada as (
    select distinct
           case
             when cad->>'tipo' <> 'mensal'
               or cad->>'ajuste_fds' is null
               or extract(isodow from d) < 6            then d
             when cad->>'ajuste_fds' = 'antecipar'
               then d - (case when extract(isodow from d) = 6 then 1 else 2 end)
             when cad->>'ajuste_fds' = 'adiar'
               then d + (case when extract(isodow from d) = 6 then 2 else 1 end)
             else d
           end as d
      from bate
  )
  select d from ajustada where d between de and ate order by d;
$$;

comment on function public.rotina_datas(jsonb, date, date) is
  'As datas em que a cadência cai no intervalo. Espelho de datasDaCadencia() em src/lib/tarefas/rotina.ts.';

-- ============================================================== o gerador ==
-- Roda todo dia. Para cada série ativa, olha a janela [hoje, hoje+antecedência] e
-- cria o que falta.
--
-- Duas decisões que valem o comentário:
--
-- 1) A janela começa em HOJE, nunca no passado. Se o cron falhou ontem, a
--    ocorrência de ontem não nasce hoje com o prazo de ontem — nasceria já
--    atrasada, contaminando o KPI de atraso com uma falha de infraestrutura. O
--    dia perdido é perdido, e é a leitura certa.
-- 2) A checagem de "já existe" IGNORA `arquivada_em`. Se olhasse só as vivas, a
--    tarefa concluída e arquivada de manhã voltaria a ser criada à tarde, no
--    mesmo dia, para sempre.
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

      -- O checklist volta zerado e com ids novos: reaproveitar o id da subtarefa
      -- faria duas ocorrências compartilharem a mesma linha no arrasto da tela.
      select coalesce(jsonb_agg(
               jsonb_set(jsonb_set(s, '{done}', 'false'::jsonb),
                         '{id}', to_jsonb(gen_random_uuid()::text))
             ), '[]'::jsonb)
        into v_subs
        from jsonb_array_elements(coalesce(r.subtarefas, '[]'::jsonb)) s;

      insert into public.tarefas (
        ordem, titulo, responsavel, status, prioridade, prazo, observacao, subtarefas,
        cat_natureza, cat_area, cat_origem, rotina,
        rotina_cadencia, rotina_serie_id, rotina_ativa, rotina_antecedencia_dias
      ) values (
        (select coalesce(max(ordem), 0) + 1 from public.tarefas),
        r.titulo, r.responsavel, 'Backlog', r.prioridade, d, r.observacao, v_subs,
        r.cat_natureza, r.cat_area, r.cat_origem, true,
        r.rotina_cadencia, r.rotina_serie_id, true, r.rotina_antecedencia_dias
      ) returning id into v_id;

      insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario)
      values (v_id, r.titulo, 'criada',
              format('Criada pela rotina · prazo %s', to_char(d, 'DD/MM/YYYY')), 'Rotina');

      v_criadas := v_criadas + 1;
    end loop;
  end loop;

  return v_criadas;
end;
$$;

comment on function public.tarefas_rotinas_gerar(date) is
  'Cria as ocorrências das rotinas ativas cuja data cai na janela [hoje, hoje+antecedência]. Idempotente: rodar duas vezes no mesmo dia não duplica. Devolve quantas criou.';

-- ====================================================== o painel de rotinas ==
-- Uma linha por série: o que é a rotina, quando volta, quando foi a última vez e
-- se tem ocorrência aberta agora.
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
      m.rotina_cadencia, current_date, current_date + 400) x)             as proxima_data
from modelo m;

-- A view herda a RLS de `tarefas` (que já libera para authenticated). Sem isso
-- ela rodaria como dona e serviria linhas por cima de qualquer política futura.
alter view public.tarefas_rotinas set (security_invoker = on);

comment on view public.tarefas_rotinas is
  'Uma linha por rotina (série de tarefas com cadência): o que é, quando volta, última conclusão e ocorrência aberta.';

-- ================================================================ permissões ==
-- O grant para `anon` sai porque o Postgres o concede sozinho pelo papel público
-- neste projeto — e rotina de time financeiro não é dado de visitante.
grant select on public.tarefas_rotinas to authenticated;
revoke all on public.tarefas_rotinas from anon;

grant execute on function public.rotina_datas(jsonb, date, date) to authenticated;
revoke all on function public.rotina_datas(jsonb, date, date) from anon;

-- Executável pela tela ("Gerar agora", no painel) além do cron: quando alguém
-- acabou de cadastrar a rotina do dia, esperar até amanhã de manhã para ver se
-- funcionou é o tipo de espera que faz a pessoa desistir da funcionalidade.
grant execute on function public.tarefas_rotinas_gerar(date) to authenticated;
revoke all on function public.tarefas_rotinas_gerar(date) from anon;

-- ===================================================================== cron ==
-- 09:10 UTC = 06:10 em Brasília: a ocorrência do dia já está no quadro antes de
-- alguém abrir o Hub. É SQL puro, sem net.http_post — não há Edge Function no
-- caminho, então não há token de cron, nem teto de 150s, nem gateway para dar 546.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('tarefas-rotinas-gerar')
      where exists (select 1 from cron.job where jobname = 'tarefas-rotinas-gerar');
    perform cron.schedule('tarefas-rotinas-gerar', '10 9 * * *',
                          $cmd$select public.tarefas_rotinas_gerar();$cmd$);
  end if;
end;
$$;
