-- Assinaturas (recorrência Asaas) — snapshot mensal alimentado pela planilha do Google.
--
-- A página /assinaturas só lê `assinaturas_snapshot` (1 linha por competência/mês). A
-- edge function `assinaturas-sheet-sync` lê as abas mensais da planilha ("Junho 26",
-- "Maio 26", …), parseia o bloco de totais + a carteira de clientes e faz upsert por
-- competência. Roda automática no dia 2 de cada mês (quando a planilha é alimentada).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.assinaturas_snapshot (
  competencia      date PRIMARY KEY,            -- 1º dia do mês (2026-06-01)
  mes_label        text NOT NULL,               -- rótulo da aba ("Junho 26")
  dados            jsonb NOT NULL,              -- KPIs + mix por nível + mix por plano + top contratos
  insights         jsonb,                       -- comentários da IA (tendência) — normalmente só no mês mais recente
  sincronizado_em  timestamptz,
  gerado_em        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assinaturas_snapshot ENABLE ROW LEVEL SECURITY;

-- Usuários logados leem; escrita é só via service_role (edge function/cron, que ignora RLS).
DROP POLICY IF EXISTS "assinaturas_snapshot_select_auth" ON public.assinaturas_snapshot;
CREATE POLICY "assinaturas_snapshot_select_auth"
  ON public.assinaturas_snapshot FOR SELECT
  TO authenticated
  USING (true);

-- ---- cron dia 2 de cada mês, 12:00 UTC = 09:00 BRT (mesmo padrão x-cron-token) ----
INSERT INTO public.internal_cron_tokens (name) VALUES ('assinaturas-sheet-sync')
  ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('assinaturas-sheet-sync-mensal') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'assinaturas-sheet-sync-mensal'
);
SELECT cron.schedule(
  'assinaturas-sheet-sync-mensal',
  '0 12 2 * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/assinaturas-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'assinaturas-sheet-sync')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron')
  );
  $$
);
