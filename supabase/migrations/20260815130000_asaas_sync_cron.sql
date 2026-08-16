-- Atualização automática diária da página /asaas (asaas-sync) às 09:15 BRT.
--
-- Com o espelho local em asaas_cache, a chamada diária é INCREMENTAL: puxa só os
-- pagamentos novos/recém-pagos do mês corrente e confere assinaturas e NF-e por
-- contagem (1-2 requisições cada). O custo diário fica na casa de ~10 requisições,
-- contra as ~115 que o botão antigo gastava a CADA clique.
--
-- Sem `referencia` no corpo, a função assume o mês corrente em BRT.
-- Mesmo esquema do asaas-extrato-sync: token em internal_cron_tokens no header
-- x-cron-token, sem expor a service key no job.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

INSERT INTO public.internal_cron_tokens (name) VALUES ('asaas-sync')
  ON CONFLICT (name) DO NOTHING;

-- 12:15 UTC = 09:15 BRT (America/Sao_Paulo, UTC-3, sem horário de verão).
SELECT cron.unschedule('asaas-sync-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'asaas-sync-diario'
);
SELECT cron.schedule(
  'asaas-sync-diario',
  '15 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'asaas-sync')
    ),
    body := jsonb_build_object('action', 'atualizar', 'trigger', 'cron')
  );
  $$
);
