-- A sugestão de resposta de e-mail ganha horário.
--
-- 10:25 e 19:25 UTC (07:25 e 16:25 BRT): antes do expediente e no meio da tarde,
-- que é quando a caixa acumulou algo desde a última passada. O `gmail-nf-sync`
-- roda de hora em hora e alimenta `email_mensagens`; aqui só se lê o que ele já
-- trouxe.
--
-- DUAS VEZES, E LOTE DE 8. A caixa que o Hub indexa é a de NOTA FISCAL, e nota
-- fiscal chega de `noreply@` — na primeira rodada real, 3 de 3 e-mails saíram
-- como "não precisa responder", corretamente. Enquanto for esse o corpus, o
-- rendimento é baixo por construção, e gastar mais chamadas não muda isso: muda
-- indexar outra caixa.
--
-- ESTE CRON NÃO ENVIA NADA. Ele só escreve rascunho. `enviar` exige pessoa
-- logada e recusa `x-cron-token` — ver o cabeçalho de `email-responder`.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-responder-sugerir') then
    perform cron.unschedule('email-responder-sugerir');
  end if;
  perform cron.schedule('email-responder-sugerir', '25 10,19 * * *', $cmd$
    select public.disparar_automacao(
      'email-responder-sugerir',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/email-responder',
      '{"action":"preparar","limite":10}'::jsonb,
      'email-responder',
      '{}'::jsonb,
      140000
    );
  $cmd$);
end $$;
