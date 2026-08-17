/* ============================================================================
 * Painel CAC — a tabela que é preenchida à mão todo mês no outro sistema.
 *
 * O QUE ESTE PAINEL É. Uma matriz de custo de aquisição: linhas de custo
 * (Equipes, Investimentos, Comissões) × meses do ano. Hoje alguém abre o Omie,
 * olha os departamentos, cruza com a planilha "dados pessoais" e digita célula
 * por célula. Aqui isso passa a ser derivado, e o gesto que sobra é exportar.
 *
 * A CHAVE DE TUDO É O CNPJ, NÃO O NOME. O Omie paga "COLUNA SERVICOS DE APOIO
 * ADMINISTRATIVO LTDA"; quem trabalha aqui é a Kelly, de Field Sales. O nome do
 * favorecido é a razão social do PJ e não diz nada sobre departamento — só o
 * documento casa. É por isso que `cac_pessoas` existe: ela é o de-para
 * CNPJ → departamento que a planilha da diretoria sempre foi.
 *
 * CADA LINHA CARREGA A PRÓPRIA REGRA. Em vez de chumbar no código quais
 * categorias somam em "Agência de Marketing", a regra mora na tabela e é
 * editável na tela. Três formatos, e é a combinação que dá o resultado certo:
 *
 *   • só `departamentos`  → nunca usado sozinho (pegaria reembolso de viagem
 *                            junto com salário)
 *   • só `categorias`     → linhas que são uma rubrica inteira do Omie
 *                            (Influenciadores = 3.1.3.10 Influencer Fixo)
 *   • os dois (E lógico)  → as linhas de Equipes: pagamento a alguém DESTE
 *                            departamento E numa categoria de folha
 *
 * A terceira forma é o que faz o número fechar. Testado contra o painel real em
 * Jul/26: Inside Sales bate em R$ 71.612,50 contra R$ 71.651,00 digitados
 * (0,05%), e a diferença é gente paga fora da janela do cache. Franquia fecha
 * EXATO em R$ 35.000,00 — e só fecha porque a linha aponta para DOIS
 * departamentos ("Franquia" e "Franquias", que a planilha grafa das duas
 * formas). Influenciadores fecha exato nos quatro meses conferidos.
 *
 * REGIME É DATA DE PAGAMENTO, não competência. Foi assim que os quatro meses de
 * Influenciadores bateram, e é o que a frase "a gente preenche com os
 * pagamentos" descreve.
 * ========================================================================== */

-- ---------------------------------------------------------------------------
-- 1. As pessoas — o de-para CNPJ → departamento.
-- ---------------------------------------------------------------------------

