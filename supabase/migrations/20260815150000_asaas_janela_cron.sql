-- As cobranças do Asaas que alimentam o fluxo projetado do /caixa, atualizadas antes
-- do caixa rodar.
--
-- A ORDEM É O PONTO: a omie-caixa-sync (cron das 12:00 UTC / 09:00 BRT) LÊ o espelho
-- `asaas_cache`, não fala com o Asaas. Se a única atualização fosse a do /asaas
-- (asaas-sync-diario, 12:15 UTC), o gráfico do caixa mostraria sempre a foto da
-- véspera. Este job roda a ação "janela" 20 minutos antes — só a faixa de vencimento
-- em torno de hoje, sem assinaturas nem NF-e.
--
-- Custo: ~68 páginas de /payments por dia, contra a cota de 25.000 requisições/12h.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

INSERT INTO public.internal_cron_tokens (name) VALUES ('asaas-sync')
  ON CONFLICT (name) DO NOTHING;

-- 11:40 UTC = 08:40 BRT (America/Sao_Paulo, UTC-3, sem horário de verão).
SELECT cron.unschedule('asaas-janela-sync-diaria') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'asaas-janela-sync-diaria'
);
SELECT cron.schedule(
  'asaas-janela-sync-diaria',
  '40 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'asaas-sync')
    ),
    body := jsonb_build_object('action', 'janela', 'trigger', 'cron'),
    timeout_milliseconds := 150000
  );
  $$
);
