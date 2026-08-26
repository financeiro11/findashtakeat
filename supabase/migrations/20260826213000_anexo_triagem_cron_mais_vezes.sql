-- A triagem passa a rodar 4× por hora, e não 2×.
--
-- O PEDIDO ERA "SUBIR O TETO POR RODADA". Medido contra o worker, subir o lote
-- faz o contrário do que promete:
--
--   limite 20  → WORKER_RESOURCE_LIMIT depois de 5 documentos
--   limite  6  → WORKER_RESOURCE_LIMIT depois de 4  (chamada seguinte)
--
-- A segunda morreu com um lote pequeno porque **o worker é reutilizado entre
-- invocações e rodadas seguidas dividem o mesmo orçamento** — a mesma lição já
-- escrita na `omie-anexar-comprovante`, onde a sequência medida foi 22, 17, 10,
-- 1. Lote grande não aumenta a vazão: ele queima o worker e a rodada seguinte
-- rende menos.
--
-- O QUE DE FATO SUBIU A VAZÃO foi descobrir onde o tempo ia. Medido:
-- **46 segundos por documento e 1,8 MB na rodada inteira** — o arquivo é
-- pequeno, e o relógio é espera do Gemini lendo. O worker fica ocioso nela.
--
-- Daí duas mudanças, nesta ordem, cada uma medida:
--   1. ler em paralelo            2 → 5 documentos por rodada
--   2. POOL no lugar de ondas     5 → 10
--
-- O passo 2 é o que mais rendeu, e por um motivo que só apareceu no dado: os
-- tempos de uma mesma rodada foram 15 s, 21 s, 35 s e 106 s. Com `Promise.all`
-- em ondas de quatro, três leituras prontas em 35 s ficavam paradas esperando a
-- quarta. No pool, quem termina puxa o próximo — e a rodada passou a fazer 10
-- documentos em 88 s, parando sozinha no orçamento em vez de bater na parede.
--
-- `limite: 16` não é o teto real: quem freia é o orçamento de tempo. O número
-- só precisa ser maior que o que cabe, para não ser ELE a limitar.
--
-- Com ~10 por rodada e quatro rodadas por hora, são ~40 por hora — a fila de 45
-- drena em pouco mais de uma hora, contra as dez de antes.
--
-- OS MINUTOS. Os anexos disputam a fila do Omie em `:00 :10 :30 :40` (aquecer),
-- `:05 :20 :35 :50` (enviar), `:08` (propagar), `:12 :27 :42` (reler) e `:25`
-- (gmail). `:02 :17 :32 :47` estão livres e ficam espaçados de 15 minutos entre
-- si — que é o intervalo que a `omie-anexar-comprovante` já provou ser
-- suficiente para o worker se recompor.

select cron.unschedule('anexo-triagem-ia')
 where exists (select 1 from cron.job where jobname = 'anexo-triagem-ia');

select cron.schedule(
  'anexo-triagem-ia',
  '2,17,32,47 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/anexo-triagem',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'anexo-triagem')
    ),
    body := '{"action":"triar","limite":16}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
