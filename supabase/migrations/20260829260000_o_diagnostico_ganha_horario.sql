-- O diagnóstico das automações ganha horário.
--
-- 13:50 e 22:50 UTC (10:50 e 19:50 BRT). A escolha é conservadora e tem razão:
-- as falhas do dia só existem DEPOIS de os crons rodarem, e a leva pesada deste
-- Hub vai das 09h às 13h UTC. Rodar antes seria diagnosticar o silêncio.
--
-- DUAS VEZES POR DIA, e não de hora em hora. A fila típica é de zero a duas
-- falhas novas — e assinatura repetida não gasta chamada nenhuma, porque
-- `automacoes_para_diagnosticar` já exclui o que tem diagnóstico. Rodar mais
-- vezes encontraria a fila vazia quase sempre.
--
-- No minuto :50, que está livre: os :00, :05, :15, :20, :30, :35 e :40 já têm
-- dono, e o pg_net processa quase em série — disputa de fila vira estouro de 90s
-- sem a função nem ter sido chamada (ver `20260829180000`).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'automacoes-diagnosticar-dia') then
    perform cron.unschedule('automacoes-diagnosticar-dia');
  end if;
  perform cron.schedule('automacoes-diagnosticar-dia', '50 13,22 * * *', $cmd$
    select public.disparar_automacao(
      'automacoes-diagnosticar-dia',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/automacoes-diagnosticar',
      '{"action":"rodada"}'::jsonb,
      'automacoes-diagnosticar',
      '{}'::jsonb,
      120000
    );
  $cmd$);
end $$;
