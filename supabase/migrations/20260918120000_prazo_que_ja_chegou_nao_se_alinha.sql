-- Prazo que já chegou não se alinha à cadência.
--
-- O DEFEITO, visto em 18/09/2026: "Relatório Caixa Semanal" (dias 6, 16, 21, 26
-- e 31). O cron criou a ocorrência com prazo 16/09; o Henrique a adiou à mão
-- para 17/09. No dia 18, ao abrir o cartão para concluí-lo, o diálogo recalculou
-- o prazo: 17/09 não é dia da cadência, já tinha passado, então a conta
-- recomeçava de HOJE e cravava 21/09. O quadro dizia "17/09 · ontem" e a
-- pergunta de concluir dizia "só vence em 21/09/2026". O adiamento tinha sido
-- desfeito em silêncio, e o atraso apagado.
--
-- A REGRA NOVA: o alinhamento só age sobre prazo AINDA NO FUTURO (ou vazio).
-- Data que já chegou é fato — atraso ou adiamento —, não regra mal escrita. A
-- versão anterior (20260831180000) já dizia "atraso não é divergência", mas só
-- honrava isso para data que a cadência produz; um adiamento para um dia fora da
-- lista caía no ramo do "conserto".
--
-- Espelha `ajustarPrazoACadencia` em src/lib/tarefas/rotina.ts. Esta função não
-- tem cron nem é chamada pela tela; muda aqui para os dois lados não divergirem
-- no dia em que alguém a rodar de novo.

create or replace function public.tarefas_rotinas_alinhar_prazo()
returns table(tarefa_id uuid, titulo text, de date, para date)
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_novo date;
begin
  for r in
    select t.id, t.titulo, t.prazo, t.rotina_cadencia
      from public.tarefas t
     where t.rotina_cadencia is not null
       and t.arquivada_em is null
       and t.status <> 'Concluído'
       -- Prazo que já chegou (vencido ou de hoje) fica onde está.
       and (t.prazo is null or t.prazo > current_date)
       -- Só o que NÃO é dia da cadência.
       and (t.prazo is null
            or not exists (select 1 from public.rotina_datas(t.rotina_cadencia, t.prazo, t.prazo)))
  loop
    -- Âncora: o prazo escrito (sempre futuro aqui) ou hoje, quando vazio.
    select min(d) into v_novo
      from public.rotina_datas(
             r.rotina_cadencia,
             coalesce(r.prazo, current_date),
             coalesce(r.prazo, current_date) + 400) d;

    continue when v_novo is null or v_novo = r.prazo;

    update public.tarefas set prazo = v_novo where id = r.id;

    insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario)
    values (r.id, r.titulo, 'editada',
            format('Prazo alinhado à rotina: %s → %s',
                   coalesce(to_char(r.prazo, 'DD/MM/YYYY'), 'sem prazo'),
                   to_char(v_novo, 'DD/MM/YYYY')),
            'Rotina');

    tarefa_id := r.id; titulo := r.titulo; de := r.prazo; para := v_novo;
    return next;
  end loop;
end;
$$;

comment on function public.tarefas_rotinas_alinhar_prazo() is
  'Puxa o prazo das rotinas abertas para o dia de cadência mais próximo A PARTIR do prazo escrito, quando esse prazo AINDA NÃO CHEGOU e não é um dia que a regra produz. Prazo vencido ou de hoje nunca se mexe: é atraso ou adiamento, não divergência. Devolve o que mudou.';
