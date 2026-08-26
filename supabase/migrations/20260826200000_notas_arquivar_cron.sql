-- A cópia do acervo passa a andar sozinha, uma vez por dia.
--
-- SEM ISTO A PROTEÇÃO ENVELHECE. A carga inicial copiou 2.654 arquivos para o
-- bucket do projeto, mas a `notas-arquivar` só roda quando alguém chama — então
-- toda nota nova que entra pelas cinco planilhas nasce apontando só para o Drive
-- de quem preencheu, e a fila volta a subir sem ninguém notar. O ponto da cópia
-- é justamente não depender de alguém lembrar.
--
-- UMA VEZ POR DIA BASTA, e isso é medido, não chutado: a chegada de nota com
-- link do Drive é de **8 a 14 por dia** (abr/26: 8,4 · mai: 12,7 · jun: 13,8 ·
-- jul: 13,6 · ago: 8,8). Uma rodada copia ~20 em 55 s — o teto real não é o
-- `limite` do corpo, é o orçamento de relógio do worker. Sobra folga para um
-- dia atípico, e o que não couber espera o dia seguinte sem perder nada.
--
-- O RELÓGIO NÃO É ARBITRÁRIO. Os minutos deste projeto já estão loteados, e
-- duas rodadas no mesmo instante disputam o mesmo Omie ou o mesmo worker:
--
--   :05 :20 :35 :50  omie-anexar-comprovante     :12 :27 :42  omie-anexos-varredura
--   :20  estornos    :25  gmail-nf-sync          :30  notas-acervo-casar
--   09:10  comprovantes-drive-sync   12:20  facilities-nf   12:40  planilhas-nf-sync
--   13:00–13:50  nf-emissao (de 10 em 10)        18:00  nf-espelho
--
-- **14:15** é o primeiro vão livre DEPOIS de as fontes terem lido o dia: as
-- planilhas entram 12:40 e a emissão de NF ocupa até 13:50. Copiar antes disso
-- seria copiar o acervo de ontem.
--
-- Esta função NÃO fala com o Omie: ela lê o Drive e escreve no bucket. Então o
-- risco de colisão aqui é de worker, não de trava de ERP — mais um motivo para
-- ficar longe da janela das 13h, que é a mais cheia.

create extension if not exists pg_cron with schema cron;

/* O token de cron. `gen_random_uuid()` sem hífen é o mesmo formato dos outros
   28 desta tabela. `on conflict do nothing` para reaplicar a migration não
   trocar o token de baixo dos pés de um cron que já funciona. */
insert into public.internal_cron_tokens (name, token)
values ('notas-arquivar', replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

select cron.unschedule('notas-arquivar-diaria')
 where exists (select 1 from cron.job where jobname = 'notas-arquivar-diaria');

select cron.schedule(
  'notas-arquivar-diaria',
  '15 14 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/notas-arquivar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway valida ANTES de a função rodar.
      -- Sem eles a chamada morre em 401 e a função nem chega a ser executada.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      -- e o x-cron-token é o que a função aceita no lugar de um usuário logado
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'notas-arquivar')
    ),
    body := '{"action":"copiar","limite":60}'::jsonb
  );
  $cron$
);

comment on function public.notas_externas_para_arquivar(integer) is
  'A fila da cópia durável, na ordem do risco: primeiro o que veio das planilhas (Drive de uma pessoa), depois nota fiscal antes de boleto, e a mais antiga primeiro. Consumida pela Edge Function notas-arquivar, no cron `notas-arquivar-diaria` (14:15).';
