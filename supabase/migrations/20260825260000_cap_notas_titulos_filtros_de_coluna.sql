-- A lista de títulos passa a ser filtrável por coluna.
--
-- O QUE FALTAVA. A aba Títulos filtrava por situação, por gravidade e por um
-- campo de busca — e as outras quatro colunas da tabela (categoria, conta, valor
-- e competência) eram só leitura. Quem abre "R$ 1,21 mi urgentes" e quer ver só
-- o que é software, ou só o que saiu do cartão, ou só o que passa de R$ 5 mil,
-- não tinha caminho: sobrava rolar 60 linhas por página.
--
-- A RPC já aceitava `p_categoria` e `p_conta`, mas no SINGULAR e por código — o
-- que serve para um link, não para uma coluna: filtro de coluna é marcar três
-- itens de uma lista. Entram as versões em array, mais faixa de valor e faixa de
-- mês, todas no fim da assinatura para não mexer na ordem do que já existia.
--
-- O QUE FILTRA PELO CÓDIGO E O QUE MOSTRA O NOME. Categoria e conta são cortadas
-- por `categoria_codigo` / `conta_codigo`, não pelo texto exibido: o nome vem de
-- `coalesce(cc.nome, 'conta ' || codigo)` e muda quando alguém renomeia a conta
-- no Omie — um filtro salvo pelo nome apontaria para o nada no dia seguinte. O
-- código vazio ('') representa "sem categoria" / "sem conta", que existem na base
-- e precisavam de um valor marcável em vez de sumir da lista.

/* ============================================================================
 *  1. As opções de cada coluna — o que a lista tem, não o que o plano de contas
 *     tem
 * ==========================================================================
 * As facetas saem do PERÍODO INTEIRO e não do recorte já filtrado. É a diferença
 * entre um filtro que se pode ajustar e um que se fecha sozinho: se as opções
 * fossem do resultado corrente, marcar "Softwares" apagaria todas as outras
 * categorias da lista e não haveria como trocar de ideia sem limpar tudo.
 *
 * E vêm com a contagem ao lado: "Softwares - Marketing 42" responde antes do
 * clique se vale a pena clicar. */

create or replace function public.cap_notas_facetas(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select * from public.cap_titulos where competencia between p_de and p_ate
)
select jsonb_build_object(
  'categorias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'valor', cod, 'rotulo', rot, 'titulos', n
    ) order by rot), '[]'::jsonb)
    from (
      select coalesce(categoria_codigo, '') as cod,
             coalesce(categoria, '(sem categoria)') as rot,
             count(*) as n
      from base group by 1, 2
    ) t
  ),
  'contas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'valor', cod, 'rotulo', rot, 'titulos', n
    ) order by rot), '[]'::jsonb)
    from (
      select coalesce(conta_codigo, '') as cod,
             coalesce(conta, '(sem conta)') as rot,
             count(*) as n
      from base group by 1, 2
    ) t
  ),
  -- Só os meses que a lista realmente toca: oferecer um mês vazio é oferecer um
  -- clique que devolve tela em branco.
  'meses', (
    select coalesce(jsonb_agg(m order by m), '[]'::jsonb)
    from (
      select distinct to_char(date_trunc('month', competencia), 'YYYY-MM') as m
      from base where competencia is not null
    ) t
  ),
  -- Os extremos do valor, para a faixa dizer o que está em jogo antes de digitar.
  'valor', (
    select jsonb_build_object(
      'min', coalesce(round(min(valor)::numeric, 2), 0),
      'max', coalesce(round(max(valor)::numeric, 2), 0)
    ) from base
  )
);
$function$;

comment on function public.cap_notas_facetas(date, date) is
  'As opções de cada filtro de coluna da aba Títulos — categorias, contas e meses que existem no período, com a contagem de títulos. Saem do período inteiro, não do recorte já filtrado.';

/* ============================================================================
 *  2. A lista, com os cortes de coluna
 * ========================================================================== */

