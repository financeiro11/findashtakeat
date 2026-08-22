-- Varredura diária das NFs do Facilities que ainda não acharam dono.
--
-- Por que não basta casar na hora do upload: ele anexa a nota no dia da compra, mas o
-- lançamento só existe na auditoria quando a fatura do cartão é importada — semanas
-- depois. Sem repescagem, toda nota mandada "cedo demais" ficaria guardada para sempre
-- e ele acabaria mandando de novo, que é justamente o que se quer evitar.
--
-- A função ignora quem já tem vínculo aplicado, então rodar todo dia é barato: a fila
-- some sozinha à medida que as notas casam.

insert into public.internal_cron_tokens (name)
select 'facilities-nf-auditoria'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'facilities-nf-auditoria'
);

select cron.unschedule('facilities-nf-varredura')
where exists (select 1 from cron.job where jobname = 'facilities-nf-varredura');

-- 12:20 UTC ≈ 09:20 em São Paulo: depois da janela em que as syncs da madrugada
-- já trouxeram fatura e extrato do dia anterior.
select cron.schedule(
  'facilities-nf-varredura',
  '20 12 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-nf-auditoria',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway (verify_jwt) valida ANTES de a função rodar.
      -- Sem eles a chamada morre em 401 e a função nem é executada.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      -- e o x-cron-token é o que a própria função aceita no lugar de um usuário logado
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'facilities-nf-auditoria')
    ),
    body := '{"action":"varredura","limite":20}'::jsonb
  );
  $cron$
);
