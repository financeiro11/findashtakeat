-- Parametrização, parte 3: tirar da fila o que não é fornecedor.
--
-- A primeira versão devolvia TUDO, e a primeira tela da fila ficou assim:
--
--   TAKEAT.APP - GARCOM DIGITAL   R$ 3,14 M   Transferência de Saída*
--   PAGAMENTO DE FATURA           R$ 2,08 M   Pagamento da fatura
--   BANCO BTG PACTUAL S.A.        R$ 2,11 M   Transferência de Saída*
--   BANCO SICOOB                  R$  290 k   Transferência de Saída*
--
-- Nada disso é contraparte que alguém peça para explicar: é dinheiro andando
-- entre contas da própria empresa, o pagamento da própria fatura do cartão e a
-- tarifa do cartão. Dar apelido a eles não responde pergunta nenhuma, e como
-- ninguém ia nomeá-los eles ficariam ETERNAMENTE no topo, empurrando para baixo
-- justamente as 286 contrapartes de "Outros (diversos)" que são a dor real.
--
-- Havia um segundo estrago, silencioso: a barra de cobertura. Transferências
-- (R$ 5,56 M) mais pagamento de fatura (R$ 2,08 M) somavam R$ 7,6 M dos
-- R$ 16,42 M do denominador — quase metade. E o pagamento da fatura é o MESMO
-- dinheiro das compras do cartão, contado duas vezes. Com isso, "% do valor que
-- já sabe dizer o próprio nome" nunca chegaria perto de 100 nem que se nomeasse
-- tudo.
--
-- O corte é POR LANÇAMENTO, não por contraparte: um fornecedor de verdade que
-- tenha um título classificado como transferência continua na fila, só sem
-- aquele título no total. Cortar a contraparte inteira pela categoria dominante
-- sumiria com quem tem a classificação torta.

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
      -- Mecânica do cartão, não compra: o pagamento da fatura é a MESMA grana
      -- das compras (contá-la de novo inflaria o denominador), e IOF/tarifa já
      -- vem com o nome que tem.
      and coalesce(cl.categoria, '') not in ('Pagamento da fatura', 'Tarifas e impostos do cartão')
      and upper(btrim(cl.estabelecimento)) not in ('PAGAMENTO DE FATURA', 'IOF')
    group by cl.estabelecimento
  ),
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
      -- Dinheiro entre contas da própria casa. A conta destino não é fornecedor
      -- e a saída nem é despesa — é a mesma grana mudando de lugar.
      and coalesce(c.descricao, '') not ilike 'transfer%'
      and not (
        lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%cart%o%'
        and (lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lancamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%lançamento%'
          or lower(coalesce(nullif(btrim(cli.nome), ''), f.nome, '')) like '%fatura%')
      )
      and coalesce(nullif(btrim(cli.nome), ''), f.nome) is not null
    group by 2
  ),
  tudo as (
    select * from cartao
    union all
    select * from omie
  )
  -- Contraparte marcada como "não é fornecedor" na tela sai da fila e do
  -- denominador da cobertura. É a válvula de escape para o que estas regras
  -- não pegarem — sem ela, uma linha que ninguém vai nomear fica no topo para
  -- sempre e a barra nunca fecha.
  select t.* from tudo t
  where not exists (
    select 1 from public.lib_fornecedores f
     where f.status = 'ignorado'
       and (upper(btrim(f.nome)) = upper(btrim(t.nome))
         or exists (
              select 1 from public.contrapartes_alias a
               where a.fornecedor_id = f.id
                 and upper(btrim(a.alias)) = upper(btrim(t.nome))
            ))
  );
$$;

comment on function public.parametrizacao_contrapartes() is
  'Candidatos a apelido, já sem transferência entre contas próprias, pagamento de fatura, tarifa de cartão e o que foi marcado como "não é fornecedor".';

revoke all on function public.parametrizacao_contrapartes() from public, anon;
grant execute on function public.parametrizacao_contrapartes() to authenticated, service_role;
