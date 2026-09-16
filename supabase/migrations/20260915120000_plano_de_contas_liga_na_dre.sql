-- ===========================================================================
-- PLANO DE CONTAS ↔ DRE/DFC: AS DUAS TELAS PASSAM A SE ENXERGAR.
--
-- Duas peças de banco para as ligações:
--
-- 1. `plano_contas_de_para_saude` — o DE-PARA casa categoria pela DESCRIÇÃO, e
--    ninguém avisa quando o nome muda no Omie. Medido em 15/09/2026: 53 linhas
--    ativas do DE-PARA apontavam para nomes que NÃO EXISTEM MAIS no plano do Omie.
--      • 4 só na pontuação — "3.2.2 Frete - Operação" contra o atual
--        "3.2.2. Frete - Operação". É por isso que o Frete (76 lançamentos em 2026)
--        estava fora da DRE, calado;
--      • 10 com o mesmo nome e número diferente ("3.2.7.2. Pessoal - Sucesso"
--        contra o atual "3.2.7.3.") — pedem olho humano;
--      • 39 sem par: categorias antigas.
--    A função diz, linha a linha, se o nome existe, qual categoria parece ser a
--    mesma e se ela já tem outra linha no DE-PARA. NÃO conserta nada sozinha:
--    trocar o DE-PARA muda a DRE, e "parece ser" não é "é".
--
-- 2. `plano_contas_lancamentos` passa a devolver os SUSPEITOS de reclassificação
--    (`omie_reclassificacoes`, status aberto) entre os lançamentos da categoria.
--    O alerta já existia célula a célula na DRE; aqui ele aparece do lado da
--    categoria, que é onde se decide se o fornecedor está no lugar certo.
-- ===========================================================================

