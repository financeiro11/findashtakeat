-- Rodada diária que cadastra no Omie o cliente que só existe no Asaas.
--
-- POR QUE DIÁRIA E POR QUE NESTE HORÁRIO. A fila de emissão lê o cadastro; um
-- cliente que assinou ontem e pagou hoje precisa estar no Omie ANTES de a
-- emissão rodar, senão a cobrança dele some da fila sem erro e ninguém fica
-- sabendo (é o buraco que a aba Auditoria mede). A emissão é a `nf-emissao-diaria`,
-- às 13:00 UTC; esta roda 12:45 UTC (09:45 em São Paulo), quinze minutos antes,
-- e já deixa o cliente novo no espelho do cadastro para a rodada seguinte achar.
--
-- Ordem do dia, para quem for mexer nos horários:
--   11:40 asaas-janela-sync   → a cobrança de ontem entra no espelho
--   12:45 omie-clientes-criar → o cliente dela ganha cadastro no Omie   (esta)
--   13:00 nf-emissao-diaria   → a nota sai
--
-- `teto: 25` por rodada não é timidez: cada cliente custa uma consulta à Receita
-- (ou ao CEP) mais um IncluirCliente, e a fila normal do dia a dia é de poucos
-- clientes. O teto existe para o dia atípico — uma carga histórica que despeja
-- centenas de faltantes de uma vez — em que sair criando tudo numa tacada
-- estouraria o tempo da função e o limite do Omie. O que sobra volta amanhã, e a
-- tela tem o botão para quem não quiser esperar.

insert into public.internal_cron_tokens (name)
select 'omie-clientes-criar'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'omie-clientes-criar'
);

select cron.unschedule('omie-clientes-criar-diario')
where exists (select 1 from cron.job where jobname = 'omie-clientes-criar-diario');

select cron.schedule(
  'omie-clientes-criar-diario',
  '45 12 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-clientes-criar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway (verify_jwt) valida ANTES de a função rodar.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      -- e o x-cron-token é o que a própria função aceita no lugar de um usuário logado
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-clientes-criar')
    ),
    -- Sem `docs` e sem `forcar`: a rodada automática só pega quem não tem
    -- bloqueio nenhum. Divergente é decisão humana e não entra em cron.
    body := jsonb_build_object('action', 'criar', 'teto', 25, 'trigger', 'cron')
  );
  $cron$
);
