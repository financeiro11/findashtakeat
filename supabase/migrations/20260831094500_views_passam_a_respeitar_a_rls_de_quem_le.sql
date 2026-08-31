-- Quatro views passam a ler com o crachá de quem chamou. A quinta NÃO — e o
-- porquê é a parte que vale ler.
--
-- ===========================================================================
-- O QUE É "SECURITY DEFINER VIEW"
--
-- View criada sem `security_invoker` lê as tabelas com os poderes do DONO dela
-- (aqui, `postgres`), e não com os de quem fez o SELECT. Isso significa que ela
-- ignora a RLS das tabelas de baixo: quem conseguir ler a view lê tudo o que a
-- view retorna, tenha ou não direito às linhas originais.
--
-- Depois da migration `20260830233000` o `anon` não alcança mais nenhuma destas
-- views — conferido, `has_table_privilege('anon', ..., 'select')` é falso nas
-- cinco. Então o buraco para a internet já está fechado; o que sobra é a
-- diferença DENTRO do Hub, entre cargos. Vale fechar assim mesmo: é a única
-- linha que separa "hoje todo cargo lê tudo mesmo" de "quando existir um cargo
-- restrito, a view fura a restrição sem ninguém perceber".

/* ============================================ 1. as quatro que podem virar */

-- Conferido antes de mexer: as tabelas de baixo destas quatro têm policy de
-- leitura para `authenticated` (`notas_externas_leitura`, `envio_log_leitura`,
-- `leitura_autenticados`). Ou seja, ligar `security_invoker` não muda uma linha
-- do que a tela mostra hoje — muda de QUEM é o crachá usado para buscá-la.

alter view public.notas_externas_parada    set (security_invoker = on);
alter view public.omie_anexo_quarentena    set (security_invoker = on);
alter view public.vw_orcamento_area        set (security_invoker = on);
alter view public.vw_orcamento_area_linha  set (security_invoker = on);

/* ================================= 2. a que NÃO pode, e isto é de propósito */

-- `cac_pagamentos` lê `omie_cache`, e `omie_cache` tem RLS LIGADA E NENHUMA
-- POLICY — de propósito: quem escreve e lê aquela tabela são as Edge Functions,
-- com service role, que ignora RLS. Nenhum usuário do Hub tem direito a ela.
--
-- Consequência: ligar `security_invoker` aqui faria a view devolver ZERO LINHAS
-- para todo mundo. E o pior é o modo de falhar — RLS sem policy não dá erro,
-- devolve vazio. O painel CAC não quebraria: ele mostraria tudo zerado, com
-- cara de "não houve pagamento no período", e alguém tomaria decisão em cima
-- disso. É a armadilha descrita em `omie-cache-rls-sem-policy`.
--
-- Então o `security definer` desta view é ESTRUTURAL: é ele que dá ao painel
-- uma janela estreita e só de leitura para `omie_cache`, sem abrir a tabela
-- inteira para o Hub. Trocar isso exigiria uma policy de leitura em
-- `omie_cache`, que é o oposto de fechar.
--
-- O `comment` abaixo existe para a próxima pessoa que rodar o advisor de
-- segurança, ver `security_definer_view` marcado como ERROR nesta view e for
-- "consertar". O conserto é que quebra.

comment on view public.cac_pagamentos is
  'SECURITY DEFINER DE PROPÓSITO — não ligue security_invoker. Lê `omie_cache`, que tem RLS sem policy (tabela de service role). Com security_invoker esta view devolve ZERO LINHAS sem dar erro, e o painel CAC passa a mostrar tudo zerado como se não houvesse pagamento. Ver a migration 20260831094500.';