create or replace function public.plano_contas_de_para_saude(p_demonstrativo text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
begin
  if not public.exigir('demonstracoes', 'plano_contas_de_para_saude') then
    return null;
  end if;

  with
  cats as materialized (
    select c->>'codigo' as codigo,
           replace(replace(replace(c->>'descricao', '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as descricao,
           coalesce(c->>'conta_inativa', 'N') = 'S' as inativa,
           -- a chave do omie-sync
           lower(btrim(regexp_replace(unaccent(coalesce(c->>'descricao', '')), '\s+', ' ', 'g'))) as k,
           -- só letras e números: "3.2.2 Frete" = "3.2.2. Frete"
           regexp_replace(lower(unaccent(coalesce(c->>'descricao', ''))), '[^a-z0-9]+', '', 'g') as k2,
           -- sem a numeração da casa: "Pessoal - Sucesso"
           lower(btrim(regexp_replace(unaccent(regexp_replace(coalesce(c->>'descricao', ''), '^[\d.\s]+', '')), '\s+', ' ', 'g'))) as nome
      from omie_cache, lateral jsonb_array_elements(dados) c
     where chave = 'categorias'
       and coalesce(c->>'totalizadora', 'N') <> 'S'
       and nullif(c->>'codigo', '') is not null
  ),
  mapa as materialized (
    select m.id, m.codigo_categoria, m.rubrica, m.demonstrativo,
           lower(btrim(regexp_replace(unaccent(m.codigo_categoria), '\s+', ' ', 'g'))) as k,
           regexp_replace(lower(unaccent(m.codigo_categoria)), '[^a-z0-9]+', '', 'g') as k2,
           lower(btrim(regexp_replace(unaccent(regexp_replace(m.codigo_categoria, '^[\d.\s]+', '')), '\s+', ' ', 'g'))) as nome
      from omie_dre_mapa m
     where m.ativo is not false
       and (p_demonstrativo is null or m.demonstrativo = p_demonstrativo)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'codigo_categoria', m.codigo_categoria,
           'rubrica', m.rubrica,
           'demonstrativo', m.demonstrativo,
           'codigo', ex.codigo,
           'inativa', ex.inativa,
           'sugestao_codigo', sg.codigo,
           'sugestao_descricao', sg.descricao,
           'sugestao_motivo', sg.motivo,
           'sugestao_ja_mapeada', case when sg.codigo is null then null
             else exists (select 1 from mapa o where o.demonstrativo = m.demonstrativo and o.k = sg.k) end
         ) order by m.demonstrativo, m.codigo_categoria), '[]'::jsonb)
    into v_out
    from mapa m
    left join lateral (
      select c.codigo, c.inativa from cats c where c.k = m.k order by c.inativa, c.codigo limit 1
    ) ex on true
    left join lateral (
      select s.codigo, s.descricao, s.k, s.motivo
        from (
          select c.codigo, c.descricao, c.k, 'pontuacao'::text as motivo, 1 as ordem, c.inativa
            from cats c where c.k2 = m.k2
          union all
          select c.codigo, c.descricao, c.k, 'numero'::text, 2, c.inativa
            from cats c where m.nome <> '' and c.nome = m.nome and c.k2 <> m.k2
        ) s
       where ex.codigo is null
       order by s.ordem, s.inativa, s.codigo
       limit 1
    ) sg on true;

  return v_out;
end;
$function$;

alter function public.plano_contas_de_para_saude(text) set statement_timeout = '15s';
revoke all on function public.plano_contas_de_para_saude(text) from public;
revoke all on function public.plano_contas_de_para_saude(text) from anon;
grant execute on function public.plano_contas_de_para_saude(text) to authenticated, service_role;

comment on function public.plano_contas_de_para_saude(text) is
  'Linha a linha do DE-PARA: o nome ainda existe no plano de contas do Omie? Se não, qual categoria parece ser a mesma (pontuação ou numeração diferente) e se ela já tem linha própria. Só diagnostica.';

-- ───────────────────────── Lançamentos + suspeitos de reclassificação ─────────────────────────

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
    /* Os alertas de reclassificação ABERTOS entre estes lançamentos. O tipo segue
       a base: competência é a DRE, caixa é a DFC — o alerta de uma não vale para
       a outra (a rubrica muda). */
    'suspeitos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'cod_titulo', r.cod_titulo,
               'mes', r.mes,
               'rubrica', r.rubrica,
               'rubrica_padrao', r.rubrica_padrao,
               'fornecedor', r.fornecedor,
               'valor', r.valor,
               'valor_padrao', r.valor_padrao,
               'severidade', r.severidade,
               'hist_lancamentos', r.hist_lancamentos,
               'hist_no_padrao', r.hist_no_padrao
             ) order by abs(r.valor) desc)
        from omie_reclassificacoes r
       where coalesce(r.status, 'aberto') = 'aberto'
         and r.tipo = case when p_base = 'competencia' then 'dre' else 'dfc' end
         and r.cod_titulo::text in (select v2.d->>'nCodTitulo' from visiveis v2)
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
  v jsonb;
  v_orfas int;
  v_pont int;
  v_frete jsonb;
begin
  v := public.plano_contas_de_para_saude(null);
  select count(*) filter (where l->>'codigo' is null),
         count(*) filter (where l->>'sugestao_motivo' = 'pontuacao')
    into v_orfas, v_pont
    from jsonb_array_elements(v) l;
  raise notice 'DE-PARA: % linhas órfãs, % com par só de pontuação', v_orfas, v_pont;
  if v_pont = 0 then raise exception 'saúde do DE-PARA não achou os pares de pontuação medidos'; end if;

  select l into v_frete from jsonb_array_elements(v) l where l->>'codigo_categoria' = '3.2.2 Frete - Operação' limit 1;
  if v_frete is not null and coalesce(v_frete->>'sugestao_codigo', '') <> '2.01.02' then
    raise exception 'o Frete devia sugerir 2.01.02: %', v_frete;
  end if;

  v := public.plano_contas_lancamentos('2.02', 'competencia', '2026-06-01', '2026-08-31');
  if not (v ? 'suspeitos') then raise exception 'lançamentos sem a chave suspeitos'; end if;
  raise notice 'suspeitos em 2.02 jun–ago/26: %', jsonb_array_length(v->'suspeitos');
end $$;
