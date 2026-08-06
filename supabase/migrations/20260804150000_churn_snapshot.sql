-- Churn — snapshot mensal alimentado pela planilha "[CHURN TAKEAT 2026] Métricas gerais".
--
-- A aba "Churn" de /assinaturas só lê `churn_snapshot` (1 linha por competência). A edge
-- function `churn-sheet-sync` baixa o .xlsx da planilha e RECALCULA cada mês a partir das
-- bases ("2026 CHURNS", "2026 DOWNSELL", "2026 UPSELL", "2026 REATIVAÇÕES") + "DADOS 2026"
-- (MRR de início do mês e quantidade de clientes), reproduzindo as fórmulas do bloco
-- "KPI's Gerais" da aba "Mensal 2026" — que na planilha só existe para o mês escolhido no
-- dropdown. Recalcular dá o histórico inteiro do ano e não depende do dropdown.
--
-- A ponte com a aba Recorrência: o "MRR início do mês" de um mês M é o mesmo número do
-- snapshot de assinaturas da competência M-1 (a base fechada no fim do mês anterior). O
-- sync guarda essa conferência em dados->base->conferencia.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.churn_snapshot (
  competencia      date PRIMARY KEY,            -- 1º dia do mês de churn (2026-07-01)
  mes_label        text NOT NULL,               -- "Jul 26"
  dados            jsonb NOT NULL,              -- base + kpis + por_setor + por_qualificacao
  sincronizado_em  timestamptz,
  gerado_em        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.churn_snapshot ENABLE ROW LEVEL SECURITY;

-- Usuários logados leem; escrita é só via service_role (edge function/cron, que ignora RLS).
DROP POLICY IF EXISTS "churn_snapshot_select_auth" ON public.churn_snapshot;
CREATE POLICY "churn_snapshot_select_auth"
  ON public.churn_snapshot FOR SELECT
  TO authenticated
  USING (true);

-- ---- cron diário, 12:00 UTC = 09:00 BRT (mesmo padrão x-cron-token) ----
-- Diário porque a planilha de churn é alimentada pelo time de CS ao longo do mês: assim o
-- mês corrente fica sempre fresco, e o fechamento do mês anterior entra sozinho.
INSERT INTO public.internal_cron_tokens (name) VALUES ('churn-sheet-sync')
  ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('churn-sheet-sync-diario') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'churn-sheet-sync-diario'
);
SELECT cron.schedule(
  'churn-sheet-sync-diario',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/churn-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'churn-sheet-sync')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron')
  );
  $$
);
