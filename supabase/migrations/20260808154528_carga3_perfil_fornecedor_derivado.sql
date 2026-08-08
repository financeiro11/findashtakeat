-- ============================================================
-- CARGA 3 - Perfil derivado do fornecedor (itens 4, 5, 6, 7 do inventario)
-- Fonte: omie_titulos (tipo='pagar'). Puro SQL, sem API e sem julgamento.
-- NAO toca exige_nf nem permite_auto_lancamento: sao decisao humana
-- (itens 8 e 10, Henrique/Julia).
-- Re-executavel: recalcula do zero a cada rodada.
-- ============================================================

with base as (
  select t.fornecedor_id, t.cod_titulo, t.valor, t.vencimento, t.data_emissao,
         t.categoria_codigo, t.centro_custo_id, t.departamento_id
  from public.omie_titulos t
  where t.tipo = 'pagar' and t.fornecedor_id is not null and t.status <> 'cancelado'
), agg as (
  select fornecedor_id,
         count(*) as n,
         percentile_cont(0.10) within group (order by valor)::numeric as p10,
         percentile_cont(0.90) within group (order by valor)::numeric as p90,
         percentile_cont(0.50) within group (order by (vencimento - data_emissao))
           filter (where data_emissao is not null and vencimento is not null)::numeric as prazo
  from base group by fornecedor_id
), gaps as (
  select fornecedor_id, avg(gap) as gap_medio from (
    select fornecedor_id,
           vencimento - lag(vencimento) over (partition by fornecedor_id order by vencimento) as gap
    from base
  ) g where gap is not null and gap > 0 group by fornecedor_id
), moda as (
  select distinct on (fornecedor_id) fornecedor_id, categoria_codigo, centro_custo_id, departamento_id,
         count(*) over (partition by fornecedor_id, categoria_codigo)::numeric
         / count(*) over (partition by fornecedor_id) as share
  from base where categoria_codigo is not null
  order by fornecedor_id, count(*) over (partition by fornecedor_id, categoria_codigo) desc, categoria_codigo
), cat as (
  select c->>'codigo' as codigo, c->>'descricao' as descricao
  from public.omie_cache, lateral jsonb_array_elements(dados) c where chave='categorias'
)
update public.lib_fornecedores f set
  n_ocorrencias         = a.n,
  valor_min             = round(a.p10, 2),
  valor_max             = round(a.p90, 2),
  prazo_pagamento_dias  = round(a.prazo)::integer,
  categoria_omie_codigo = m.categoria_codigo,
  categoria             = coalesce(cat.descricao, m.categoria_codigo, f.categoria),
  centro_custo_id       = coalesce(m.centro_custo_id, f.centro_custo_id),
  departamento_id       = coalesce(m.departamento_id, f.departamento_id),
  confianca             = round(coalesce(m.share, 0), 4),
  periodicidade = case
    when a.n = 1                         then 'avulso'
    when g.gap_medio between 12  and 18  then 'quinzenal'
    when g.gap_medio between 25  and 35  then 'mensal'
    when g.gap_medio between 75  and 105 then 'trimestral'
    when g.gap_medio between 160 and 200 then 'semestral'
    when g.gap_medio between 330 and 400 then 'anual'
    else 'variavel'
  end
from agg a
left join gaps g on g.fornecedor_id = a.fornecedor_id
left join moda m on m.fornecedor_id = a.fornecedor_id
left join cat     on cat.codigo = m.categoria_codigo
where f.id = a.fornecedor_id;;
