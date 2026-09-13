-- ===========================================================================
-- PAINEL CAC: A BASE PASSA A SER A MESMA DA DRE.
--
-- Pergunta de 13/09/2026: "a linha de Eventos de agosto deu só isso? Tem duas
-- categorias ali dentro". Não tinha dado só isso. O painel mostrava R$ 95,6 mil;
-- a DRE de agosto tem Eventos e Feiras R$ 85.879,02 + Viagens & Transportes Mkt
-- R$ 40.642,54 = R$ 126.521,56.
--
-- O QUE FALTAVA: a view só contava título PAGO. Por competência isso corta o fim
-- de todo mês recente — a fatura de cartão de agosto (origem APIP) e as viagens
-- recorrentes (RPTP) vencem em setembro e outubro, e a premiação de agosto é paga
-- no dia 15 do mês seguinte. Em Eventos + Viagens eram R$ 30.149 fora em agosto,
-- R$ 17.529 em julho, R$ 8.555 em junho.
--
-- A REGRA DA DRE (omie-sync), reproduzida aqui:
--   • um título = a linha do movimento que carrega `nValorTitulo` (MANP, RPTP,
--     APIP, BARP); a linha da baixa (BAXP) só empresta a data de pagamento e o
--     documento;
--   • valor = `nValorTitulo`, não o pago;
--   • mês = `dDtRegistro`, caindo para inclusão, emissão e previsão;
--   • a categoria é a da LINHA DO TÍTULO. A versão anterior pegava `max()` entre
--     título e baixa, e um título reclassificado caía na categoria errada.
-- Conferido em 13/09/2026, rubrica a rubrica, com o cache de 11:04: jul e ago/26
-- batem NO CENTAVO em Eventos e Feiras, Viagens & Transportes Mkt, Campanhas de
-- Outros Canais, Equipe Comercial, Marketing, Operacional, Onboarding,
-- Administrativa, Tecnologia, Premiações e Premiações Operacionais.
--
-- UM DESVIO DE PROPÓSITO: título CANCELADO fica fora. O omie-sync não filtra
-- status (em 2026 é um só, R$ 385 de Premiação - Suporte de abril, mês travado).
--
-- E O DOCUMENTO: 1.108 títulos pagos de 2026 não trazem o CNPJ na linha do
-- título, só na baixa. Título A VENCER não tem baixa — sem buscar pelo código do
-- cliente em `omie_clientes_doc`, a fatura em aberto de alguém do cadastro cairia
-- no fallback por categoria.
-- ===========================================================================

create or replace view public.cac_pagamentos as
  with linhas as (
    select e->'detalhes' as d
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'movimentos'
       and e->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
  ),
  titulo as (
    select distinct on ((d->>'nCodTitulo')::bigint)
           (d->>'nCodTitulo')::bigint                                                   as cod_titulo,
           d->>'cCodCateg'                                                              as categoria,
           d->>'cStatus'                                                                as status,
           abs((d->>'nValorTitulo')::numeric)                                           as valor,
           to_date(coalesce(d->>'dDtRegistro', d->>'dDtInclusao', d->>'dDtEmissao', d->>'dDtPrevisao'), 'DD/MM/YYYY') as competencia,
           to_date(d->>'dDtVenc', 'DD/MM/YYYY')                                         as vencimento,
           nullif(d->>'nCodCliente', '')                                                as cod_cliente,
           nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '[^0-9]', '', 'g'), '') as doc
      from linhas
     where d ? 'nValorTitulo'
     order by (d->>'nCodTitulo')::bigint, (d->>'dDtRegistro') is null
  ),
  baixa as (
    select (d->>'nCodTitulo')::bigint                                                   as cod_titulo,
           max(to_date(d->>'dDtPagamento', 'DD/MM/YYYY'))                               as data_pagamento,
           max(nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '[^0-9]', '', 'g'), '')) as doc,
           max(nullif(d->>'nCodCliente', ''))                                           as cod_cliente
      from linhas
     group by 1
  )
  select t.cod_titulo,
         coalesce(
           (select p.cnpj from public.cac_pessoas p where p.cnpj = x.doc),
           (select p.cnpj from public.cac_pessoas p
             where length(x.doc) = 14 and length(p.cnpj) = 14
               and left(p.cnpj, 8) = left(x.doc, 8)
             order by p.ativo desc limit 1),
           (select p.cnpj from public.cac_pessoas p
             where x.cod ~ '^[0-9]+$' and x.cod::bigint = any(p.codigos_omie)
             limit 1),
           x.doc
         )                    as cnpj,
         t.categoria,
         b.data_pagamento,
         t.vencimento,
         t.valor,
         t.competencia,
         x.doc                as cnpj_omie,
         x.cod                as cod_cliente,
         t.status
    from titulo t
    left join baixa b on b.cod_titulo = t.cod_titulo
    cross join lateral (
      select coalesce(t.cod_cliente, b.cod_cliente) as cod,
             coalesce(
               t.doc, b.doc,
               (select o.doc from public.omie_clientes_doc o
                 where coalesce(t.cod_cliente, b.cod_cliente) ~ '^[0-9]+$'
                   and o.codigo = coalesce(t.cod_cliente, b.cod_cliente)::bigint
                 limit 1),
               ''
             ) as doc
    ) x
   where t.status is distinct from 'CANCELADO';

