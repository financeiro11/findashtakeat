-- ===========================================================================
-- PAINEL CAC: A BASE DEIXA DE ESTOURAR O TEMPO.
--
-- Depois de `20260913180000` a tela passou a responder "canceling statement due
-- to statement timeout". Medido em 13/09/2026: `cac_painel(2026)` 11,3 s e
-- `cac_conferencia_dre(2026)` 12,4 s — acima dos 8 s do papel da API, e as duas
-- rodam juntas quando a página abre.
--
-- O PLANO: a view juntava o TÍTULO com a BAIXA (dois CTEs sobre o mesmo
-- `jsonb_array_elements`). O planner estima 1 linha para qualquer coisa que sai
-- de jsonb, escolheu laço aninhado e reexecutou o agrupamento das baixas 5.698
-- vezes — "Rows Removed by Join Filter: 16.385.783". Por cima, a busca do
-- documento em `omie_clientes_doc` era Seq Scan por título (não havia índice em
-- `codigo`) e aparecia TRÊS vezes no plano, porque o `lateral` foi copiado para
-- dentro de cada `coalesce`.
--
-- O CONSERTO não é índice no jsonb, é não juntar:
--   • uma passada só, `group by nCodTitulo`, com `filter (where d ? 'nValorTitulo')`
--     para pegar da LINHA DO TÍTULO o valor, a categoria, o status e o registro, e
--     de QUALQUER linha a data de pagamento e o documento — o mesmo resultado da
--     junção, sem a junção;
--   • o documento resolvido UMA vez num CTE materializado;
--   • índice nas três buscas por pessoa, que viram Index Scan por título.
-- A regra e os números não mudam: a conferência abaixo compara a view antiga com
-- a nova título a título antes de dar a migration por boa.
-- ===========================================================================

create index if not exists omie_clientes_doc_codigo_idx
  on public.omie_clientes_doc (codigo);
create index if not exists cac_pessoas_raiz_idx
  on public.cac_pessoas (left(cnpj, 8)) where length(cnpj) = 14;
create index if not exists cac_pessoas_codigos_omie_idx
  on public.cac_pessoas using gin (codigos_omie);

-- A foto da view antiga, para provar que só o caminho mudou.
create temp table cac_pagamentos_antes on commit drop as
  select cod_titulo, cnpj, categoria, data_pagamento, vencimento, valor, competencia, cnpj_omie, cod_cliente, status
    from public.cac_pagamentos;

create or replace view public.cac_pagamentos as
  with linhas as (
    select e->'detalhes' as d
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'movimentos'
       and e->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  ),
  titulo as materialized (
    select (d->>'nCodTitulo')::bigint as cod_titulo,
           -- Da linha que carrega `nValorTitulo` (MANP, RPTP, APIP, BARP): é a regra da DRE.
           max(d->>'cCodCateg')                            filter (where d ? 'nValorTitulo') as categoria,
           max(d->>'cStatus')                              filter (where d ? 'nValorTitulo') as status,
           max(abs((d->>'nValorTitulo')::numeric))                                            as valor,
           max(to_date(coalesce(d->>'dDtRegistro', d->>'dDtInclusao', d->>'dDtEmissao', d->>'dDtPrevisao'), 'DD/MM/YYYY'))
                                                           filter (where d ? 'nValorTitulo') as competencia,
           max(to_date(d->>'dDtVenc', 'DD/MM/YYYY'))       filter (where d ? 'nValorTitulo') as vencimento,
           -- De qualquer linha: a baixa (BAXP) é quem sabe se e quando pagou.
           max(to_date(d->>'dDtPagamento', 'DD/MM/YYYY'))                                     as data_pagamento,
           coalesce(
             max(nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '[^0-9]', '', 'g'), '')) filter (where d ? 'nValorTitulo'),
             max(nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '[^0-9]', '', 'g'), ''))
           )                                                                                  as doc_omie,
           coalesce(
             max(nullif(d->>'nCodCliente', '')) filter (where d ? 'nValorTitulo'),
             max(nullif(d->>'nCodCliente', ''))
           )                                                                                  as cod_cliente
      from linhas
     group by 1
    having bool_or(d ? 'nValorTitulo')
  ),
  comdoc as materialized (
    select t.*,
           coalesce(
             t.doc_omie,
             (select o.doc from public.omie_clientes_doc o
               where t.cod_cliente ~ '^[0-9]+$' and o.codigo = t.cod_cliente::bigint
               limit 1),
             ''
           ) as doc
      from titulo t
     where t.status is distinct from 'CANCELADO'
  )
  select c.cod_titulo,
         coalesce(
           (select p.cnpj from public.cac_pessoas p where p.cnpj = c.doc),
           (select p.cnpj from public.cac_pessoas p
             where length(c.doc) = 14 and length(p.cnpj) = 14
               and left(p.cnpj, 8) = left(c.doc, 8)
             order by p.ativo desc limit 1),
           (select p.cnpj from public.cac_pessoas p
             where c.cod_cliente ~ '^[0-9]+$' and p.codigos_omie @> array[c.cod_cliente::bigint]
             limit 1),
           c.doc
         )             as cnpj,
         c.categoria,
         c.data_pagamento,
         c.vencimento,
         c.valor,
         c.competencia,
         c.doc         as cnpj_omie,
         c.cod_cliente,
         c.status
    from comdoc c;

