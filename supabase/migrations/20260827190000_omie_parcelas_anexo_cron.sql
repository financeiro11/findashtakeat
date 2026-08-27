-- A nota chega às parcelas irmãs sozinha, de hora em hora.
--
-- O PASSIVO É GRANDE E NÃO CABE DE UMA VEZ. Medido em 27/08/2026 lendo 5.014
-- títulos do Omie: das 186 compras com nota anexada pelo Hub, **57 são
-- parceladas e têm irmã sem documento — 221 títulos ao todo**. Três foram
-- anexadas à mão para provar a ponta a ponta; o resto vem por aqui.
--
-- LOTE PEQUENO, PELO MESMO MOTIVO DA OUTRA VARREDURA. O teto do worker é de
-- CPU (baixar + zipar + base64 do arquivo), não de relógio, e quem morre no
-- meio não devolve relatório nenhum. `auditoria-anexo-varredura` já aprendeu
-- isso e roda de 15 em 15 minutos com `limite: 6`. Aqui vai `limite: 5`, de
-- hora em hora: são ~120 por dia, e o passivo drena em dois dias sem disputar
-- CPU com a varredura principal.
--
-- MINUTO :53 porque os outros estão ocupados. A cada hora este projeto já roda
-- em :02 :05 :08 :12 :17 :20 :25 :27 :30 :32 :35 :40 :42 :47 :50 — e duas
-- rodadas no mesmo instante disputam o mesmo worker.
--
-- `simular: false` aqui é deliberado: o cron É o lote controlado que foi
-- aprovado. Quem chama pela tela sem passar nada continua caindo em simulação,
-- que é o padrão seguro da ação.
--
-- O QUE ELE NÃO FAZ: proposta marcada como `ambigua` nasce em `proposto` e o
-- cron não a toca — ele drena só `confirmado`. Duas compras iguais do mesmo
-- fornecedor no mesmo plano precisam de gente olhando a nota.

create extension if not exists pg_cron with schema cron;

select cron.unschedule('omie-parcelas-anexo')
 where exists (select 1 from cron.job where jobname = 'omie-parcelas-anexo');

select cron.schedule(
  'omie-parcelas-anexo',
  '53 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexar-comprovante',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-anexar-comprovante')
    ),
    body := '{"action":"parcelas","simular":false,"limite":5}'::jsonb
  );
  $cron$
);
