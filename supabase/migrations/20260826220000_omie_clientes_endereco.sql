-- O endereço do cliente no Omie, espelhado — para saber ANTES de emitir.
--
-- O BURACO QUE ISTO FECHA. `omie-clientes-sync` usa `ListarClientesResumido`, que
-- devolve `codigo`, `nome` e `cnpj_cpf` e mais nada. Como a NFS-e é recusada por
-- endereço (o Omie exige o Número; a prefeitura confere CEP × município), não
-- havia como saber se um cadastro emite senão TENTANDO EMITIR e lendo a recusa.
-- Medido em amostra aleatória de 24 clientes ativos (26/08/26): 3 sem número do
-- endereço (12,5%) e 1 sem e-mail. Sobre ~2.100 clientes ativos são ~250 recusas
-- no primeiro dia — que se consertam sozinhas no dia seguinte, mas queimam
-- capacidade e fazem o dia 1 parecer um desastre.
--
-- POR QUE TABELA E NÃO O `omie_cache`. O cache é UMA linha com um JSON de 7 mil
-- clientes, lido inteiro pela fila de emissão a cada rodada; engordá-lo com
-- endereço encareceria o caminho quente para servir uma pergunta que é fria. Aqui
-- a pergunta "quem não emite?" vira índice e `where`.
--
-- Isto é ESPELHO, não verdade: quem manda é o Omie. `lido_em` diz de quando é a
-- leitura, e nada aqui é usado para decidir emissão — só para escolher em quem
-- mexer antes dela.

create table if not exists public.omie_clientes_endereco (
  codigo          bigint primary key,
  cnpj_cpf        text,
  nome            text,
  endereco        text,
  endereco_numero text,
  complemento     text,
  bairro          text,
  cidade          text,
  estado          text,
  cep             text,
  email           text,
  -- O que a emissão exige, resolvido na gravação: é `false` que se procura.
  -- Número e logradouro o Omie recusa direto no FaturarLoteOS; o e-mail ele
  -- recusa junto ("falta preencher o Número do Endereço e o E-mail").
  emitivel        boolean generated always as (
    coalesce(nullif(btrim(endereco), ''), null) is not null
    and coalesce(nullif(btrim(endereco_numero), ''), null) is not null
    and coalesce(nullif(btrim(cep), ''), null) is not null
    and coalesce(nullif(btrim(email), ''), null) is not null
  ) stored,
  lido_em         timestamptz not null default now()
);

create index if not exists omie_clientes_endereco_doc_idx
  on public.omie_clientes_endereco (cnpj_cpf);
create index if not exists omie_clientes_endereco_emitivel_idx
  on public.omie_clientes_endereco (emitivel) where emitivel = false;

alter table public.omie_clientes_endereco enable row level security;

create policy omie_clientes_endereco_leitura
  on public.omie_clientes_endereco for select to authenticated using (true);

revoke all on public.omie_clientes_endereco from anon;

-- Onde a paginação parou. A leitura completa são ~141 páginas de 50, e uma Edge
-- Function tem 150s: sem cursor, a varredura teria de caber numa invocação ou
-- recomeçar do zero toda vez.
create table if not exists public.omie_clientes_endereco_cursor (
  id           integer primary key default 1,
  pagina       integer not null default 1,
  total_paginas integer,
  atualizado_em timestamptz not null default now(),
  constraint omie_clientes_endereco_cursor_unica check (id = 1)
);
insert into public.omie_clientes_endereco_cursor (id) values (1) on conflict do nothing;

alter table public.omie_clientes_endereco_cursor enable row level security;
create policy omie_clientes_endereco_cursor_leitura
  on public.omie_clientes_endereco_cursor for select to authenticated using (true);
revoke all on public.omie_clientes_endereco_cursor from anon;
