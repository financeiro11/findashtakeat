-- Concluir um card com prazo no futuro não pode queimar aquele dia da rotina.
--
-- O DEFEITO, visto no painel em 11/09/2026: "Preenchimento Pauta <> Weekly" com
-- "Próxima 11/09 · hoje" e "Aberta agora —". O cron das 6h10 tinha rodado e
-- criado o card dos Estornos no mesmo minuto — ou seja, o gerador estava vivo e
-- pulou só aquela rotina.
--
-- A causa: a checagem de "já existe" olhava apenas (série, prazo), sem status. A
-- série da Pauta já tinha uma tarefa de prazo 11/09 — criada à mão em 03/09, ao
-- configurar a rotina — e ela foi concluída em 09/09, na faxina do quadro. O dia
-- de hoje já estava tomado por um card fechado dois dias antes de existir.
--
-- Não é caso isolado: toda tarefa que virou rotina nasceu com o prazo da PRÓXIMA
-- data da cadência e foi concluída em seguida, queimando-a. Já tinha acontecido
-- em silêncio com o "Relatório Caixa Semanal" (prazo 06/09, concluído em 01/09 —
-- o card de 06/09 nunca nasceu) e estava contratado para 30/09 (proporcionais),
-- 01/10 (extratos) e 31/10 (Banestes).
--
-- A REGRA NOVA, e o que ela preserva: o dia continua ocupado enquanto houver
-- ocorrência ABERTA com aquele prazo (senão o quadro ganha duas iguais), e
-- também quando a ocorrência foi concluída NO DIA DO PRAZO OU DEPOIS — que é o
-- caso que a trava original protegia: a tarefa concluída e arquivada de manhã
-- não pode renascer à tarde, todo dia. O que deixa de ocupar é a conclusão
-- ANTERIOR ao prazo, porque ali ninguém fez o trabalho daquele dia: ou a rotina
-- acabava de ser configurada, ou o card foi fechado no arrastão.
--
-- O fuso é explícito: `concluido_em` é timestamptz e o banco roda em UTC, então
-- concluir às 23h30 de quinta (02h30 UTC de sexta) contaria como sexta e voltaria
-- a queimar o dia seguinte. A conta é no fuso de quem trabalha.

-- ================================================= a regra, em um lugar só ==
-- Gerador e painel precisam concordar: "Próxima" que mostra um dia que o gerador
-- vai pular é exatamente o que fez esta investigação começar.
create or replace function public.rotina_dia_ocupado(p_serie uuid, p_dia date)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.tarefas x
     where x.rotina_serie_id = p_serie
       and x.prazo = p_dia
       and (
         -- ainda aberta (inclusive arquivada: o dia foi usado)
         x.status <> 'Concluído'
         -- linha antiga sem carimbo de conclusão: na dúvida, ocupa
         or x.concluido_em is null
         -- concluída no dia ou depois: o trabalho daquele dia foi feito
         or (x.concluido_em at time zone 'America/Sao_Paulo')::date >= p_dia
       )
  );
$$;

comment on function public.rotina_dia_ocupado(uuid, date) is
  'Aquele dia da série já tem ocorrência que conta? Sim se há uma aberta com esse prazo, ou uma concluída no dia do prazo ou depois. Conclusão anterior ao prazo NÃO ocupa o dia.';

grant execute on function public.rotina_dia_ocupado(uuid, date) to authenticated;
revoke all on function public.rotina_dia_ocupado(uuid, date) from anon;

-- ====================================== o gerador passa a usar a regra nova ==
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
      continue when public.rotina_dia_ocupado(r.rotina_serie_id, d);

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

comment on function public.tarefas_rotinas_gerar(date) is
  'Cria as ocorrências das rotinas ativas cuja data cai na janela [hoje, hoje+antecedência] e ainda não está ocupada (rotina_dia_ocupado). Idempotente: rodar duas vezes no mesmo dia não duplica. Devolve quantas criou.';

-- ============================== "Próxima" é a que o Hub vai criar de verdade ==
-- Antes era a próxima data do CALENDÁRIO, e por isso a linha da Pauta anunciava
-- "hoje" para um dia que o gerador ia pular. Agora é a primeira data que a
-- cadência produz e que ainda não está ocupada — a mesma pergunta que o gerador
-- faz. Efeito colateral desejado: rotina com a ocorrência de hoje já no quadro
-- passa a mostrar a data SEGUINTE, e a coluna "Aberta agora" deixa de repetir.
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
      m.rotina_cadencia, current_date, current_date + 400) x
    where not public.rotina_dia_ocupado(m.rotina_serie_id, x))            as proxima_data,
  -- Quantos pagamentos a agenda já tem marcados para a próxima data. É o número
  -- que responde "o que vai cair no checklist da próxima" sem abrir a tarefa —
  -- e um zero aqui, numa rotina de agenda, denuncia que o espelho não rodou.
  (select count(*) from public.agenda_eventos e
    where m.rotina_subtarefas_fonte = 'agenda'
      and e.eh_pagamento
      and e.dia = (select min(x) from public.rotina_datas(
                     m.rotina_cadencia, current_date, current_date + 400) x
                    where not public.rotina_dia_ocupado(m.rotina_serie_id, x))) as proxima_itens
from modelo m;

alter view public.tarefas_rotinas set (security_invoker = on);

comment on view public.tarefas_rotinas is
  'Uma linha por rotina (série de tarefas com cadência): o que é, quando o Hub vai criar a próxima, de onde vem o checklist, última conclusão e ocorrência aberta.';

grant select on public.tarefas_rotinas to authenticated;
revoke all on public.tarefas_rotinas from anon;
