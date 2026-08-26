-- A caixa lida de hora em hora.
--
-- POR QUE DE HORA EM HORA, e não uma vez por dia como as planilhas: a nota do
-- fornecedor chega junto com o boleto, e o boleto vence. Quanto antes ela está
-- no Hub, mais cedo a auditoria para de cobrar e mais cedo o arquivo pode subir
-- ao ERP. É a fonte mais "ao vivo" das quatro.
--
-- O TETO POR RODADA É BAIXO de propósito (12 mensagens). Cada uma custa uma
-- chamada `messages.get`, mais uma por anexo, mais o upload no bucket — e o
-- worker tem orçamento de CPU, não de relógio. Doze por hora dão 288 por dia,
-- muito acima das ~135 mensagens com anexo que a caixa recebe por mês. A fila
-- anda sozinha; `restante` na resposta diz quanto falta.
--
-- A PRIMEIRA CARGA É OUTRA HISTÓRIA: o histórico anterior a maio/2026 nunca foi
-- lido por ninguém. Para isso, chame à mão com `{"dias": 3650, "limite": 40}`
-- algumas vezes — o cron sozinho levaria meses para alcançar o passado.

insert into public.internal_cron_tokens (name)
select 'gmail-nf-sync'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'gmail-nf-sync'
);

select cron.unschedule('gmail-nf-sync-horaria')
where exists (select 1 from cron.job where jobname = 'gmail-nf-sync-horaria');

-- Aos 25 de cada hora: longe dos :00, onde já se acotovelam as outras rotinas.
select cron.schedule(
  'gmail-nf-sync-horaria',
  '25 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/gmail-nf-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway (verify_jwt) valida ANTES de a função rodar.
      -- Sem eles a chamada morre em 401 e a função nem é executada.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      -- e o x-cron-token é o que a própria função aceita no lugar de um usuário logado
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'gmail-nf-sync')
    ),
    body := '{"action":"sync","dias":30,"limite":12}'::jsonb
  );
  $cron$
);
