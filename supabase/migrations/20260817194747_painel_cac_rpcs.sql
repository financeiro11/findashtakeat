/* ---------------------------------------------------------------------------
 * Painel CAC — a leitura: a matriz e o que compõe cada célula.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * A base: um título pago, uma linha.
 *
 * `movimentos` traz CADA título DUAS vezes — origem MANP (o título) e BAXP (a
 * baixa) — e as duas carregam `nValPago` cheio. Somar direto dobra tudo: foi o
 * que fez a primeira conferência devolver R$ 535 mil onde havia R$ 267 mil.
 * O `distinct on (nCodTitulo)` é obrigatório, não é otimização.
 * ------------------------------------------------------------------------- */
create or replace view public.cac_pagamentos as
  select distinct on ((e->'detalhes'->>'nCodTitulo')::bigint)
    (e->'detalhes'->>'nCodTitulo')::bigint                                        as cod_titulo,
    regexp_replace(coalesce(e->'detalhes'->>'cCPFCNPJCliente',''),'[^0-9]','','g') as cnpj,
    e->'detalhes'->>'cCodCateg'                                                    as categoria,
    to_date(e->'detalhes'->>'dDtPagamento','DD/MM/YYYY')                           as data_pagamento,
    to_date(e->'detalhes'->>'dDtVenc','DD/MM/YYYY')                                as vencimento,
    (e->'resumo'->>'nValPago')::numeric                                            as valor
  from public.omie_cache, lateral jsonb_array_elements(dados) e
  where chave = 'movimentos'
    and e->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
    and e->'detalhes'->>'dDtPagamento' is not null
  order by (e->'detalhes'->>'nCodTitulo')::bigint;

comment on view public.cac_pagamentos is
  'Titulos pagos do Omie, UM por cod_titulo. O cache guarda cada titulo em duas origens (MANP/BAXP) com o valor cheio nas duas.';

grant select on public.cac_pagamentos to authenticated, service_role;

/* ---------------------------------------------------------------------------
 * Casa um pagamento com uma linha do painel.
 *
 * REGRA VAZIA NÃO CASA COM NADA. Sem esta guarda, a linha "Comissão de MGM",
 * que ainda não tem regra, somava os R$ 2,1 milhões de TODAS as contas pagas do
 * mês — um "cardinality = 0 então não filtra" que, aplicado aos dois filtros ao
 * mesmo tempo, vira "aceita tudo". Uma linha sem regra vale zero.
 * ------------------------------------------------------------------------- */
create or replace function public.cac_linha_casa(
  p_departamentos text[],
  p_categorias    text[],
  p_cnpj          text,
  p_categoria     text
) returns boolean
language sql stable parallel safe as $$
  select
    (cardinality(p_departamentos) > 0 or cardinality(p_categorias) > 0)
    and (cardinality(p_categorias) = 0 or p_categoria = any(p_categorias))
    and (cardinality(p_departamentos) = 0 or exists (
          select 1 from public.cac_pessoas p
          where p.ativo and p.cnpj = p_cnpj
            and p.departamento = any(p_departamentos)))
$$;

/* ---------------------------------------------------------------------------
 * A matriz do painel: linha × mês, para um ano.
 *
 * `origem` diz de onde o número veio, e a tela mostra isso: 'manual' não abre em
 * lançamentos (não há de onde), 'omie' abre. Sem essa marca, uma célula
 * importada do painel antigo pareceria auditável e frustraria quem clicasse.
 * ------------------------------------------------------------------------- */
create or replace function public.cac_painel(p_ano integer)
returns table (
  linha_id uuid, grupo text, rotulo text, ordem integer, regra_nota text,
  mes integer, valor numeric, origem text
)
language sql stable security invoker as $$
  with meses as (select generate_series(1,12) as mes),
  calc as (
    select l.id as linha_id, m.mes,
           coalesce(sum(pg.valor) filter (
             where public.cac_linha_casa(l.departamentos, l.categorias, pg.cnpj, pg.categoria)
           ), 0) as valor
    from public.cac_linhas l
    cross join meses m
    left join public.cac_pagamentos pg
      on  extract(year  from pg.data_pagamento) = p_ano
      and extract(month from pg.data_pagamento) = m.mes
    where l.ativo
    group by l.id, m.mes
  )
  select l.id, l.grupo, l.rotulo, l.ordem, l.regra_nota,
         c.mes,
         coalesce(vm.valor, c.valor) as valor,
         case when vm.valor is not null then 'manual' else 'omie' end as origem
  from calc c
  join public.cac_linhas l on l.id = c.linha_id
  left join public.cac_valores_manuais vm
    on vm.linha_id = c.linha_id and vm.ano = p_ano and vm.mes = c.mes
  order by l.ordem, c.mes;
