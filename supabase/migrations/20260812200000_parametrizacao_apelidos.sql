-- Parametrização: o nome que a contraparte tem para NÓS.
--
-- A dor: numa reunião alguém aponta uma linha da DRE e pergunta o que é. O que
-- está escrito é o que o adquirente mandou — "JIM.COM GRUPO SOUZA" — e esse nome
-- nunca foi feito para ser lido por gente. Não são milhares de coisas a nomear:
-- são ~336 lojistas de cartão e ~382 fornecedores no Omie, e uma vez só.
--
-- ONDE MORA: nada de tabela nova. `lib_fornecedores` já é o cadastro (302 linhas
-- vindas do Omie) e `contrapartes_alias` já resolve "a mesma coisa escrita de N
-- jeitos" (195 grafias). Faltavam só as três colunas que dão SIGNIFICADO ao
-- cadastro — hoje a `observacao` de todo mundo é o carimbo "Importado do Omie".
--
-- POR QUE A FILA NÃO É SEMEADA: um INSERT de 336 lojistas resolveria hoje e
-- envelheceria na próxima fatura. As RPCs abaixo leem `cartao_lancamentos` e
-- `omie_cache` direto, então lojista novo entra na fila sozinho — para sempre.
--
-- POR QUE O CASAMENTO NÃO É FEITO EM SQL: a chave normalizada (sem acento, sem
-- pontuação, sem sufixo societário) já existe em `src/lib/pessoasPJ.ts` e é
-- testada lá. Reescrevê-la aqui criaria dois normalizadores que divergem no
-- primeiro caso esquisito. Estas RPCs devolvem os ~700 candidatos com contexto e
-- QUEM FILTRA É O CLIENTE, com a mesma função que casa o nome na hora de exibir.

-- ---------------------------------------------------------------------------
-- 1. As três colunas que faltavam
-- ---------------------------------------------------------------------------

alter table public.lib_fornecedores
  add column if not exists apelido text,
  add column if not exists o_que_e text,
  add column if not exists dono_id uuid references public.lib_colaboradores(id) on delete set null,
  add column if not exists origem  text not null default 'omie';

comment on column public.lib_fornecedores.apelido is
  'O nome curto que aparece na DRE/DFC no lugar da razão social. "Café dos eventos".';
comment on column public.lib_fornecedores.o_que_e is
  'A frase que se responde quando perguntam o que é este lançamento.';
comment on column public.lib_fornecedores.dono_id is
  'Quem na Takeat contratou. A saída de emergência: se ninguém souber, sabe-se a quem perguntar.';
comment on column public.lib_fornecedores.origem is
  'De onde a contraparte veio: omie | cartao | manual.';

-- Parcial: só interessa procurar quem JÁ tem nome.
create index if not exists lib_fornecedores_apelido_idx
  on public.lib_fornecedores (apelido)
  where apelido is not null and btrim(apelido) <> '';

create index if not exists lib_fornecedores_origem_idx
  on public.lib_fornecedores (origem);

-- ---------------------------------------------------------------------------
-- 2. Os candidatos a nomear, com o contexto que faz alguém lembrar
-- ---------------------------------------------------------------------------
--
-- Devolve as duas naturezas juntas (cartão e Omie) porque a tela é uma só. O
-- contexto — quantas vezes, quanto, desde quando, em que cidade, em que
-- categoria — é o que resolve o caso real: na hora de nomear você TAMBÉM não
-- lembra, mas "2 compras, Mogi das Cruzes, Eventos e Feiras, R$ 4.292, maio e
-- julho" acende a luz.

