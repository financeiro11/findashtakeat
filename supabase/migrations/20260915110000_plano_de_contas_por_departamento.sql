-- ===========================================================================
-- PLANO DE CONTAS: OS DEPARTAMENTOS DO OMIE ENTRAM NA ANÁLISE.
--
-- O título do Omie tem distribuição por departamento (`distribuicao` no
-- ConsultarContaPagar; `departamentos` no ListarMovimentos, só com
-- `cExibirDepartamentos = "S"`). O cache de movimentos nunca pediu isso — a
-- partir de hoje pede (_shared/omie.ts), e os departamentos chegam na próxima
-- leitura do Omie.
--
-- O QUE A AMOSTRA MOSTROU (conta Sicoob, registro em ago/26, 8 páginas):
--   • 110 de 398 títulos (28%) têm departamento — sempre um só, a 100%;
--   • aparecem em MANP e APIP (folha, sobretudo); BARP e RPTP nenhum;
--   • contas a receber: nenhum (0 de 39).
-- Ou seja: a maior parte do valor fica em "Sem departamento", e a tela diz isso
-- em vez de fingir cobertura. A lista de departamentos (26) é a do cache
-- `folha_cadastros`, que o sync da folha mantém.
--
-- REGRA DO VALOR: o lançamento entra em cada departamento pelo percentual da
-- distribuição (`nDistrPercentual`), sobre o mesmo valor com sinal da DRE.
-- Sem distribuição, entra inteiro em "sem departamento" (departamento nulo).
-- O arredondamento é por (categoria, departamento, mês) — a soma pode diferir
-- da categoria em centavos.
--
-- `plano_contas_lancamentos` ganha `p_departamento` (código do Omie, ou
-- '__sem__'). A assinatura muda, então a de 4 argumentos sai — duas versões
-- vivas fariam quem chama sem o parâmetro cair na velha.
-- ===========================================================================

