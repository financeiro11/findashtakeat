-- O prazo da rotina não pode contradizer a própria cadência.
--
-- O DEFEITO, visto no quadro: "Boleto e NF <> Banestes" com o selo "↻ todo dia
-- 31" e vencimento em 30/09. "Relatório Caixa Semanal" com "↻ dias 6, 16, 21, 26
-- e 31" e vencimento em 05/09. O cartão anuncia uma regra e vence noutro dia.
--
-- A causa: o preenchimento automático do prazo só agia sobre campo VAZIO. Tarefa
-- que já existia e ganhou cadência depois ficou com a data velha.
--
-- E não é só feio — DUPLICA. O gerador cria a ocorrência do dia da cadência
-- (06/09) enquanto a de prazo torto (05/09) segue aberta, e o quadro passa a ter
-- duas tarefas da mesma rotina, com a mesma cara.
--
-- ATRASO NÃO É DIVERGÊNCIA, e esta função não mexe nele. Prazo que a cadência
-- produz continua valendo mesmo vencido: aquela ocorrência está atrasada, e
-- empurrá-la para a data seguinte apagaria o atraso — que é a informação mais
-- útil que o cartão carrega. Só se conserta o prazo que a regra NÃO produz.
--
-- A âncora do conserto é o prazo ESCRITO, não hoje: quem digitou 05/09 numa
-- rotina de dias 6/16/21/26/31 queria o dia 6, e não o próximo contado de hoje.
-- Espelha `ajustarPrazoACadencia` em src/lib/tarefas/rotina.ts.

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
       -- Só o que NÃO é dia da cadência. `rotina_datas(cad, p, p)` devolve linha
       -- exatamente quando aquele dia é produzido pela regra.
       and (t.prazo is null
            or not exists (select 1 from public.rotina_datas(t.rotina_cadencia, t.prazo, t.prazo)))
  loop
    select min(d) into v_novo
      from public.rotina_datas(
             r.rotina_cadencia,
             greatest(coalesce(r.prazo, current_date), current_date),
             greatest(coalesce(r.prazo, current_date), current_date) + 400) d;

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
  'Puxa o prazo das rotinas abertas para o dia de cadência mais próximo A PARTIR do prazo escrito, quando o prazo atual não é um dia que a regra produz. Não mexe em tarefa atrasada cujo prazo É dia de cadência — atraso não é divergência. Devolve o que mudou.';

grant execute on function public.tarefas_rotinas_alinhar_prazo() to authenticated;
revoke all on function public.tarefas_rotinas_alinhar_prazo() from anon;

-- O conserto das que já estavam gravadas antes de o diálogo passar a impedir a
-- divergência. Idempotente: rodar de novo não muda nada, porque depois da
-- primeira passada todo prazo já é dia de cadência.
select * from public.tarefas_rotinas_alinhar_prazo();
