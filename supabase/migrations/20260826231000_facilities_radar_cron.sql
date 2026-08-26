-- O radar passa a andar sozinho.
--
-- APLICAR SÓ DEPOIS DE A FUNÇÃO ESTAR NO AR (`npm run functions:deploy --
-- facilities-radar`). Cron apontando para função inexistente falha em silêncio:
-- o pg_net dispara, toma 404 e ninguém fica sabendo — o sintoma é uma aba de
-- radar que nunca acha nada, que é indistinguível de "não tem promoção hoje".
--
-- DUAS RODADAS, E ELAS NÃO SÃO IGUAIS:
--
--   08:45  completa — Mercado Livre + as lojas por Firecrawl. Roda antes de o
--          Facilities sentar, para o achado já estar na tela quando ele abrir.
--   16:45  só Mercado Livre. É de graça (API oficial) e pega a promoção que
--          entrou durante o dia. As lojas ficam de fora porque cada página
--          raspada custa um crédito de Firecrawl mais uma chamada de IA, e o
--          ganho de olhar a Kabum duas vezes no mesmo dia não paga isso.
--
-- POR QUE :45. Os minutos deste projeto já estão loteados e duas rodadas no
-- mesmo instante disputam o mesmo worker:
--
--   :05 :20 :35 :50  omie-anexar-comprovante     :12 :27 :42  omie-anexos-varredura
--   :20  estornos    :25  gmail-nf-sync          :30  notas-acervo-casar
--   09:10  comprovantes-drive-sync   12:20  facilities-nf   12:40  planilhas-nf-sync
--   13:00–13:50  nf-emissao (de 10 em 10)        14:15  notas-arquivar
--   18:00  nf-espelho
--
-- O minuto 45 está livre nas duas horas escolhidas.
--
-- O LIMITE DE 20 ALVOS POR RODADA NÃO É O TETO REAL — o teto é o relógio: a
-- função para aos 55s e devolve `restante`. A fila é ordenada por
-- `ultima_varredura nulls first`, então quem sobrou hoje é o primeiro amanhã.
-- Nenhum alvo fica para trás para sempre.

create extension if not exists pg_cron with schema cron;

select cron.unschedule('facilities-radar-manha')
 where exists (select 1 from cron.job where jobname = 'facilities-radar-manha');
select cron.unschedule('facilities-radar-tarde')
 where exists (select 1 from cron.job where jobname = 'facilities-radar-tarde');

select cron.schedule(
  'facilities-radar-manha',
  '45 8 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway valida ANTES de a função rodar.
      -- Sem eles a chamada morre em 401 e a função nem chega a ser executada.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'facilities-radar')
    ),
    body := '{"action":"varrer","limite":20}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'facilities-radar-tarde',
  '45 16 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'facilities-radar')
    ),
    body := '{"action":"varrer","limite":20,"fontes":["mercado_livre"]}'::jsonb
  );
  $cron$
);