create or replace function public.plano_contas_resumo(p_base text default 'competencia')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
begin
  if not public.exigir('demonstracoes', 'plano_contas_resumo') then
    return null;
  end if;
  if p_base not in ('competencia', 'caixa') then
    raise exception 'Base desconhecida: % (use competencia ou caixa)', p_base;
  end if;

  with
  cat as (
    select c->>'codigo' as codigo,
           replace(replace(replace(c->>'descricao', '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as descricao,
           nullif(nullif(c->>'categoria_superior', ''), '0') as superior,
           coalesce(c->>'totalizadora', 'N') = 'S'  as totalizadora,
           coalesce(c->>'conta_inativa', 'N') = 'S' as inativa,
           coalesce(c->>'conta_despesa', 'N') = 'S' as despesa,
           coalesce(c->>'conta_receita', 'N') = 'S' as receita,
           coalesce(c->>'definida_pelo_usuario', 'N') = 'S' as do_usuario,
           nullif(c->>'natureza', '') as observacao,
           nullif(c->>'id_conta_contabil', '') as conta_contabil,
           lower(btrim(regexp_replace(unaccent(coalesce(c->>'descricao', '')), '\s+', ' ', 'g'))) as k
      from omie_cache, lateral jsonb_array_elements(dados) c
     where chave = 'categorias'
       and nullif(c->>'codigo', '') is not null
  ),
  mapa as (
    select lower(btrim(regexp_replace(unaccent(codigo_categoria), '\s+', ' ', 'g'))) as k,
           max(rubrica) filter (where demonstrativo in ('dre', 'ambos')) as rubrica_dre,
           max(rubrica) filter (where demonstrativo in ('dfc', 'ambos')) as rubrica_dfc
      from omie_dre_mapa
     where ativo is not false
     group by 1
  ),
  base as materialized (
    select m->'detalhes'->>'cCodCateg' as codigo,
           case when p_base = 'competencia'
             then to_date(nullif(coalesce(m->'detalhes'->>'dDtRegistro', m->'detalhes'->>'dDtEmissao', m->'detalhes'->>'dDtPrevisao'), ''), 'DD/MM/YYYY')
             else to_date(nullif(coalesce(m->'detalhes'->>'dDtPagamento', m->'detalhes'->>'dDtCredito', m->'detalhes'->>'dDtConcilia'), ''), 'DD/MM/YYYY')
           end as dt,
           case when upper(coalesce(m->'detalhes'->>'cNatureza', 'R')) similar to '(P|D)%' then -1 else 1 end
             * abs((m->'detalhes'->>'nValorTitulo')::numeric) as valor,
           nullif(m->'detalhes'->>'nCodCliente', '') as cliente,
           case when jsonb_typeof(m->'departamentos') = 'array' and jsonb_array_length(m->'departamentos') > 0
                then m->'departamentos' end as deps,
           (m ? 'departamentos') as leu_departamentos
      from omie_cache, lateral jsonb_array_elements(dados) m
     where chave = 'movimentos'
       and m->'detalhes'->>'nValorTitulo' is not null
  ),
  uso as (
    select codigo, count(*) as usos, max(dt) as ultimo_uso from base group by 1
  ),
  mensal as (
    select codigo, to_char(dt, 'YYYY-MM') as mes,
           round(sum(valor), 2) as v, count(*) as n, count(distinct cliente) as k
      from base
     where dt is not null
       and dt >= (date_trunc('year', current_date) - interval '1 year')::date
       and dt <= current_date
     group by 1, 2
  ),
  mensal_dep as (
    select b.codigo, d->>'cCodDepartamento' as dep, to_char(b.dt, 'YYYY-MM') as mes,
           round(sum(b.valor * coalesce(nullif(d->>'nDistrPercentual', '')::numeric, 100) / 100), 2) as v,
           count(*) as n
      from base b
      left join lateral jsonb_array_elements(b.deps) d on true
     where b.dt is not null
       and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
       and b.dt <= current_date
     group by 1, 2, 3
  )
  select jsonb_build_object(
    'base', p_base,
    'hoje', current_date,
    'categorias_atualizado_em', (select atualizado_em from omie_cache where chave = 'categorias'),
    'movimentos_atualizado_em', (select atualizado_em from omie_cache where chave = 'movimentos'),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', c.codigo,
               'descricao', c.descricao,
               'superior', c.superior,
               'totalizadora', c.totalizadora,
               'inativa', c.inativa,
               'despesa', c.despesa,
               'receita', c.receita,
               'do_usuario', c.do_usuario,
               'observacao', c.observacao,
               'conta_contabil', c.conta_contabil,
               'rubrica_dre', mp.rubrica_dre,
               'rubrica_dfc', mp.rubrica_dfc,
               'regra_nota', (select r.regra from omie_categoria_regra r where r.codigo = c.codigo),
               'folha', public.categoria_e_folha(c.descricao),
               'usos', coalesce(u.usos, 0),
               'ultimo_uso', u.ultimo_uso
             ) order by c.codigo)
        from cat c
        left join mapa mp on mp.k = c.k
        left join uso u on u.codigo = c.codigo
    ), '[]'::jsonb),
    'mensal', coalesce((
      select jsonb_agg(jsonb_build_array(codigo, mes, v, n, k) order by codigo, mes) from mensal
    ), '[]'::jsonb),
    -- [categoria, departamento (null = sem), 'YYYY-MM', valor com sinal pela distribuição, lançamentos]
    'mensal_dep', coalesce((
      select jsonb_agg(jsonb_build_array(codigo, dep, mes, v, n) order by codigo, dep, mes) from mensal_dep
    ), '[]'::jsonb),
    -- A leitura do Omie já trouxe o campo? Antes da primeira varredura com o
    -- parâmetro, tudo cairia em "sem departamento" — e a tela precisa dizer que
    -- é falta de leitura, não falta de departamento.
    'departamentos_carregados', exists (select 1 from base where leu_departamentos),
    'departamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', d->>'codigo',
               'descricao', d->>'descricao',
               'inativo', coalesce((d->>'inativo')::boolean, false)
             ) order by d->>'descricao')
        from omie_cache,
             lateral jsonb_array_elements(case when jsonb_typeof(dados->'departamentos') = 'array'
                                               then dados->'departamentos' else '[]'::jsonb end) d
       where chave = 'folha_cadastros'
    ), '[]'::jsonb),
    'departamentos_atualizado_em', (select atualizado_em from omie_cache where chave = 'folha_cadastros'),
    'cadastro', coalesce((
      select jsonb_agg(jsonb_build_object(
               'acao', l.acao, 'codigo', l.codigo, 'superior', l.superior,
               'descricao_de', l.descricao_de, 'descricao_para', l.descricao_para,
               'rubrica_dre', l.rubrica_dre, 'rubrica_dfc', l.rubrica_dfc,
               'referencias', l.referencias, 'motivo', l.motivo,
               'por', l.alterado_por_email, 'criado_em', l.criado_em
             ) order by l.criado_em desc)
        from (select * from omie_categoria_cadastro_log order by criado_em desc limit 200) l
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$function$;

alter function public.plano_contas_resumo(text) set statement_timeout = '20s';
revoke all on function public.plano_contas_resumo(text) from public;
revoke all on function public.plano_contas_resumo(text) from anon;
grant execute on function public.plano_contas_resumo(text) to authenticated, service_role;

-- ───────────────────────── Lançamentos, agora com departamento ─────────────────────────

drop function if exists public.plano_contas_lancamentos(text, text, date, date);

create or replace function public.plano_contas_lancamentos(
  p_codigo text,
  p_base text default 'competencia',
  p_de date default null,
  p_ate date default null,
  p_departamento text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_folha boolean := case
    when auth.uid() is null then true          -- cron / service_role
    else public.pode_ver_remuneracao()
  end;
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_dep    text := nullif(btrim(coalesce(p_departamento, '')), '');
  v_de  date := greatest(coalesce(p_de, '-infinity'::date), (date_trunc('year', current_date) - interval '1 year')::date);
  v_ate date := least(coalesce(p_ate, current_date), current_date);
  v_out jsonb;
begin
  if not public.exigir('demonstracoes', 'plano_contas_lancamentos') then
    return null;
  end if;
  if p_base not in ('competencia', 'caixa') then
    raise exception 'Base desconhecida: % (use competencia ou caixa)', p_base;
  end if;
  if v_codigo is null and v_dep is null then
    raise exception 'Informe a categoria ou o departamento.';
  end if;

  with
  cat as materialized (
    select c->>'codigo' as codigo,
           replace(replace(replace(c->>'descricao', '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as descricao
      from omie_cache, lateral jsonb_array_elements(dados) c
     where chave = 'categorias'
  ),
  base as materialized (
    select d,
           d->>'cCodCateg' as codigo,
           case when p_base = 'competencia'
             then to_date(nullif(coalesce(d->>'dDtRegistro', d->>'dDtEmissao', d->>'dDtPrevisao'), ''), 'DD/MM/YYYY')
             else to_date(nullif(coalesce(d->>'dDtPagamento', d->>'dDtCredito', d->>'dDtConcilia'), ''), 'DD/MM/YYYY')
           end as dt,
           case when upper(coalesce(d->>'cNatureza', 'R')) similar to '(P|D)%' then -1 else 1 end
             * abs((d->>'nValorTitulo')::numeric) as valor,
           nullif(d->>'nCodCliente', '') as cliente,
           nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '\D', '', 'g'), '') as doc,
           deps
      from (
        select m->'detalhes' as d,
               case when jsonb_typeof(m->'departamentos') = 'array' and jsonb_array_length(m->'departamentos') > 0
                    then m->'departamentos' end as deps
          from omie_cache, lateral jsonb_array_elements(dados) m
         where chave = 'movimentos'
           and m->'detalhes'->>'nValorTitulo' is not null
           and (v_codigo is null
                or m->'detalhes'->>'cCodCateg' = v_codigo
                or m->'detalhes'->>'cCodCateg' like v_codigo || '.%')
      ) x
  ),
  janela as materialized (
    select b.*, coalesce(c.descricao, b.codigo) as descricao,
           case
             when v_dep is null or v_dep = '__sem__' then 100::numeric
             else (select coalesce(nullif(e->>'nDistrPercentual', '')::numeric, 100)
                     from jsonb_array_elements(b.deps) e
                    where e->>'cCodDepartamento' = v_dep limit 1)
           end as pct_dep
      from base b
      left join cat c on c.codigo = b.codigo
     where b.dt is not null and b.dt >= v_de and b.dt <= v_ate
       and (v_dep is null
            or (v_dep = '__sem__' and b.deps is null)
            or exists (select 1 from jsonb_array_elements(b.deps) e where e->>'cCodDepartamento' = v_dep))
  ),
  visiveis as materialized (
    select * from janela
     where v_folha or not public.categoria_e_folha(descricao)
  ),
  cli as materialized (
    select distinct on (c->>'codigo')
           c->>'codigo' as codigo,
           coalesce(
             nullif(btrim(regexp_replace(
               regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
               '\s+\d{11}$', '')), ''),
             c->>'nome'
           ) as nome
      from omie_cache, lateral jsonb_array_elements(dados) c
     where chave = 'clientes'
       and c->>'codigo' in (select cliente from visiveis where cliente is not null)
     order by c->>'codigo'
  ),
  forn as materialized (
    select distinct on (regexp_replace(documento, '\D', '', 'g'))
           regexp_replace(documento, '\D', '', 'g') as doc, nome
      from lib_fornecedores
     where regexp_replace(coalesce(documento, ''), '\D', '', 'g') <> ''
     order by regexp_replace(documento, '\D', '', 'g'), nome
  )
  select jsonb_build_object(
    'codigo', v_codigo,
    'departamento', v_dep,
    'base', p_base,
    'de', v_de,
    'ate', v_ate,
    'ocultos', (select count(*) from janela) - (select count(*) from visiveis),
    'lancamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'data', vv.dt,
               'vencimento', to_date(nullif(vv.d->>'dDtVenc', ''), 'DD/MM/YYYY'),
               'pagamento', to_date(nullif(vv.d->>'dDtPagamento', ''), 'DD/MM/YYYY'),
               'titulo', nullif(vv.d->>'cNumTitulo', ''),
               'documento', nullif(vv.d->>'cNumDocFiscal', ''),
               'parcela', nullif(vv.d->>'cNumParcela', ''),
               'contraparte', coalesce(nullif(btrim(cli.nome), ''), f.nome),
               'cod_cliente', vv.cliente,
               'cnpj_cpf', nullif(vv.d->>'cCPFCNPJCliente', ''),
               'categoria', vv.codigo,
               'grupo', nullif(vv.d->>'cGrupo', ''),
               'status', nullif(vv.d->>'cStatus', ''),
               'origem', nullif(vv.d->>'cOrigem', ''),
               'valor', vv.valor,
               'valor_departamento', round(vv.valor * vv.pct_dep / 100, 2),
               'departamentos', (select jsonb_agg(jsonb_build_object(
                                          'codigo', e->>'cCodDepartamento',
                                          'pct', coalesce(nullif(e->>'nDistrPercentual', '')::numeric, 100)))
                                   from jsonb_array_elements(vv.deps) e),
               'cod_titulo', vv.d->>'nCodTitulo',
               'observacao', t.observacao,
               'nota', n.texto
             ) order by vv.dt desc, abs(vv.valor) desc)
        from visiveis vv
        left join cli on cli.codigo = vv.cliente
        left join forn f on f.doc = vv.doc
        left join omie_titulo_texto t
          on vv.d->>'nCodTitulo' ~ '^\d+$' and t.cod_titulo = (vv.d->>'nCodTitulo')::bigint
        left join lateral (
          select texto from demonstracoes_lancamento_nota nn
           where nn.cod_titulo = vv.d->>'nCodTitulo'
           order by nn.atualizado_em desc nulls last
           limit 1
        ) n on true
    ), '[]'::jsonb),
    'alteracoes', case when v_codigo is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'criado_em', a.criado_em,
               'cod_titulo', a.cod_titulo,
               'contraparte', a.contraparte,
               'data', a.data,
               'valor', a.valor,
               'categoria_de', a.categoria_de,
               'descricao_de', a.descricao_de,
               'categoria_para', a.categoria_para,
               'descricao_para', a.descricao_para,
               'motivo', a.motivo,
               'origem', a.origem,
               'por', a.alterado_por_email
             ) order by a.criado_em desc)
        from (
          select * from omie_categoria_alteracoes a
           where (a.categoria_de = v_codigo or a.categoria_de like v_codigo || '.%'
               or a.categoria_para = v_codigo or a.categoria_para like v_codigo || '.%')
             and (v_folha or not (public.categoria_e_folha(a.descricao_de)
                                  or public.categoria_e_folha(a.descricao_para)))
           order by a.criado_em desc
           limit 100
        ) a
    ), '[]'::jsonb) end
  )
  into v_out;

  return v_out;
