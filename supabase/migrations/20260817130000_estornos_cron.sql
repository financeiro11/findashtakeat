-- Estornos — as duas rotinas que fazem o número ser contínuo em vez de mensal.
--
-- São DUAS porque as duas metades da conta têm custo e ritmo muito diferentes:
--
--   • ASAAS (caro, 2×/dia): ~110 requisições — 13 páginas de `status=REFUNDED` (todos
--     os estornos totais de todos os tempos) + ~95 da janela de vencimento, que é
--     onde os PARCIAIS aparecem, já que eles não têm status próprio para filtrar.
--
--   • PLANILHA (grátis, de hora em hora): reler a aba ESTORNOS e reconciliar não toca
--     no Asaas. É o que faz a classificação que alguém acabou de escrever aparecer no
--     painel no mesmo turno, em vez de só na próxima puxada.
--
-- O `estornos-sync` também relê a planilha, então a rotina cara já vem completa; a
-- barata só antecipa a metade que muda o tempo todo.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

INSERT INTO public.internal_cron_tokens (name) VALUES ('estornos-sync')
  ON CONFLICT (name) DO NOTHING;

-- 12:40 e 21:40 UTC = 09:40 e 18:40 BRT (America/Sao_Paulo, UTC-3, sem horário de verão).
SELECT cron.unschedule('estornos-sync-asaas') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'estornos-sync-asaas'
);
SELECT cron.schedule(
  'estornos-sync-asaas',
  '40 12,21 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/estornos-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'estornos-sync')
    ),
    body := jsonb_build_object('action', 'atualizar', 'trigger', 'cron')
  );
  $$
);

SELECT cron.unschedule('estornos-sync-planilha') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'estornos-sync-planilha'
);
SELECT cron.schedule(
  'estornos-sync-planilha',
  '20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/estornos-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'estornos-sync')
    ),
    body := jsonb_build_object('action', 'recalcular', 'trigger', 'cron')
  );
  $$
);
