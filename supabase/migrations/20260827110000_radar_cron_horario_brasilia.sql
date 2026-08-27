-- Correção: o radar estava varrendo às 5h45 da manhã.
--
-- O pg_cron lê a agenda no fuso do BANCO, e o banco deste projeto é **UTC**
-- (`current_setting('TimeZone')` = UTC, conferido em 27/08/2026). Escrevi
-- `45 8 * * *` pensando em "08:45, antes de o Facilities sentar", e o que saiu
-- foi 08:45 UTC — **05:45 em Brasília**. A varredura da tarde caía às 13:45, e o
-- mapa de horários que deixei no comentário da migration anterior estava todo
-- deslocado em três horas.
--
-- Ninguém teria percebido tão cedo: o radar funcionava, achava produto e criava
-- alerta. Só estava fazendo isso na madrugada, e o "achado de hoje de manhã"
-- chegava com o café da manhã de ontem. Foi a contagem regressiva na tela que
-- obrigou a olhar o relógio de verdade.
--
-- O Brasil não tem mais horário de verão desde 2019, então UTC-3 vale o ano
-- inteiro e não há data em que isso volte a escorregar.
--
--   varrer   08:45 BRT = 11:45 UTC        confirmar 09:16 BRT = 12:16 UTC
--   varrer   16:45 BRT = 19:45 UTC        confirmar 17:16 BRT = 20:16 UTC
--
-- OS MINUTOS FORAM ESCOLHIDOS OLHANDO A AGENDA INTEIRA, em UTC, não em Brasília
-- — que era justamente o erro anterior. Às 12h UTC o projeto está lotado (asaas
-- :15, facilities-nf e omie-titulo :20, gmail :25, planilhas :40,
-- omie-clientes-criar :45, nf-sondar :50, mais os horários de 15 em 15 minutos),
-- e :16 é um dos poucos vãos livres. Daí a confirmação da manhã sair 31 minutos
-- depois da varredura, e não 30 redondos.

create extension if not exists pg_cron with schema cron;

do $$
declare
  v_token text := (select token from public.internal_cron_tokens where name = 'facilities-radar');
  v_anon  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U';
  v_url   text := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar';
  r record;
begin
  for r in
    select * from (values
      ('facilities-radar-manha',          '45 11 * * *', '{"action":"varrer","limite":20}'),
      ('facilities-radar-confirma-manha', '16 12 * * *', '{"action":"confirmar","limite":4}'),
      ('facilities-radar-tarde',          '45 19 * * *', '{"action":"varrer","limite":20,"fontes":["kabum","terabyte","buscape","zoom","bondfaro","pichau"]}'),
      ('facilities-radar-confirma-tarde', '16 20 * * *', '{"action":"confirmar","limite":4}')
    ) as t(nome, agenda, corpo)
  loop
    perform cron.unschedule(r.nome) where exists (select 1 from cron.job where jobname = r.nome);
    perform cron.schedule(r.nome, r.agenda, format(
      $sql$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey', %L,
          'Authorization', %L,
          'x-cron-token', %L
        ),
        body := %L::jsonb
      );$sql$,
      v_url, v_anon, 'Bearer ' || v_anon, v_token, r.corpo
    ));
  end loop;
end $$;
