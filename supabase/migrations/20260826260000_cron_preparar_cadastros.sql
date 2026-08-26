-- O cron que drena a fila do pré-voo — de hora em hora, devagar de propósito.
--
-- POR QUE CRON E NÃO UM LAÇO. A varredura depende da BrasilAPI (Receita), e ela
-- é instável: em 26/08/26 as primeiras ~250 consultas passaram e as seguintes
-- começaram a voltar HTTP 500 em bloco. Insistir num laço só bate na mesma
-- parede mais rápido — e há cinco dias até o corte, então o tempo é o recurso
-- que sobra. Vinte clientes por hora drenam os ~330 pendentes com folga, sem
-- nenhuma rajada.
--
-- Cada invocação se mede em TEMPO (110s), não em clientes: o custo por cliente
-- varia dez vezes conforme a Receita responde ou não, e blocos de 20 já
-- derrubaram a função com IDLE_TIMEOUT. A fila é retomável, então parar no meio
-- não perde trabalho.
--
-- Não toca no Asaas: só Omie (ler e escrever o cadastro) e BrasilAPI.
select cron.schedule(
  'nf-preparar-cadastros',
  '20 * * * *',
  $job$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-clientes-criar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        current_setting('app.anon_key', true),
      'Authorization', 'Bearer ' || current_setting('app.anon_key', true),
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'omie-clientes-criar')
    ),
    body := jsonb_build_object('action', 'preparar', 'teto', 20, 'operador', 'cron')
  );
  $job$
);

-- NOTA: no banco o job está gravado com a anon key literal, como todos os outros
-- crons deste projeto. Aqui ela sai por `current_setting` para não versionar a
-- chave no repositório — este arquivo documenta o job, não o recria igual.
