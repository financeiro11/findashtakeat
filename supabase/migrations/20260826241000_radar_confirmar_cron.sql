-- A confirmação anda sozinha, meia hora depois de cada varredura.
--
-- SEM ISTO O RADAR PARA DE AVISAR. O achado passou a nascer em quarentena
-- (`a_confirmar`) e só vira aviso depois que alguém abre o anúncio e confere
-- estoque e frete. A varredura não faz isso na mesma rodada porque não cabe: são
-- ~40s por fonte mais ~15s por anúncio conferido, contra um orçamento de 55s e
-- um worker que morre aos 150s. Se a confirmação não rodar, os achados ficam
-- todos parados na quarentena e a tela fica eternamente vazia — funcionando,
-- mas em silêncio, que é o pior jeito de quebrar.
--
-- MEIA HORA DEPOIS, e não junto: dá folga para a varredura terminar (inclusive
-- quando ela estoura o relógio e deixa alvo para trás) e mantém as duas em
-- minutos livres. O mapa de horários deste projeto:
--
--   :05 :20 :35 :50  omie-anexar-comprovante     :12 :27 :42  omie-anexos-varredura
--   :20  estornos    :25  gmail-nf-sync          :30  notas-acervo-casar
--   08:45  radar-varre      09:15  radar-confirma
--   09:10  comprovantes-drive-sync   12:20  facilities-nf   12:40  planilhas-nf-sync
--   13:00–13:50  nf-emissao          14:15  notas-arquivar
--   16:45  radar-varre      17:15  radar-confirma      18:00  nf-espelho
--
-- O LIMITE DE 6 POR RODADA É MEDIDO. Com 9 anúncios em paralelo, 7 voltaram com
-- erro de leitura — o Firecrawl não gosta de rajada. Com 6, a taxa de erro caiu.
-- Quem não couber fica na fila e é pego na rodada seguinte; quem não abrir em
-- 48h de tentativas é descartado com o motivo escrito, para a fila não encher de
-- link morto consumindo crédito todo dia.

create extension if not exists pg_cron with schema cron;

select cron.unschedule('facilities-radar-confirma-manha')
 where exists (select 1 from cron.job where jobname = 'facilities-radar-confirma-manha');
select cron.unschedule('facilities-radar-confirma-tarde')
 where exists (select 1 from cron.job where jobname = 'facilities-radar-confirma-tarde');

select cron.schedule(
  'facilities-radar-confirma-manha',
  '15 9 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'facilities-radar')
    ),
    body := '{"action":"confirmar","limite":6}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'facilities-radar-confirma-tarde',
  '15 17 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'facilities-radar')
    ),
    body := '{"action":"confirmar","limite":6}'::jsonb
  );
  $cron$
);