comment on view public.cac_pagamentos is
  'Títulos a pagar do Omie na regra da DRE: um por cod_titulo, valor = nValorTitulo, competência = dDtRegistro, pago OU a vencer (cancelado fora). data_pagamento é nula no que ainda não foi pago. cnpj = chave da pessoa em cac_pessoas quando casa.';

-- ─────────────────────── A conferência com a DRE ───────────────────────

/* Para cada rubrica da DRE que alimenta alguma linha do CAC, mês a mês:
     dre         o que a DRE mostra (o blob, com valor digitado e mês travado);
     omie        a mesma rubrica refeita desta base — tem de bater com a DRE onde
                 ela não foi digitada nem travada;
     no_cac      a parte que alguma linha do painel pega;
     fora_do_cac o resto — folha de Tecnologia, Administrativo, Diretoria…
   Uma linha de pagamento conta UMA vez em `no_cac`, mesmo que duas regras a
   peguem (o que já seria um conflito, acusado na aba de regras).
   INVOKER: lê o blob da DRE com a policy de quem chama. */
create or replace function public.cac_conferencia_dre(p_ano integer)
returns table (
  rubrica text, mes integer, dre numeric, omie numeric, no_cac numeric,
  fora_do_cac numeric, valor_manual_na_dre boolean, mes_travado boolean
)
language sql
stable
set search_path to 'public'
as $function$
  with cat as (
    select e->>'codigo' as codigo,
           lower(unaccent(btrim(regexp_replace(e->>'descricao', '\s+', ' ', 'g')))) as k
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'categorias'
  ),
  mapa as (
    select distinct on (k) k, rubrica
      from (select lower(unaccent(btrim(regexp_replace(codigo_categoria, '\s+', ' ', 'g')))) as k, rubrica
              from public.omie_dre_mapa
             where ativo is not false and demonstrativo in ('dre', 'ambos')) z
     order by k, rubrica
  ),
  rubricas as (
    select distinct mapa.rubrica
      from public.cac_linhas l,
           unnest(l.categorias || l.categorias_inteiras || l.categorias_sem_cadastro) c
      join cat on cat.codigo = c
      join mapa on mapa.k = cat.k
     where l.ativo and not l.manual
  ),
  pg as materialized (
    select m.rubrica,
           extract(month from p.competencia)::int as mes,
           p.valor,
           exists (select 1 from public.cac_linhas l
                    where l.ativo and not l.manual
                      and public.cac_linha_casa(l, p.cnpj, p.categoria)) as no_cac
      from public.cac_pagamentos p
      join cat on cat.codigo = p.categoria
      join mapa m on m.k = cat.k
     where p.competencia >= make_date(p_ano, 1, 1)
       and p.competencia <  make_date(p_ano + 1, 1, 1)
       and m.rubrica in (select rubrica from rubricas)
  ),
  omie as (
    select rubrica, mes, sum(valor) as omie, coalesce(sum(valor) filter (where no_cac), 0) as no_cac
      from pg group by 1, 2
  ),
  blob as (
    select r->>'Conta' as rubrica, m.mes,
           abs(nullif(r->>to_char(make_date(p_ano, m.mes, 1), 'Mon-YY'), '')::numeric) as dre
      from public.demonstracoes_contabeis dc,
           lateral jsonb_array_elements(dc.dados->'rows') r,
           generate_series(1, 12) m(mes)
     where dc.tipo = 'dre' and dc.periodo = 'completo'
       and r->>'Conta' in (select rubrica from rubricas)
  )
  select r.rubrica, m.mes, b.dre,
         round(coalesce(o.omie, 0), 2),
         round(coalesce(o.no_cac, 0), 2),
         round(coalesce(o.omie, 0) - coalesce(o.no_cac, 0), 2),
         exists (select 1 from public.demonstracoes_valor_manual v
                  where v.tipo = 'dre' and v.rubrica = r.rubrica
                    and v.col_key = to_char(make_date(p_ano, m.mes, 1), 'Mon-YY')),
         exists (select 1 from public.demonstracoes_mes_trancado t
                  where t.col_key = to_char(make_date(p_ano, m.mes, 1), 'Mon-YY'))
    from rubricas r
    cross join generate_series(1, 12) m(mes)
    left join omie o on o.rubrica = r.rubrica and o.mes = m.mes
    left join blob b on b.rubrica = r.rubrica and b.mes = m.mes
   order by r.rubrica, m.mes
