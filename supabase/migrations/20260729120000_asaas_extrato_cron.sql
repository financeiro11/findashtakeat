-- Sincronização automática diária do extrato Asaas (asaas-extrato-sync) às 08:30 BRT.
-- Incremental: a função puxa da API só os lançamentos após a marca d'água já gravada,
-- então o passado nunca é re-baixado (o custo diário é mínimo).
--
-- Mesmo esquema do omie-caixa-sync: token aleatório em internal_cron_tokens enviado no
-- header x-cron-token, sem expor a service key no job.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Token do cron (idempotente — não rotaciona em re-runs).
INSERT INTO public.internal_cron_tokens (name) VALUES ('asaas-extrato-sync')
  ON CONFLICT (name) DO NOTHING;

-- 11:30 UTC = 08:30 BRT (America/Sao_Paulo, UTC-3, sem horário de verão).
SELECT cron.unschedule('asaas-extrato-sync-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'asaas-extrato-sync-diario'
);
SELECT cron.schedule(
  'asaas-extrato-sync-diario',
  '30 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-extrato-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'asaas-extrato-sync')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron')
  );
  $$
);
