-- Refresh semanal do cadastro de clientes/fornecedores (omie-clientes-sync),
-- segunda-feira às 05:00 BRT.
--
-- Este cache é o que troca CNPJ por nome na auditoria de lançamentos da DRE/DFC.
-- Sem o agendamento, fornecedor novo cadastrado no Omie aparece como documento
-- até alguém clicar em "Buscar nomes no Omie" no painel — e ninguém lembra de
-- clicar.
--
-- Semanal, e não diário, porque cadastro muda pouco: são ~1.000 registros e três
-- páginas de API. Rodar isto nunca mexe em demonstração nenhuma, só reescreve a
-- linha "clientes" de `omie_cache`.
--
-- Mesmo esquema de proteção das outras syncs: a função é protegida por
-- requireUser (que rejeita a anon key pública), então o cron manda um token
-- aleatório de `internal_cron_tokens` no header `x-cron-token`, via subquery —
-- o token nunca aparece em texto no corpo do job.

-- Gera o token uma única vez (idempotente — não rotaciona em re-runs).
INSERT INTO public.internal_cron_tokens (name) VALUES ('omie-clientes-sync')
  ON CONFLICT (name) DO NOTHING;

-- Segunda 08:00 UTC = 05:00 BRT. Fora do horário dos jobs diários (09:00–12:00
-- UTC), para não concorrer com eles pela API do Omie.
SELECT cron.unschedule('omie-clientes-sync-semanal') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'omie-clientes-sync-semanal'
);
SELECT cron.schedule(
  'omie-clientes-sync-semanal',
  '0 8 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-clientes-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (SELECT token FROM public.internal_cron_tokens WHERE name = 'omie-clientes-sync')
    ),
    body := jsonb_build_object('action', 'sync', 'trigger', 'cron')
  );
  $$
);
