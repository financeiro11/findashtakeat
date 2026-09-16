-- ===========================================================================
-- PLANO DE CONTAS: A CONTA CONTÁBIL DE CADA CATEGORIA APARECE NA TELA.
--
-- Medido em 15/09/2026 criando uma categoria de teste pelo Hub (2.04.90): o
-- `IncluirCategoria` do Omie grava a categoria SEM `id_conta_contabil` e sem
-- `codigo_dre` (a DRE interna do Omie) — e a API não tem campo para a conta
-- contábil. A DRE do Hub não depende disso (casa pelo DE-PARA), mas a
-- contabilidade depende. O resumo passa a trazer a conta, para a tela marcar
-- "sem conta contábil" até alguém completar no Omie.
--
-- Única mudança na função: o campo 'conta_contabil'. O resto é a versão de
-- 20260915090000, repetida porque `create or replace` troca o corpo inteiro.
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

do $$
declare v jsonb;
begin
  v := public.plano_contas_resumo('competencia');
  -- 2.04.07 tem conta contábil no Omie (411080003); tem de atravessar.
  if not exists (select 1 from jsonb_array_elements(v->'categorias') c where c->>'codigo' = '2.04.07' and c->>'conta_contabil' is not null) then
    raise exception 'conta_contabil não chegou ao resumo';
  end if;
end $$;
