-- A triagem anda sozinha.
--
-- Medido na primeira rodada real (26/08/2026), 6 documentos: 3 viraram `nota`
-- com o valor batendo ao centavo com o título, 1 foi recusado ("é comprovante
-- de pagamento, não a nota") e 2 ficaram para gente — um recibo, e uma nota de
-- R$ 10.000 anexada a um título de R$ 3.000. Esse último é o tipo de achado que
-- só aparece porque alguém (agora, alguma coisa) abriu o arquivo.
--
-- 6 por rodada, duas rodadas por hora: a fila de 49 drena em ~4 horas e depois
-- só recebe o que a varredura de anexos descobrir de novo.
--
-- OS MINUTOS. A trava do Omie é por método e os anexos já disputam a fila em
-- `:05 :20 :35 :50` (enviar), `:12 :27 :42` (reler) e `:00 :10 :30 :40`
-- (aquecer o link). `:15` e `:45` estão livres — e, com o cache quente, a
-- triagem quase não toca o ERP: ela lê o arquivo pelo link já guardado.

select cron.unschedule('anexo-triagem-ia')
 where exists (select 1 from cron.job where jobname = 'anexo-triagem-ia');

select cron.schedule(
  'anexo-triagem-ia',
  '15,45 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/anexo-triagem',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'anexo-triagem')
    ),
    body := '{"action":"triar","limite":6}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