$$;

comment on function public.cac_painel(integer) is
  'Matriz do painel CAC: uma linha por (linha do painel, mes). origem = manual quando ha valor digitado, que vence o calculo.';

/* ---------------------------------------------------------------------------
 * O que compõe UMA célula.
 *
 * Devolve os lançamentos e, junto, quem daquele departamento NÃO recebeu no mês
 * (`tipo = 'sem_pagamento'`). A ausência é o que explica a diferença: em Jul/26
 * faltavam exatamente os R$ 5.000 de duas pessoas de Inside Sales que não foram
 * pagas na janela do cache. Sem essa lista, some sem deixar rastro.
 * ------------------------------------------------------------------------- */
create or replace function public.cac_celula(
  p_ano integer, p_mes integer, p_linha_id uuid
) returns table (
  tipo text, cod_titulo bigint, data_pagamento date, cnpj text,
  pessoa text, favorecido text, departamento text,
  categoria text, categoria_descricao text, natureza text, valor numeric
)
language sql stable security invoker as $$
  with l as (select * from public.cac_linhas where id = p_linha_id),
  cat as (
    select e->>'codigo' as codigo, e->>'descricao' as descricao
    from public.omie_cache, lateral jsonb_array_elements(dados) e
    where chave = 'categorias'
  ),
  -- Nome do favorecido pelo cadastro de clientes do Omie: o CNPJ do PJ costuma
  -- estar em nome da empresa ("COLUNA SERVICOS DE APOIO ADMINISTRATIVO LTDA"),
  -- e a pessoa é quem interessa — mas o nome cru é o que se procura no Omie,
  -- então os dois voltam.
  cli as (
    select distinct on (regexp_replace(coalesce(e->>'cnpj_cpf',''),'[^0-9]','','g'))
      regexp_replace(coalesce(e->>'cnpj_cpf',''),'[^0-9]','','g') as cnpj,
      e->>'nome' as nome
    from public.omie_cache, lateral jsonb_array_elements(dados) e
    where chave = 'clientes'
      and nullif(regexp_replace(coalesce(e->>'cnpj_cpf',''),'[^0-9]','','g'),'') is not null
    order by 1
  ),
  pagos as (
    select pg.*, p.nome as pessoa, p.departamento
    from public.cac_pagamentos pg
    left join public.cac_pessoas p on p.cnpj = pg.cnpj and p.ativo
    cross join l
    where extract(year  from pg.data_pagamento) = p_ano
      and extract(month from pg.data_pagamento) = p_mes
      and public.cac_linha_casa(l.departamentos, l.categorias, pg.cnpj, pg.categoria)
  )
  select 'lancamento'::text, pagos.cod_titulo, pagos.data_pagamento, pagos.cnpj,
         pagos.pessoa, cli.nome, pagos.departamento,
         pagos.categoria, cat.descricao,
         -- Premiação é o variável do mês; o resto é folha. A tela separa os dois
         -- porque a leitura muda por completo: metade de Inside Sales é comissão.
         case when cat.descricao ~* 'premia' then 'comissão' else 'folha' end,
         pagos.valor
  from pagos
  left join cat on cat.codigo = pagos.categoria
  left join cli on cli.cnpj   = pagos.cnpj

  union all

  select 'sem_pagamento'::text, null::bigint, null::date, p.cnpj,
         p.nome, null::text, p.departamento, null::text, null::text, null::text, p.remuneracao
  from public.cac_pessoas p
  cross join l
  where p.ativo
    and cardinality(l.departamentos) > 0
    and p.departamento = any(l.departamentos)
    and not exists (select 1 from pagos where pagos.cnpj = p.cnpj)

  order by 1, 11 desc nulls last;
$$;

comment on function public.cac_celula(integer, integer, uuid) is
  'Lancamentos que compoem uma celula do painel CAC, mais as pessoas do departamento SEM pagamento no mes (tipo = sem_pagamento).';

-- Função nova em `public` nasce chamável sem login: `revoke from public` não
-- resolve, precisa ser `from anon` também.
revoke execute on function public.cac_painel(integer)                        from anon, public;
revoke execute on function public.cac_celula(integer, integer, uuid)         from anon, public;
revoke execute on function public.cac_linha_casa(text[], text[], text, text) from anon, public;
grant  execute on function public.cac_painel(integer)                        to authenticated, service_role;
grant  execute on function public.cac_celula(integer, integer, uuid)         to authenticated, service_role;
grant  execute on function public.cac_linha_casa(text[], text[], text, text) to authenticated, service_role;