$function$;

revoke all on function public.cac_conferencia_dre(integer) from public;
revoke all on function public.cac_conferencia_dre(integer) from anon;
grant execute on function public.cac_conferencia_dre(integer) to authenticated, service_role;

-- ─────────────────────── A nota que a base nova destravou ───────────────────────

/* Com a regra da DRE, jun/26 de Investimentos › Eventos deu 185.579,39 — EXATO o
   oficial (pela base só-pago dava 177.024,38). A diferença de agosto contra a
   rubrica "Viagens & Transportes Mkt" da DRE (R$ 743,73) é 3.1.4.4 Transportes e
   Viagens - COMERCIAL, que a DRE junta na mesma rubrica e a skill não conta. */
update public.cac_linhas
   set regra_nota = 'A verba de feira: 3.1.3.8 Eventos e Feiras + 3.1.3.4 Transportes e Viagens - Marketing, como na skill. Bate exato com o oficial em jun/26 (R$ 185.579,39); mai fica R$ 121 abaixo. A rubrica "Viagens & Transportes Mkt" da DRE também soma as viagens do Comercial (3.1.4.4), que aqui ficam fora.',
       atualizado_em = now()
 where grupo = 'Investimentos' and rotulo = 'Eventos';

-- ─────────────────────── Conferência ───────────────────────

do $$
declare
  v record;
begin
  -- Agosto/26 não tem valor digitado nem trava nessas duas rubricas: a base tem
  -- de dar exatamente a DRE. Se não der, a regra copiada está errada.
  for v in
    select * from public.cac_conferencia_dre(2026)
     where mes = 8 and rubrica in ('Eventos e Feiras', 'Viagens & Transportes Mkt', 'Equipe Comercial', 'Premiações')
  loop
    raise notice '% ago/26: DRE % · Omie % · no CAC % · fora %', v.rubrica, v.dre, v.omie, v.no_cac, v.fora_do_cac;
    if abs(coalesce(v.dre, 0) - v.omie) > 1 and not v.valor_manual_na_dre and not v.mes_travado then
      raise exception '% ago/26 não bate com a DRE: % × %', v.rubrica, v.dre, v.omie;
    end if;
  end loop;

  perform count(*) from public.cac_painel(2026);
  perform count(*) from public.cac_celula_completo(2026, 8,
    (select id from public.cac_linhas where grupo = 'Investimentos' and rotulo = 'Eventos'));
end $$;