create or replace function public.cap_notas_titulos(
  p_de date, p_ate date,
  p_situacoes text[] default null,
  p_categoria text default null,
  p_conta text default null,
  p_busca text default null,
  p_gravidades text[] default null,
  p_limite integer default 200,
  p_offset integer default 0,
  -- Os filtros de coluna. No fim de propósito: a ordem do que já existia não
  -- muda, então o `Revisar` da mesma tela (que chama por nome, só com situação e
  -- limite) continua valendo sem alteração.
  p_categorias text[] default null,
  p_contas text[] default null,
  p_valor_min numeric default null,
  p_valor_max numeric default null,
  p_mes_de text default null,
  p_mes_ate text default null
)
returns table(
  cod_titulo bigint, favorecido text, favorecido_cru text, tem_apelido boolean,
  observacao text, doc text, categoria text, categoria_codigo text,
  conta text, valor numeric, competencia date, vencimento date, pagamento date,
  situacao text, gravidade text, anexos_no_erp integer, anexos jsonb,
  anexo_classe text, anexo_revisao text,
  nota_no_hub text, enviado_em timestamptz,
  nf_no_campo text, documento text, erro_leitura text, anexo_lido_em timestamptz,
  total_geral bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select t.*, tx.observacao
  from public.cap_titulos t
  left join public.omie_titulo_texto tx on tx.cod_titulo = t.cod_titulo
  where t.competencia between p_de and p_ate
    and (p_situacoes is null or t.situacao = any(p_situacoes))
    and (p_gravidades is null or t.gravidade = any(p_gravidades))
    and (p_categoria is null or t.categoria_codigo = p_categoria)
    and (p_conta is null or t.conta_codigo = p_conta)
    -- Os cortes de coluna. `coalesce(..., '')` porque "sem categoria" e "sem
    -- conta" existem na base e precisam ser marcáveis como qualquer outra opção.
    and (p_categorias is null or coalesce(t.categoria_codigo, '') = any(p_categorias))
    and (p_contas     is null or coalesce(t.conta_codigo, '')     = any(p_contas))
    and (p_valor_min  is null or t.valor >= p_valor_min)
    and (p_valor_max  is null or t.valor <= p_valor_max)
    -- Recorte de mês DENTRO do período do cabeçalho. Título sem competência não
    -- entra num corte por mês: não há mês para ele cair.
    and (p_mes_de  is null or (t.competencia is not null
                               and to_char(t.competencia, 'YYYY-MM') >= p_mes_de))
    and (p_mes_ate is null or (t.competencia is not null
                               and to_char(t.competencia, 'YYYY-MM') <= p_mes_ate))
    and (
      p_busca is null or btrim(p_busca) = '' or
      t.favorecido ilike '%' || p_busca || '%' or
      t.favorecido_cru ilike '%' || p_busca || '%' or
      coalesce(tx.observacao, '') ilike '%' || p_busca || '%' or
      t.doc like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' or
      t.cod_titulo::text = btrim(p_busca)
    )
)
select b.cod_titulo, b.favorecido, b.favorecido_cru, b.tem_apelido,
       b.observacao, b.doc, b.categoria, b.categoria_codigo,
       b.conta, b.valor, b.competencia, b.vencimento, b.pagamento,
       b.situacao, b.gravidade, b.anexos_no_erp, b.anexos,
       b.anexo_classe, b.anexo_revisao,
       b.nota_no_hub, b.enviado_em,
       b.nf_no_campo, b.documento, b.erro_leitura, b.anexo_lido_em,
       (select count(*) from base)
from base b
-- Maior valor primeiro: quem cobra nota começa pelo que dói.
order by b.valor desc, b.cod_titulo
limit greatest(coalesce(p_limite, 200), 1) offset greatest(coalesce(p_offset, 0), 0);
$function$;

comment on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer, text[], text[], numeric, numeric, text, text) is
  'Os títulos do contas a pagar com os cortes de coluna da tela: situação, gravidade, categoria, conta, faixa de valor, faixa de mês e busca por nome/CNPJ/nº. total_geral repete em toda linha para a tela paginar sem uma segunda consulta.';

-- A assinatura de 9 argumentos ficaria viva em paralelo como overload e o
-- PostgREST escolheria uma das duas sozinho — os filtros novos seriam ignorados
-- em silêncio, que é o pior desfecho possível numa tela de auditoria.
-- (Ver migrations-nao-batem-com-o-banco.)
drop function if exists public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer);

/* ============================================================================
 *  3. Privilégios
 * ==========================================================================
 * `from anon, public`: a concessão que deixa a função aberta é a de PUBLIC
 * (`=X/postgres` no ACL), e `revoke from anon` sozinho não a alcança. */

revoke all on function public.cap_notas_facetas(date, date) from anon, public;
revoke all on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer, text[], text[], numeric, numeric, text, text)
                                                            from anon, public;

grant execute on function public.cap_notas_facetas(date, date) to authenticated, service_role;
grant execute on function public.cap_notas_titulos(date, date, text[], text, text, text, text[], integer, integer, text[], text[], numeric, numeric, text, text)
                                                               to authenticated, service_role;
