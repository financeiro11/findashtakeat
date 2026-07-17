-- Sincronização automática diária do realizado do Orçamento (omie-orcamento-sync).
-- 08:00 BRT (11:00 UTC). Usa o padrão x-cron-token (internal_cron_tokens) porque a
-- função exige requireUser; o token nunca aparece em texto no cron.job. `ano` é o ano
-- corrente em America/Sao_Paulo (auto-ajusta na virada).
--
-- 2026-07-16: reagendado de 10:00 BRT (13:00 UTC) para 08:00 BRT a pedido do usuário.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

INSERT INTO public.internal_cron_tokens (name) VALUES ('omie-orcamento-sync')
  ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('omie-orcamento-sync-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'omie-orcamento-sync-diario'
);
SELECT cron.schedule(
  'omie-orcamento-sync-diario',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-orcamento-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'omie-orcamento-sync')
    ),
    body := jsonb_build_object(
      'action', 'sync',
      'trigger', 'cron',
      'ano', extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int
    )
  );
  $$
);