end;
$function$;

alter function public.plano_contas_lancamentos(text, text, date, date, text) set statement_timeout = '20s';

revoke all on function public.plano_contas_lancamentos(text, text, date, date, text) from public;
revoke all on function public.plano_contas_lancamentos(text, text, date, date, text) from anon;
grant execute on function public.plano_contas_lancamentos(text, text, date, date, text) to authenticated, service_role;

-- ───────────────────────── Conferência ─────────────────────────

do $$
declare
  v_resumo jsonb;
  v_lanc jsonb;
  v_dif numeric;
  v_a numeric;
  v_b numeric;
begin
  v_resumo := public.plano_contas_resumo('competencia');
  if not (v_resumo ? 'mensal_dep' and v_resumo ? 'departamentos' and v_resumo ? 'departamentos_carregados') then
    raise exception 'resumo sem os campos de departamento';
  end if;

  -- a) Somando os departamentos de cada (categoria, mês), dá a categoria — a menos
  --    dos centavos do arredondamento por grupo.
  select coalesce(max(abs(m.v - d.v)), 0) into v_dif
    from (select t->>0 c, t->>1 mes, (t->>2)::numeric v from jsonb_array_elements(v_resumo->'mensal') t) m
    join (select t->>0 c, t->>2 mes, sum((t->>3)::numeric) v from jsonb_array_elements(v_resumo->'mensal_dep') t group by 1, 2) d
      on d.c = m.c and d.mes = m.mes;
  raise notice 'maior diferença categoria × soma dos departamentos: %', v_dif;
  if v_dif > 1 then raise exception 'departamentos não fecham com a categoria (dif %)', v_dif; end if;

  -- b) A lista filtrada por "sem departamento" + a dos que têm = a lista da categoria.
  v_lanc := public.plano_contas_lancamentos('2.03', 'competencia', '2026-08-01', '2026-08-31');
  select coalesce(sum((l->>'valor')::numeric), 0) into v_a from jsonb_array_elements(v_lanc->'lancamentos') l;
  v_lanc := public.plano_contas_lancamentos('2.03', 'competencia', '2026-08-01', '2026-08-31', '__sem__');
  select coalesce(sum((l->>'valor')::numeric), 0) into v_b from jsonb_array_elements(v_lanc->'lancamentos') l;
  select v_b + coalesce(sum((l->>'valor')::numeric), 0) into v_b
    from jsonb_array_elements(public.plano_contas_lancamentos('2.03', 'competencia', '2026-08-01', '2026-08-31')->'lancamentos') l
   where l->'departamentos' is not null and l->'departamentos' <> 'null'::jsonb;
  raise notice '2.03 ago/26: lista % · sem departamento + com departamento %', v_a, v_b;
  if abs(v_a - v_b) > 0.01 then raise exception 'filtro "sem departamento" perde lançamento: % × %', v_a, v_b; end if;

  -- c) Só departamento, sem categoria, também responde.
  perform public.plano_contas_lancamentos(null, 'competencia', '2026-08-01', '2026-08-31', '__sem__');
end $$;