comment on view public.cac_pagamentos is
  'Títulos a pagar do Omie na regra da DRE: um por cod_titulo, valor = nValorTitulo, competência = dDtRegistro, pago OU a vencer (cancelado fora). data_pagamento é nula no que ainda não foi pago. cnpj = chave da pessoa em cac_pessoas quando casa. Uma passada só por título — juntar título com baixa custava 16 M de comparações.';

-- ─────────────────────── Conferência ───────────────────────

do $$
declare
  v_dif  integer;
  v_ini  timestamptz;
  v_ms   numeric;
begin
  -- 1. Os mesmos títulos, com os mesmos números, nos dois sentidos.
  select count(*) into v_dif from (
    (select cod_titulo, cnpj, categoria, data_pagamento, vencimento, valor, competencia, cnpj_omie, cod_cliente, status from cac_pagamentos_antes
     except
     select cod_titulo, cnpj, categoria, data_pagamento, vencimento, valor, competencia, cnpj_omie, cod_cliente, status from public.cac_pagamentos)
    union all
    (select cod_titulo, cnpj, categoria, data_pagamento, vencimento, valor, competencia, cnpj_omie, cod_cliente, status from public.cac_pagamentos
     except
     select cod_titulo, cnpj, categoria, data_pagamento, vencimento, valor, competencia, cnpj_omie, cod_cliente, status from cac_pagamentos_antes)
  ) x;
  if v_dif <> 0 then
    raise exception 'a view reescrita mudou % título(s) — só o caminho podia mudar', v_dif;
  end if;

  -- 2. Cabe no tempo da API, com folga. Duas chamadas: a primeira paga o cache frio.
  perform count(*) from public.cac_painel(2026);
  v_ini := clock_timestamp();
  perform count(*) from public.cac_painel(2026);
  v_ms := extract(epoch from clock_timestamp() - v_ini) * 1000;
  raise notice 'cac_painel(2026): % ms', round(v_ms);
  if v_ms > 6000 then raise exception 'cac_painel ainda leva % ms', round(v_ms); end if;

  v_ini := clock_timestamp();
  perform count(*) from public.cac_conferencia_dre(2026);
  v_ms := extract(epoch from clock_timestamp() - v_ini) * 1000;
  raise notice 'cac_conferencia_dre(2026): % ms', round(v_ms);
  if v_ms > 6000 then raise exception 'cac_conferencia_dre ainda leva % ms', round(v_ms); end if;
end $$;