create or replace function public.parametrizacao_contrapartes()
returns table (
  origem     text,
  nome       text,
  documento  text,
  categoria  text,
  cidade     text,
  lancamentos bigint,
  total      numeric,
  primeira   date,
  ultima     date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  -- Lado do cartão: o lojista sai do OFX já canônico (`limparNome` funde
  -- "ANTHROPIC* CLAUDE SU" e "ANTHROPICV" num "ANTHROPIC" só).
  cartao as (
    select
      'cartao'::text as origem,
      cl.estabelecimento as nome,
      null::text as documento,
      mode() within group (order by cl.categoria) as categoria,
      mode() within group (order by cl.cidade) as cidade,
      count(*)::bigint as lancamentos,
      round(sum(abs(cl.valor)), 2) as total,
      min(cl.data) as primeira,
      max(cl.data) as ultima
    from public.cartao_lancamentos cl
    where coalesce(btrim(cl.estabelecimento), '') <> ''
    group by cl.estabelecimento
  ),

  -- Lado do Omie: mesma cascata de nome do drill-down (cadastro do Omie
  -- limpo -> lib_fornecedores por documento), para a fila falar a MESMA língua
  -- que a tela onde o apelido vai aparecer.
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from public.omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from public.omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from public.omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  omie as (
    select
      'omie'::text as origem,
      coalesce(nullif(btrim(cli.nome), ''), f.nome) as nome,
      -- mode(), e não o documento do título: o mesmo fornecedor chega ora com
      -- CNPJ ora sem, e agrupar pelos dois partiria a contraparte em duas linhas
      -- na fila — duas vezes o mesmo trabalho de nomear.
      mode() within group (order by nullif(det->>'cCPFCNPJCliente', '')) as documento,
      mode() within group (order by coalesce(c.descricao, det->>'cCodCateg')) as categoria,
      null::text as cidade,
      count(*)::bigint as lancamentos,
      round(sum(abs((det->>'nValorTitulo')::numeric)), 2) as total,
      min(to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao'), ''), 'DD/MM/YYYY')) as primeira,
      max(to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao'), ''), 'DD/MM/YYYY')) as ultima
    from mov
    left join cli on cli.codigo = det->>'nCodCliente'
    left join cat c on c.codigo = det->>'cCodCateg'
    left join public.lib_fornecedores f
      on regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') =
         regexp_replace(coalesce(det->>'cCPFCNPJCliente', ''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> ''
    where upper(coalesce(det->>'cNatureza', 'R')) similar to '(P|D)%'
      -- O balde da fatura de cartão é UMA contraparte no Omie para milhares de
      -- compras. Nomeá-la não responde nada: quem responde é o lojista, que já
      -- está no lado do cartão acima.
      and not (
        lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%cart%o%'
        and (lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lancamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lançamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%fatura%')
      )
      and coalesce(nullif(btrim(cli.nome), ''), f.nome) is not null
    group by 2
  )

  select * from cartao
  union all
  select * from omie;
$$;

comment on function public.parametrizacao_contrapartes() is
  'Todos os candidatos a apelido (lojista do cartão + fornecedor do Omie) com o contexto que faz lembrar. Quem separa nomeado de anônimo é o cliente, com a chave normalizada do TS.';

-- ---------------------------------------------------------------------------
-- 3. Os lançamentos de UMA contraparte — o painel de contexto
-- ---------------------------------------------------------------------------

create or replace function public.parametrizacao_lancamentos(
  p_origem text,
  p_nome   text,
  p_limite int default 60
)
returns table (
  data      date,
  descricao text,
  categoria text,
  cidade    text,
  valor     numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from public.omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias' and p_origem = 'omie'
  ),
  cli as (
    select distinct on (c->>'codigo')
      c->>'codigo' as codigo,
      coalesce(
        nullif(btrim(regexp_replace(
          regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
          '\s+\d{11}$', '')), ''),
        c->>'nome'
      ) as nome
    from public.omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes' and p_origem = 'omie'
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from public.omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos' and p_origem = 'omie'
  )
  select
    cl.data,
    cl.descricao,
    cl.categoria,
    cl.cidade,
    -abs(cl.valor) as valor
  from public.cartao_lancamentos cl
  where p_origem = 'cartao'
    and upper(btrim(cl.estabelecimento)) = upper(btrim(p_nome))

  union all

  select
    to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao'), ''), 'DD/MM/YYYY') as data,
    coalesce(nullif(det->>'cNumTitulo', ''), det->>'nCodTitulo') as descricao,
    coalesce(c.descricao, det->>'cCodCateg') as categoria,
    null::text as cidade,
    -abs((det->>'nValorTitulo')::numeric) as valor
  from mov
  left join cli on cli.codigo = det->>'nCodCliente'
  left join cat c on c.codigo = det->>'cCodCateg'
  left join public.lib_fornecedores f
    on regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') =
       regexp_replace(coalesce(det->>'cCPFCNPJCliente', ''), '\D', '', 'g')
   and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> ''
  where p_origem = 'omie'
    and upper(btrim(coalesce(nullif(btrim(cli.nome), ''), f.nome, ''))) = upper(btrim(p_nome))

  order by 1 desc
  limit greatest(1, least(coalesce(p_limite, 60), 500));
$$;

comment on function public.parametrizacao_lancamentos(text, text, int) is
  'Os lançamentos de uma contraparte, para lembrar o que ela é antes de dar nome.';

-- ---------------------------------------------------------------------------
-- 4. Compatibilidade: `contrapartes_pessoas` vira janela do cadastro único
-- ---------------------------------------------------------------------------
--
-- "Razão social que é pessoa" (Dalber) e "lojista que é o café do evento" são o
-- MESMO gesto: um nome cru entra, um nome legível sai. Manter dois cadastros
-- obrigaria a lembrar em qual deles procurar.
--
-- A tabela nasceu em 20260811140000 e nunca recebeu uma linha, então não há o
-- que migrar. Vira VIEW sobre o cadastro único — e assim as edge functions JÁ
-- DEPLOYADAS (`demonstracoes-justificar`, `demonstracoes-perguntar`, `ai-chat`,
-- `assistente-responder`) continuam lendo o mesmo nome de sempre e passam a
-- enxergar os apelidos novos SEM redeploy. Ver a nota sobre redeploy em
-- _shared/pessoas-pj.ts.
--
-- Uma linha por GRAFIA: o mesmo fornecedor pode chegar escrito de vários jeitos,
-- e o consumidor casa por nome.

drop table if exists public.contrapartes_pessoas;

create or replace view public.contrapartes_pessoas
with (security_invoker = true)
as
  select
    f.id,
    f.nome,
    f.apelido    as pessoa,
    f.documento,
    f.o_que_e    as observacao,
    f.status
  from public.lib_fornecedores f
  where coalesce(btrim(f.apelido), '') <> ''

  union

  select
    f.id,
    a.alias      as nome,
    f.apelido    as pessoa,
    f.documento,
    f.o_que_e    as observacao,
    f.status
  from public.lib_fornecedores f
  join public.contrapartes_alias a on a.fornecedor_id = f.id
  where coalesce(btrim(f.apelido), '') <> '';

comment on view public.contrapartes_pessoas is
  'Compatibilidade: era tabela (20260811140000, sempre vazia) e virou janela sobre lib_fornecedores.apelido. Uma linha por grafia conhecida.';

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- Função nova em `public` nasce chamável sem login: o `anon` herda o grant de
-- `public`. Revogar só de `public` não resolve — precisa ser de `anon` também.

revoke all on function public.parametrizacao_contrapartes() from public, anon;
revoke all on function public.parametrizacao_lancamentos(text, text, int) from public, anon;

grant execute on function public.parametrizacao_contrapartes() to authenticated, service_role;
grant execute on function public.parametrizacao_lancamentos(text, text, int) to authenticated, service_role;

revoke all on public.contrapartes_pessoas from anon;
grant select on public.contrapartes_pessoas to authenticated, service_role;