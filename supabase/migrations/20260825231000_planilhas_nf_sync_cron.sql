-- As cinco planilhas de NF, lidas todo dia.
--
-- Por que diário e não sob demanda: as duas pontas se mexem sozinhas. Do lado da
-- planilha, alguém manda uma nota hoje para um PIX que só será pago semana que
-- vem; do lado do ERP, o `omie-pix-sync` traz lançamentos novos todo mês. Uma
-- rodada única, no dia em que alguém lembrar, casa só o que já existia naquele
-- instante — e a nota que chega depois nunca mais é procurada. Foi assim que o
-- anexo no Omie ficou parado em 81 achados e 44 lançamentos, esperando alguém
-- apertar um botão.
--
-- É barato repetir: a `chave` é `fonte|linha|driveId`, então reler as mesmas
-- 2.326 notas cai nos mesmos registros, e o casamento só reprocessa quem ainda
-- não virou ação.
--
-- ELA NÃO ANEXA NADA. Só lê, casa e confere. Subir arquivo para o ERP continua
-- sendo um clique de gente, na fila `fila_erp`.

insert into public.internal_cron_tokens (name)
select 'planilhas-nf-sync'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'planilhas-nf-sync'
);

select cron.unschedule('planilhas-nf-sync-diaria')
where exists (select 1 from cron.job where jobname = 'planilhas-nf-sync-diaria');

-- 12:40 UTC ≈ 09:40 em São Paulo: vinte minutos depois da varredura do
-- Facilities, para as duas não disputarem worker.
select cron.schedule(
  'planilhas-nf-sync-diaria',
  '40 12 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/planilhas-nf-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway (verify_jwt) valida ANTES de a função rodar.
      -- Sem eles a chamada morre em 401 e a função nem é executada.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      -- e o x-cron-token é o que a própria função aceita no lugar de um usuário logado
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'planilhas-nf-sync')
    ),
    body := '{"action":"sync"}'::jsonb
  );
  $cron$
);
