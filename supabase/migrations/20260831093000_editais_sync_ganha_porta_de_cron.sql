-- `editais-sync` passa a exigir quem chama — e por isso o cron precisa de crachá.
--
-- ===========================================================================
-- O QUE MUDOU DO OUTRO LADO
--
-- A função rodava com a service role e SEM checagem nenhuma: qualquer pessoa
-- com a chave pública do bundle disparava a varredura inteira de editais, que
-- gasta crédito de Firecrawl da empresa a cada chamada. Agora ela exige usuário
-- logado OU `x-cron-token`.
--
-- ===========================================================================
-- POR QUE O AGENDAMENTO TAMBÉM MUDA, e por que isso não podia ficar para depois
--
-- `editais-sync-diario` chamava `disparar_automacao` com `p_token_nome => null`
-- e `p_headers => '{}'` — ou seja, **sem Authorization e sem cron-token**.
-- Funcionava porque a função não pedia nada. Fechar a função sem dar o crachá
-- ao cron transformaria a varredura das 9h em 401 silencioso: o `net.http_post`
-- registraria a recusa em `automacao_execucao` e ninguém olharia, porque o
-- painel de automações pinta de verde quem responde — e 401 não é 2xx, mas o
-- radar de editais simplesmente pararia de trazer coisa nova, que é o tipo de
-- falha que se descobre semanas depois.
--
-- O token é lido NA HORA do disparo por `disparar_automacao`, não copiado para
-- dentro do agendamento — então rotacionar o token continua valendo no disparo
-- seguinte, sem mexer no cron.

/* ============================================================== o crachá */

-- `gen_random_uuid()` é o default da coluna; o insert só precisa do nome.
-- Idempotente: rodar de novo não troca um token que já esteja em uso.
insert into public.internal_cron_tokens (name) values ('editais-sync')
on conflict (name) do nothing;

/* ====================================================== o agendamento */

-- Mesmo horário (9h UTC) e mesmo corpo. A ÚNICA diferença é o 4º argumento,
-- que agora nomeia o token — e é ele que faz `disparar_automacao` pendurar o
-- header `x-cron-token` na chamada.
select cron.schedule(
  'editais-sync-diario',
  '0 9 * * *',
  $$
  select public.disparar_automacao(
    'editais-sync-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/editais-sync',
    jsonb_build_object('trigger','cron','time', now()),
    'editais-sync',
    '{}'::jsonb
  );
  $$
);
