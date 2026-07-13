-- Sincronização automática diária do painel Caixa (omie-caixa-sync) às 09:00 BRT.
--
-- A função é protegida por requireUser (bloqueia a anon key pública). Para o cron
-- disparar sem expor a service key, usamos um TOKEN aleatório guardado em
-- `internal_cron_tokens` (tabela que só o service_role lê): o agendamento manda o
-- token no header `x-cron-token` via subquery — ele nunca aparece em texto no job —
-- e a função valida contra a tabela antes de liberar o sync.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Cofre de tokens de cron (1 linha por função agendada).
CREATE TABLE IF NOT EXISTS public.internal_cron_tokens (
  name       text PRIMARY KEY,
  token      text NOT NULL DEFAULT gen_random_uuid()::text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_cron_tokens ENABLE ROW LEVEL SECURITY;
-- Sem policies: anon/authenticated não leem nada. O service_role (BYPASSRLS) lê.
REVOKE ALL ON public.internal_cron_tokens FROM anon, authenticated;
GRANT ALL  ON public.internal_cron_tokens TO service_role;

-- Gera o token uma única vez (idempotente — não rotaciona em re-runs).
INSERT INTO public.internal_cron_tokens (name) VALUES ('omie-caixa-sync')
  ON CONFLICT (name) DO NOTHING;

-- 12:00 UTC = 09:00 BRT (America/Sao_Paulo, UTC-3, sem horário de verão desde 2019).
SELECT cron.unschedule('omie-caixa-sync-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'omie-caixa-sync-diario'
);
SELECT cron.schedule(
  'omie-caixa-sync-diario',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-caixa-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'omie-caixa-sync')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron')
  );
  $$
);
