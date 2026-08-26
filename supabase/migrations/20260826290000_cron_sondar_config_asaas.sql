-- Sonda diária de "de quem é a nota", entre o cadastro e a emissão.
--
-- Assinatura nova nasce sem sondagem, e `tem_config is null` NÃO emite — a fila
-- fecha no escuro de propósito, porque o erro caro do período de paralelo é a
-- nota dupla. Só que fechar no escuro é silencioso: sem rotina, um cliente novo
-- simplesmente nunca teria nota pelo Hub e ninguém saberia.
--
-- 12h50 UTC é entre `omie-clientes-criar-diario` (12h45, que prepara o cadastro)
-- e `nf-emissao-diaria` (13h). A ordem das três não é gosto: cada uma deixa
-- pronto o que a seguinte lê.
select cron.schedule(
  'nf-sondar-config-asaas',
  '50 12 * * *',
  $job$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        current_setting('app.anon_key', true),
      'Authorization', 'Bearer ' || current_setting('app.anon_key', true),
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-nfse-sync')
    ),
    body := jsonb_build_object('action', 'sondar_nf_asaas', 'teto', 150)
  );
  $job$
);
-- NOTA: no banco o job está gravado com a anon key literal, como os demais crons
-- deste projeto; aqui ela sai por `current_setting` para não versionar a chave.
