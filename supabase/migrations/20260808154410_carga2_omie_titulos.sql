-- ============================================================
-- CARGA 2 - omie_titulos (item 12 do inventario)
-- Fonte: omie_cache (movimentos + contas_pagar + clientes + categorias)
--        e omie_titulo_texto. Nenhuma chamada de API.
-- Escopo: CONTA_A_PAGAR + CONTA_A_RECEBER. Previsoes ficam de fora
--         (PREVISAO_ORDEM_SERVICO e PREVISAO_CONTRATO nao sao titulos).
-- Idempotente: on conflict do nothing pelo cod_titulo.
-- ============================================================

with cli as (
  select distinct on (c->>'codigo')
    c->>'codigo' as codigo,
    replace(replace(replace(replace(
      coalesce(nullif(btrim(regexp_replace(
        regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
        '\s+\d{11}$', '')), ''), c->>'nome'),
      '&amp;','&'), '&quot;','"'), '&#39;',''''), '&nbsp;',' ') as nome,
    nullif(regexp_replace(coalesce(c->>'cnpj_cpf',''),'[^0-9]','','g'),'') as dn
  from public.omie_cache, lateral jsonb_array_elements(dados) c
  where chave = 'clientes' order by c->>'codigo'
), cat as (
  select c->>'codigo' as codigo, c->>'descricao' as descricao
  from public.omie_cache, lateral jsonb_array_elements(dados) c where chave = 'categorias'
), cc as (
  select codigo, descricao,
    case
      when descricao ~* '(-|–)\s*marketing\s*$'                        then 'MKT'
      when descricao ~* '(-|–)\s*(administrativo|corporativo)\s*$'     then 'ADM'
      when descricao ~* '(-|–)\s*comercial\s*$'                        then 'COM'
      when descricao ~* '(-|–)\s*(tecnologia|ti)\s*$'                  then 'TEC'
      when descricao ~* '(-|–)\s*(opera(c|ç)(a|ã)o|opera(c|ç)(o|õ)es)\s*$' then 'OPE'
      when descricao ~* '(-|–)\s*novos canais\s*$'                     then 'NOV'
    end as cc_codigo
  from cat
), txt as (
  select cod_titulo, observacao,
         btrim(coalesce(
           (regexp_match(corpo, '^(.*?)\s+\d{2}/\d{2}\s'))[1],
           (regexp_match(corpo, '^(.*?)\s{2,}'))[1],
           corpo)) as estabelecimento
  from (
    select cod_titulo, observacao,
           regexp_replace(
             btrim(regexp_replace(observacao, '^Conta a Pagar importada automaticamente em [^|]*\|', '')),
             '([A-Za-z0-9])\s+\*\s*', '\1*') as corpo
    from public.omie_titulo_texto where observacao is not null
  ) b
), cap_aberto as (
  select (e->>'cod')::bigint as cod, nullif(e->>'obs','') as obs, nullif(e->>'nf','') as nf
  from public.omie_cache, jsonb_array_elements(dados) e where chave = 'contas_pagar'
), mov as (
  select distinct on ((e->'detalhes'->>'nCodTitulo')::bigint)
         e->'detalhes' as det, e->'resumo' as res
  from public.omie_cache, jsonb_array_elements(dados) e
  where chave = 'movimentos'
    and e->'detalhes'->>'cGrupo' in ('CONTA_A_PAGAR','CONTA_A_RECEBER')
  order by (e->'detalhes'->>'nCodTitulo')::bigint
)
insert into public.omie_titulos (
  cod_titulo, tipo, fornecedor_id, favorecido_texto, documento_norm,
  valor, valor_pago, data_emissao, vencimento, data_pagamento, competencia,
  categoria_codigo, centro_custo_id, departamento_id,
  numero_documento, nota_fiscal, observacao, status, origem_lancamento
)
select
  (m.det->>'nCodTitulo')::bigint,
  case when m.det->>'cGrupo' = 'CONTA_A_PAGAR' then 'pagar' else 'receber' end,
  f.id,
  -- lojista real quando a contraparte e a fatura de cartao; senao o nome do cadastro Omie
  case when cli.nome ilike '%fatura%cart%' and txt.estabelecimento is not null
       then txt.estabelecimento else cli.nome end,
  coalesce(nullif(regexp_replace(coalesce(m.det->>'cCPFCNPJCliente',''),'[^0-9]','','g'),''), cli.dn),
  abs((m.det->>'nValorTitulo')::numeric),
  nullif((m.res->>'nValPago'),'')::numeric,
  to_date(nullif(m.det->>'dDtEmissao',''),   'DD/MM/YYYY'),
  to_date(nullif(m.det->>'dDtVenc',''),      'DD/MM/YYYY'),
  to_date(nullif(m.det->>'dDtPagamento',''), 'DD/MM/YYYY'),
  date_trunc('month', to_date(nullif(coalesce(m.det->>'dDtRegistro', m.det->>'dDtEmissao', m.det->>'dDtPrevisao'),''),'DD/MM/YYYY'))::date,
  m.det->>'cCodCateg',
  lcc.id,
  lcc.departamento_id,
  nullif(m.det->>'cNumTitulo',''),
  coalesce(nullif(m.det->>'cNumDocFiscal',''), cap_aberto.nf),
  coalesce(txt.observacao, cap_aberto.obs),
  case
    when m.det->>'cStatus' = 'CANCELADO' then 'cancelado'
    when coalesce((m.res->>'nValPago')::numeric,0) > 0
     and coalesce((m.res->>'nValAberto')::numeric,0) > 0 then 'parcial'
    when m.det->>'cStatus' in ('PAGO','RECEBIDO') then 'pago'
    when m.det->>'cStatus' = 'ATRASADO'  then 'atrasado'
    when m.det->>'cStatus' = 'A VENCER'  then 'aberto'
  end,
  'importacao'
from mov m
left join cli        on cli.codigo = m.det->>'nCodCliente'
left join cc         on cc.codigo  = m.det->>'cCodCateg'
left join public.lib_centros_custo lcc on lcc.codigo = cc.cc_codigo
left join txt        on txt.cod_titulo = (m.det->>'nCodTitulo')::bigint
left join cap_aberto on cap_aberto.cod = (m.det->>'nCodTitulo')::bigint
left join public.lib_fornecedores f
       on f.documento_norm = coalesce(
            nullif(regexp_replace(coalesce(m.det->>'cCPFCNPJCliente',''),'[^0-9]','','g'),''), cli.dn)
on conflict (cod_titulo) do nothing;;