create table if not exists public.cac_pessoas (
  id             uuid primary key default gen_random_uuid(),

  -- Só dígitos. É a chave de casamento com `cCPFCNPJCliente` do Omie, que vem
  -- pontuado e às vezes sem pontuação nenhuma — normalizar na gravação evita
  -- ter de normalizar dos dois lados em toda consulta.
  cnpj           text not null unique check (cnpj ~ '^[0-9]{11,14}$'),

  nome           text not null,

  -- O departamento da planilha, escrito como ela escreve. É o que as linhas do
  -- painel apontam. Texto livre de propósito: a planilha é a fonte, e uma FK
  -- para `lib_departamentos` recusaria "Liderança OPS" e "Franquias", que só
  -- existem aqui.
  departamento   text not null,

  -- A categoria do Omie que a planilha declara para a pessoa. NÃO é usada para
  -- somar (quem soma é a categoria do título real, que pode divergir) — fica
  -- como conferência: divergir dela é sinal de lançamento na rubrica errada.
  categoria_omie text,

  remuneracao    numeric(14,2),

  -- De qual planilha de comissão a pessoa recebe variável. Rastro da origem,
  -- para saber onde conferir uma premiação estranha.
  planilha_comissao text,

  observacao     text,
  ativo          boolean not null default true,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.cac_pessoas is
  'De-para CNPJ → departamento do painel CAC. Veio da planilha "dados pessoais"; a partir do seed é editada no Hub.';

create index if not exists cac_pessoas_departamento_idx on public.cac_pessoas (departamento) where ativo;

-- ---------------------------------------------------------------------------
-- 2. As linhas do painel e a regra de cada uma.
-- ---------------------------------------------------------------------------

create table if not exists public.cac_linhas (
  id             uuid primary key default gen_random_uuid(),

  grupo          text not null,          -- 'Equipes' | 'Investimentos' | 'Comissões'
  rotulo         text not null,
  ordem          integer not null,

  -- Regra. Vazio nos dois = linha só manual (o valor vem de cac_valores_manuais).
  departamentos  text[] not null default '{}',
  categorias     text[] not null default '{}',

  -- Explicação em português de onde o número sai, mostrada na tela ao lado da
  -- linha. Sem isto, uma linha que devolve zero é indistinguível de uma linha
  -- mal configurada.
  regra_nota     text,

  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  unique (grupo, rotulo)
);

comment on table public.cac_linhas is
  'Linhas do painel CAC e a regra de composição de cada uma. departamentos E categorias combinam com AND quando ambos estão preenchidos.';

comment on column public.cac_linhas.departamentos is
  'Departamentos de cac_pessoas cujos CNPJs entram. Array porque a planilha grafa o mesmo time de formas diferentes (Franquia/Franquias).';

-- ---------------------------------------------------------------------------
-- 3. Valor digitado à mão — histórico e correção.
-- ---------------------------------------------------------------------------

create table if not exists public.cac_valores_manuais (
  ano        integer not null,
  mes        integer not null check (mes between 1 and 12),
  linha_id   uuid not null references public.cac_linhas (id) on delete cascade,
  valor      numeric(14,2) not null,

  -- Por que este número foi digitado em vez de derivado. Jan–Mar/26 são
  -- "importado do painel antigo": o cache do Omie não alcança esses meses, e
  -- sem o motivo escrito ninguém saberá, daqui a um ano, por que aquelas
  -- células não abrem em lançamentos.
  nota       text,

  autor      uuid,
  autor_nome text,
  criado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  primary key (ano, mes, linha_id)
);

comment on table public.cac_valores_manuais is
  'Valor digitado que VENCE o cálculo do Omie para aquela célula. Usado no histórico anterior à janela do cache e em correções pontuais.';

-- ---------------------------------------------------------------------------
-- 4. RLS — mesma regra das outras tabelas de trabalho do Hub.
-- ---------------------------------------------------------------------------

alter table public.cac_pessoas         enable row level security;
alter table public.cac_linhas          enable row level security;
alter table public.cac_valores_manuais enable row level security;

drop policy if exists "auth le cac_pessoas" on public.cac_pessoas;
create policy "auth le cac_pessoas" on public.cac_pessoas
  for select to authenticated using (true);
drop policy if exists "auth escreve cac_pessoas" on public.cac_pessoas;
create policy "auth escreve cac_pessoas" on public.cac_pessoas
  for all to authenticated using (true) with check (true);

drop policy if exists "auth le cac_linhas" on public.cac_linhas;
create policy "auth le cac_linhas" on public.cac_linhas
  for select to authenticated using (true);
drop policy if exists "auth escreve cac_linhas" on public.cac_linhas;
create policy "auth escreve cac_linhas" on public.cac_linhas
  for all to authenticated using (true) with check (true);

drop policy if exists "auth le cac_valores" on public.cac_valores_manuais;
create policy "auth le cac_valores" on public.cac_valores_manuais
  for select to authenticated using (true);
drop policy if exists "auth escreve cac_valores" on public.cac_valores_manuais;
create policy "auth escreve cac_valores" on public.cac_valores_manuais
  for all to authenticated using (true) with check (true);

revoke all on public.cac_pessoas         from anon;
revoke all on public.cac_linhas          from anon;
revoke all on public.cac_valores_manuais from anon;

grant select, insert, update, delete on public.cac_pessoas         to authenticated;
grant select, insert, update, delete on public.cac_linhas          to authenticated;
grant select, insert, update, delete on public.cac_valores_manuais to authenticated;
grant all on public.cac_pessoas         to service_role;
grant all on public.cac_linhas          to service_role;
grant all on public.cac_valores_manuais to service_role;

