/* ============================================================================
 * O dinheiro que a demonstração não vê — e desde quando.
 *
 * Categoria do Omie sem DE-PARA não entra na DRE/DFC. Isso já custou caro uma
 * vez: em Jul/26 havia R$ 1.257.869 em 62 lançamentos em
 * `1.04.94 Transferência de Entrada*` e "Entradas Operacionais" aparecia como
 * 18 K contra 1,06 M de junho. O furo não dá erro em lugar nenhum: a linha
 * simplesmente não existe.
 *
 * MAS A LISTA CRUA É PAPEL DE PAREDE, e é por isso que esta função não devolve
 * só a soma. Medido contra a base real: `Transferência de Entrada*`,
 * `Transferência de Saída*`, `Aportes`, `CAPEX Equipamentos` e
 * `Construção, Reformas e Melhorias` aparecem TODO MÊS, somando mais de R$ 1,5 M,
 * e estão certos onde estão — transferência entre contas próprias e investimento
 * não são resultado. Um painel que gritasse isso todo mês seria desligado na
 * primeira semana.
 *
 * O que é notícia é a categoria que apareceu AGORA: alguém começou a lançar numa
 * conta que o mapa não conhece. Daí `meses_antes` — em quantos dos seis meses
 * anteriores aquela mesma categoria já aparecia órfã. Zero é a que precisa de
 * decisão; o resto é o de sempre, e a tela agrupa numa linha só.
 *
 * Irmã de `demonstracoes_lancamentos_busca` (20260901120000): MESMA atribuição
 * do omie-sync, mesmo LEFT JOIN no `omie_dre_mapa`, mesmo `distinct on` contra a
 * categoria mapeada duas vezes. Se a regra do sync mudar, as três mudam junto.
 * ========================================================================== */

create or replace function public.demonstracoes_sem_de_para(
  p_tipo  text,
  p_meses text[],
  p_piso  numeric default 1000
)
returns table (
  mes         text,
  categoria   text,
  codigo      text,
  quantidade  bigint,
  valor       numeric,
  meses_antes int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  /* `materialized` pelo mesmo motivo da busca: sem ele o planejador embute o
     bloco em cada referência e varre o blob de movimentos mais de uma vez.
     A janela é larga de propósito — `meses_antes` precisa enxergar os seis
     meses ANTERIORES aos que foram pedidos. */
  base as materialized (
    select *
    from (
      select
        det,
        case when upper(coalesce(det->>'cNatureza','R')) similar to '(P|D)%' then -1 else 1 end as sinal,
        case when p_tipo = 'dre'
          then to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY')
          else to_date(nullif(coalesce(det->>'dDtPagamento', det->>'dDtCredito', det->>'dDtConcilia'),''),'DD/MM/YYYY')
        end as dt,
        det->>'cCodCateg' as codigo,
        (det->>'nValorTitulo')::numeric as bruto
      from mov
    ) x
    where x.dt is not null
      -- Sem `nValorTitulo` é a perna bancária do mesmo título: vale zero aqui.
      and x.bruto is not null
      and x.dt >= (date_trunc('year', current_date) - interval '1 year')::date
      and x.dt <= current_date
  ),
  /* Uma categoria pode estar mapeada para mais de uma rubrica (a mesma conta
     servindo o demonstrativo e 'ambos'). Sem o `distinct on`, o título entraria
     duas vezes e o valor órfão sairia dobrado. `rubrica nulls last` faz a linha
     mapeada ganhar da órfã — órfã de verdade é a que não tem nenhuma. */
  ded as (
    select distinct on (b.det->>'nCodTitulo', b.dt, b.bruto)
      (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
        [extract(month from b.dt)::int] || '-' || to_char(b.dt,'YY')  as mes,
      (extract(year from b.dt)::int * 12 + extract(month from b.dt)::int) as ord,
      coalesce(c.descricao, b.codigo)                                 as categoria,
      b.codigo                                                        as codigo,
      b.sinal * abs(b.bruto)                                          as valor,
      dp.rubrica                                                      as rubrica
    from base b
    left join cat c on c.codigo = b.codigo
    left join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (p_tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
    order by b.det->>'nCodTitulo', b.dt, b.bruto, dp.rubrica nulls last
  ),
  orfas as (
    select mes, min(ord) as ord, categoria, min(codigo) as codigo,
           count(*) as quantidade, sum(valor) as valor
    from ded
    where rubrica is null
    group by mes, categoria
  )
  select
    o.mes, o.categoria, o.codigo, o.quantidade, o.valor,
    /* Em quantos dos SEIS meses anteriores esta mesma categoria já vinha órfã.
       Zero = novidade, e é a única que pede decisão. */
    (select count(distinct p.mes)::int
       from orfas p
      where p.categoria = o.categoria
        and p.ord between o.ord - 6 and o.ord - 1
        and abs(p.valor) >= coalesce(p_piso, 1000))          as meses_antes
  from orfas o
  where o.mes = any(p_meses)
    and abs(o.valor) >= coalesce(p_piso, 1000)
  order by abs(o.valor) desc;
$$;

comment on function public.demonstracoes_sem_de_para(text, text[], numeric) is
  'Categorias do Omie sem DE-PARA num ou mais meses — o dinheiro que a DRE/DFC não enxerga. `meses_antes` diz em quantos dos 6 meses anteriores a categoria já vinha órfã: zero é novidade e pede decisão, o resto é o de sempre (transferência entre contas, CAPEX, aporte).';

-- Função nova em `public` nasce chamável por `anon`: sem o revoke, o lançamento
-- a lançamento da empresa responderia a quem só tem a chave pública.
revoke all on function public.demonstracoes_sem_de_para(text, text[], numeric) from public;
revoke all on function public.demonstracoes_sem_de_para(text, text[], numeric) from anon;
grant execute on function public.demonstracoes_sem_de_para(text, text[], numeric) to authenticated;
grant execute on function public.demonstracoes_sem_de_para(text, text[], numeric) to service_role;

-- Sem o reload o PostgREST não anuncia a função nova e a tela leva 404 até o
-- cache expirar sozinho.
notify pgrst, 'reload schema';
