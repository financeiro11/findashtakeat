-- ===========================================================================
-- PLANO DE CONTAS: O ESPELHO DAS CATEGORIAS DO OMIE, CATEGORIA POR CATEGORIA.
--
-- Governança › Plano de contas. A DRE e a DFC olham a RUBRICA — o balde em que o
-- DE-PARA jogou várias categorias. Quem quer saber de que é feita UMA categoria
-- (quem recebe, quanto concentra, se o ritmo mudou, se alguém a reclassificou)
-- não tinha onde olhar: `demonstracoes_categorias` agrega por rubrica e só serve
-- ao mês que o painel da célula já abriu.
--
-- NADA É TABELA NOVA. As 178 categorias já moram em `omie_cache` chave
-- 'categorias' (o `omie-sync` repuxa a cada 24h) e os movimentos na chave
-- 'movimentos'. Espelhar numa tabela seria um terceiro lugar para envelhecer.
--
-- A REGRA É A DA DRE (`demonstracoes_lancamentos_interno`), para a soma de uma
-- categoria fechar com a linha em que ela cai:
--   • um lançamento = a linha do movimento que carrega `nValorTitulo`. A perna de
--     conta corrente (CONTA_CORRENTE_PAG/REC) é a baixa do MESMO título — medido em
--     14/09/2026: 7.016 linhas de 2026, todas com `nCodTitulo`. Somá-la dobraria;
--   • sinal pela natureza (P/D negativo);
--   • competência = dDtRegistro → emissão → previsão; caixa = pagamento → crédito
--     → conciliação;
--   • janela de 1º de janeiro do ano passado até hoje. Título lançado com
--     competência futura (há A VENCER até jun/27) fica fora, como na DRE;
--   • cancelado ENTRA, como na DRE (3 títulos em 2026). A lista mostra o status.
-- Sem rateio: nenhum movimento do cache traz `categorias[]` (medido), então cada
-- lançamento tem uma categoria só.
--
-- FOLHA. `categoria_e_folha` é a mesma trava do drill-down: quem não tem
-- `remuneracao` vê o TOTAL da categoria (a DRE mostra igual) mas não os
-- lançamentos, que são nome e salário de pessoa. As trocas de categoria que
-- envolvem folha somem pelo mesmo critério.
--
-- ACESSO. `demonstracoes` — as mesmas pessoas que abrem o drill-down da DRE, que
-- já mostra esses lançamentos por rubrica. Como toda RPC que lê `omie_cache`
-- (RLS ligada, sem policy), é SECURITY DEFINER: invoker leria vazio, calado.
-- Devolve jsonb, que não sofre o corte de 1.000 linhas do PostgREST — Receita de
-- Assinaturas passa disso num trimestre.
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
           -- O Omie devolve "<Disponível>" escapado como HTML.
           replace(replace(replace(c->>'descricao', '&lt;', '<'), '&gt;', '>'), '&amp;', '&') as descricao,
           nullif(nullif(c->>'categoria_superior', ''), '0') as superior,
           coalesce(c->>'totalizadora', 'N') = 'S'  as totalizadora,
           coalesce(c->>'conta_inativa', 'N') = 'S' as inativa,
           coalesce(c->>'conta_despesa', 'N') = 'S' as despesa,
           coalesce(c->>'conta_receita', 'N') = 'S' as receita,
           -- A chave do DE-PARA sai da descrição CRUA, igual ao omie-sync.
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
  base as (
    select m->'detalhes'->>'cCodCateg' as codigo,
           case when p_base = 'competencia'
             then to_date(nullif(coalesce(m->'detalhes'->>'dDtRegistro', m->'detalhes'->>'dDtEmissao', m->'detalhes'->>'dDtPrevisao'), ''), 'DD/MM/YYYY')
             else to_date(nullif(coalesce(m->'detalhes'->>'dDtPagamento', m->'detalhes'->>'dDtCredito', m->'detalhes'->>'dDtConcilia'), ''), 'DD/MM/YYYY')
           end as dt,
           case when upper(coalesce(m->'detalhes'->>'cNatureza', 'R')) similar to '(P|D)%' then -1 else 1 end
             * abs((m->'detalhes'->>'nValorTitulo')::numeric) as valor,
           nullif(m->'detalhes'->>'nCodCliente', '') as cliente
      from omie_cache, lateral jsonb_array_elements(dados) m
     where chave = 'movimentos'
       and m->'detalhes'->>'nValorTitulo' is not null
  ),
  mensal as (
    select codigo, to_char(dt, 'YYYY-MM') as mes,
           round(sum(valor), 2) as v, count(*) as n, count(distinct cliente) as k
      from base
     where dt is not null
       and dt >= (date_trunc('year', current_date) - interval '1 year')::date
       and dt <= current_date
     group by 1, 2
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
               'rubrica_dre', mp.rubrica_dre,
               'rubrica_dfc', mp.rubrica_dfc,
               'regra_nota', (select r.regra from omie_categoria_regra r where r.codigo = c.codigo),
               'folha', public.categoria_e_folha(c.descricao)
             ) order by c.codigo)
        from cat c
        left join mapa mp on mp.k = c.k
    ), '[]'::jsonb),
    -- Tupla em vez de objeto: são ~2.500 células e as chaves se repetiriam em todas.
    -- [codigo, 'YYYY-MM', valor com sinal, lançamentos, contrapartes distintas]
    'mensal', coalesce((
      select jsonb_agg(jsonb_build_array(codigo, mes, v, n, k) order by codigo, mes) from mensal
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

comment on function public.plano_contas_resumo(text) is
  'Governança › Plano de contas: as categorias do Omie (árvore, DE-PARA, regra de nota, folha) e o valor mês a mês de cada uma, na regra da DRE (competencia) ou da DFC (caixa). Exige demonstracoes.';

-- ───────────────────────── Os lançamentos de uma categoria ─────────────────────────

/* `p_codigo` aceita categoria-folha ("2.04.09") ou grupo ("2.04"): o grupo leva os
   filhos junto, pelo prefixo do código. A tela pede a janela inteira (período em
   foco + o anterior) de uma vez e recorta no cliente — é o que deixa comparar
   contrapartes sem uma segunda ida. */
create or replace function public.plano_contas_lancamentos(
  p_codigo text,
  p_base text default 'competencia',
  p_de date default null,
  p_ate date default null
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
  if coalesce(btrim(p_codigo), '') = '' then
    raise exception 'Informe o código da categoria.';
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
           nullif(regexp_replace(coalesce(d->>'cCPFCNPJCliente', ''), '\D', '', 'g'), '') as doc
      from (
        select m->'detalhes' as d
          from omie_cache, lateral jsonb_array_elements(dados) m
         where chave = 'movimentos'
           and m->'detalhes'->>'nValorTitulo' is not null
           and (m->'detalhes'->>'cCodCateg' = p_codigo
                or m->'detalhes'->>'cCodCateg' like p_codigo || '.%')
      ) x
  ),
  janela as materialized (
    select b.*, coalesce(c.descricao, b.codigo) as descricao
      from base b
      left join cat c on c.codigo = b.codigo
     where b.dt is not null and b.dt >= v_de and b.dt <= v_ate
  ),
  visiveis as materialized (
    select * from janela
     where v_folha or not public.categoria_e_folha(descricao)
  ),
  -- Mesmo nome limpo do drill-down: corta o documento que a Receita cola no nome do MEI.
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
    'codigo', p_codigo,
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
    -- Quem entrou e quem saiu desta categoria pelo Hub (drill-down, lote, chat da célula).
    'alteracoes', coalesce((
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
           where (a.categoria_de = p_codigo or a.categoria_de like p_codigo || '.%'
               or a.categoria_para = p_codigo or a.categoria_para like p_codigo || '.%')
             and (v_folha or not (public.categoria_e_folha(a.descricao_de)
                                  or public.categoria_e_folha(a.descricao_para)))
           order by a.criado_em desc
           limit 100
        ) a
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$function$;

alter function public.plano_contas_lancamentos(text, text, date, date) set statement_timeout = '20s';

revoke all on function public.plano_contas_lancamentos(text, text, date, date) from public;
revoke all on function public.plano_contas_lancamentos(text, text, date, date) from anon;
grant execute on function public.plano_contas_lancamentos(text, text, date, date) to authenticated, service_role;

comment on function public.plano_contas_lancamentos(text, text, date, date) is
  'Governança › Plano de contas: os lançamentos de uma categoria (ou de um grupo, pelo prefixo do código) numa janela, com contraparte, observação do título, justificativa e as trocas de categoria que a tocaram. Folha só para quem tem remuneracao. Exige demonstracoes.';

-- ───────────────────────── Conferência ─────────────────────────

do $$
declare
  v_resumo jsonb;
  v_lanc   jsonb;
  v_soma_resumo numeric;
  v_soma_lanc   numeric;
  v_n_resumo    int;
  v_n_lanc      int;
  v_dre         numeric;
  v_rpc         numeric;
begin
  -- 1. O resumo de agosto numa categoria tem de fechar com a lista de lançamentos.
  v_resumo := public.plano_contas_resumo('competencia');
  select coalesce(sum((t->>2)::numeric), 0), coalesce(sum((t->>3)::int), 0)
    into v_soma_resumo, v_n_resumo
    from jsonb_array_elements(v_resumo->'mensal') t
   where t->>0 = '2.02.94' and t->>1 = '2026-08';

  v_lanc := public.plano_contas_lancamentos('2.02.94', 'competencia', '2026-08-01', '2026-08-31');
  select coalesce(sum((l->>'valor')::numeric), 0), count(*)
    into v_soma_lanc, v_n_lanc
    from jsonb_array_elements(v_lanc->'lancamentos') l;

  raise notice '2.02.94 ago/26: resumo % (% lanç.) · lista % (% lanç.)', v_soma_resumo, v_n_resumo, v_soma_lanc, v_n_lanc;
  if v_soma_resumo <> v_soma_lanc or v_n_resumo <> v_n_lanc then
    raise exception 'Resumo e lista divergem em 2.02.94 ago/26';
  end if;

  -- 2. Somando as categorias que o DE-PARA põe em "Eventos e Feiras", tem de dar a
  --    mesma soma que o drill-down da DRE usa (mesma regra, outra função).
  select coalesce(sum(valor), 0) into v_rpc
    from public.demonstracoes_lancamentos_interno('dre', 'Eventos e Feiras', 'Aug-26');

  select coalesce(sum((t->>2)::numeric), 0) into v_dre
    from jsonb_array_elements(v_resumo->'mensal') t
    join jsonb_array_elements(v_resumo->'categorias') c on c->>'codigo' = t->>0
   where t->>1 = '2026-08' and c->>'rubrica_dre' = 'Eventos e Feiras';

  raise notice 'Eventos e Feiras ago/26: plano de contas % · drill-down da DRE %', v_dre, v_rpc;
  if v_dre <> v_rpc then
    raise exception 'O plano de contas não fecha com a DRE em Eventos e Feiras ago/26: % × %', v_dre, v_rpc;
  end if;

  -- 3. Grupo = soma dos filhos.
  v_lanc := public.plano_contas_lancamentos('2.02', 'competencia', '2026-08-01', '2026-08-31');
  select coalesce(sum((l->>'valor')::numeric), 0) into v_soma_lanc
    from jsonb_array_elements(v_lanc->'lancamentos') l;
  select coalesce(sum((t->>2)::numeric), 0) into v_soma_resumo
    from jsonb_array_elements(v_resumo->'mensal') t
   where t->>0 like '2.02.%' and t->>1 = '2026-08';
  raise notice 'Grupo 2.02 ago/26: resumo % · lista %', v_soma_resumo, v_soma_lanc;
  if v_soma_resumo <> v_soma_lanc then
    raise exception 'O grupo 2.02 não fecha com os filhos em ago/26';
  end if;
end $$;
