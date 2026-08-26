-- A fila de conferência chega aquecida.
--
-- Guardar o link resolvia o SEGUNDO clique. O primeiro continuava pagando a
-- espera do Omie — e o primeiro é o que a pessoa sente, porque é o único que
-- ela dá em cada anexo da fila.
--
-- Este cron enche o cache antes: 8 títulos a cada 10 minutos dá 48 por hora,
-- e a fila de "Anexo a conferir" tem 32. Em uma hora ela está inteira quente e
-- assim se mantém, porque o link vale 6 horas e a `omie_anexo_link_fila` só
-- devolve quem está a menos de 90 minutos de vencer.
--
-- O MINUTO NÃO É ARBITRÁRIO. A trava do Omie é por método e os anexos já têm
-- dois trabalhos disputando a fila: `:05 :20 :35 :50` (enviar) e `:12 :27 :42`
-- (reler). Este entra nos minutos vagos.

insert into public.internal_cron_tokens (name, token)
select 'omie-anexo-abrir', encode(gen_random_bytes(24), 'hex')
 where not exists (select 1 from public.internal_cron_tokens where name = 'omie-anexo-abrir');

select cron.unschedule('anexo-link-aquecer')
 where exists (select 1 from cron.job where jobname = 'anexo-link-aquecer');

select cron.schedule(
  'anexo-link-aquecer',
  '0,10,30,40 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexo-abrir',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'omie-anexo-abrir')
    ),
    body := '{"action":"aquecer","limite":8}'::jsonb
  );
  $cron$
);
