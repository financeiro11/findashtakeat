-- ===========================================================================
-- PLANO DE CONTAS: O HUB PASSA A CRIAR, RENOMEAR E DESATIVAR CATEGORIAS NO OMIE.
--
-- Quem escreve no ERP é a Edge Function `omie-plano-contas` (IncluirCategoria /
-- AlterarCategoria). Esta migration dá a ela as três peças de banco:
--
--   1. `omie_categoria_cadastro_log` — a trilha: quem criou, renomeou, desativou.
--   2. `omie_cache_categoria_aplicar` — espelha a mudança no cache SEM repuxar a
--      lista do Omie (duas ListarCategorias iguais em <60s são recusadas como
--      redundantes). Não mexe em `atualizado_em`: o cache continua "velho" na hora
--      certa e a sincronização diária reconcilia tudo.
--   3. `plano_contas_renomear_referencias` — O MOTIVO DE UM RENOMEAR SER PERIGOSO.
--      Quatro tabelas casam categoria pela DESCRIÇÃO, não pelo código:
--        • omie_dre_mapa        (DE-PARA da DRE/DFC — `codigo_categoria` guarda a descrição)
--        • orcamento_omie_map   (realizado do Orçamento — PK é a descrição)
--        • folha_depara         (categoria de cada pessoa na folha)
--        • cartao_omie_map      (de-para do cartão — rótulo ao lado do código)
--      e `omie_categoria_regra` guarda a descrição como rótulo. Renomear no Omie
--      sem levar o nome junto tiraria a categoria da DRE, do Orçamento e da folha
--      calada, no próximo sync.
--
-- O `plano_contas_resumo` ganha o histórico de uso de cada categoria (quantos
-- lançamentos em toda a base, último uso) — é o que separa "sem movimento no
-- período" de "nunca usada" na tela — e o histórico do cadastro.
-- ===========================================================================

-- ───────────────────────── 1. Trilha ─────────────────────────

create table if not exists public.omie_categoria_cadastro_log (
  id uuid primary key default gen_random_uuid(),
  acao text not null check (acao in ('criar', 'renomear', 'reaproveitar', 'desativar', 'reativar')),
  codigo text not null,
  superior text,
  descricao_de text,
  descricao_para text,
  rubrica_dre text,
  rubrica_dfc text,
  referencias jsonb,
  resposta_omie jsonb,
  motivo text,
  alterado_por uuid references auth.users(id) on delete set null,
  alterado_por_email text,
  criado_em timestamptz not null default now()
);

create index if not exists omie_categoria_cadastro_log_codigo_idx
  on public.omie_categoria_cadastro_log (codigo, criado_em desc);

alter table public.omie_categoria_cadastro_log enable row level security;

drop policy if exists "le quem ve demonstracoes" on public.omie_categoria_cadastro_log;
create policy "le quem ve demonstracoes" on public.omie_categoria_cadastro_log
  for select to authenticated using (public.pode_ler('demonstracoes'));
-- Sem policy de escrita: só a Edge Function (service role) grava.

revoke all on public.omie_categoria_cadastro_log from anon;

comment on table public.omie_categoria_cadastro_log is
  'Trilha do cadastro de categorias feito pelo Hub (Governança › Plano de contas → omie-plano-contas).';

-- ───────────────────────── 2. Espelho no cache ─────────────────────────

/* Mescla `p_categoria` no elemento de mesmo `codigo` (campos ausentes ficam como
   estavam) ou acrescenta no fim. Devolve o total de categorias no cache. */
create or replace function public.omie_cache_categoria_aplicar(p_categoria jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cod text := nullif(btrim(p_categoria->>'codigo'), '');
  v_n   integer;
begin
  if v_cod is null then
    raise exception 'Categoria sem código.';
  end if;

  update omie_cache c
     set dados = case
           when exists (select 1 from jsonb_array_elements(c.dados) e where e->>'codigo' = v_cod)
             then (select jsonb_agg(case when x.e->>'codigo' = v_cod then x.e || p_categoria else x.e end order by x.ord)
                     from jsonb_array_elements(c.dados) with ordinality x(e, ord))
           else coalesce(c.dados, '[]'::jsonb) || jsonb_build_array(p_categoria)
         end
   where c.chave = 'categorias'
  returning jsonb_array_length(c.dados) into v_n;

  if v_n is null then
    raise exception 'O cache de categorias do Omie ainda não existe — rode a sincronização do Omie.';
  end if;

  update omie_cache set registros = v_n where chave = 'categorias';
  return v_n;
end;
$function$;

revoke all on function public.omie_cache_categoria_aplicar(jsonb) from public;
revoke all on function public.omie_cache_categoria_aplicar(jsonb) from anon;
revoke all on function public.omie_cache_categoria_aplicar(jsonb) from authenticated;
grant execute on function public.omie_cache_categoria_aplicar(jsonb) to service_role;

-- ───────────────────────── 3. Levar o nome novo junto ─────────────────────────

create or replace function public.plano_contas_renomear_referencias(p_de text, p_para text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  k_de text := lower(btrim(regexp_replace(unaccent(coalesce(p_de, '')), '\s+', ' ', 'g')));
  v_dre int := 0; v_orc int := 0; v_folha int := 0; v_cartao int := 0; v_regra int := 0;
begin
  if k_de = '' or coalesce(btrim(p_para), '') = '' then
    raise exception 'Informe o nome antigo e o novo.';
  end if;

  -- DE-PARA: a linha que já existir com o nome novo no mesmo demonstrativo vence
  -- (a unicidade é por codigo_categoria + demonstrativo).
  update omie_dre_mapa m
     set codigo_categoria = p_para, descricao_categoria = p_para, updated_at = now()
   where lower(btrim(regexp_replace(unaccent(m.codigo_categoria), '\s+', ' ', 'g'))) = k_de
     and not exists (select 1 from omie_dre_mapa o
                      where o.demonstrativo = m.demonstrativo and o.codigo_categoria = p_para);
  get diagnostics v_dre = row_count;

  update orcamento_omie_map m
     set descricao_categoria = p_para, atualizado_em = now()
   where lower(btrim(regexp_replace(unaccent(m.descricao_categoria), '\s+', ' ', 'g'))) = k_de
     and not exists (select 1 from orcamento_omie_map o where o.descricao_categoria = p_para);
  get diagnostics v_orc = row_count;

  update folha_depara
     set categoria_descricao = p_para, atualizado_em = now()
   where lower(btrim(regexp_replace(unaccent(coalesce(categoria_descricao, '')), '\s+', ' ', 'g'))) = k_de;
  get diagnostics v_folha = row_count;

  update cartao_omie_map
     set descricao_categoria = p_para, atualizado_em = now()
   where lower(btrim(regexp_replace(unaccent(coalesce(descricao_categoria, '')), '\s+', ' ', 'g'))) = k_de;
  get diagnostics v_cartao = row_count;

  update omie_categoria_regra
     set descricao = p_para, atualizado_em = now()
   where lower(btrim(regexp_replace(unaccent(coalesce(descricao, '')), '\s+', ' ', 'g'))) = k_de;
  get diagnostics v_regra = row_count;

  return jsonb_build_object('dre_mapa', v_dre, 'orcamento', v_orc, 'folha', v_folha, 'cartao', v_cartao, 'regra_nota', v_regra);
end;
$function$;

revoke all on function public.plano_contas_renomear_referencias(text, text) from public;
revoke all on function public.plano_contas_renomear_referencias(text, text) from anon;
revoke all on function public.plano_contas_renomear_referencias(text, text) from authenticated;
grant execute on function public.plano_contas_renomear_referencias(text, text) to service_role;

-- ───────────────────────── 4. O resumo sabe do uso e do cadastro ─────────────────────────

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
  -- Uso em TODA a base do cache, sem janela: "nunca usada" tem de ser nunca.
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
    -- [codigo, 'YYYY-MM', valor com sinal, lançamentos, contrapartes distintas]
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

-- ───────────────────────── Conferência ─────────────────────────
-- Tudo abaixo roda dentro de sub-blocos que se desfazem: nada fica gravado.

do $$
declare
  v_antes int;
  v_depois int;
  v_ref jsonb;
  v_cat jsonb;
  v_resumo jsonb;
begin
  -- a) aplicar acrescenta, e aplicar de novo mescla sem duplicar
  begin
    select registros into v_antes from omie_cache where chave = 'categorias';
    perform public.omie_cache_categoria_aplicar('{"codigo":"9.99.99","descricao":"Teste da migration","totalizadora":"N"}');
    v_depois := public.omie_cache_categoria_aplicar('{"codigo":"9.99.99","conta_inativa":"S"}');
    select e into v_cat from omie_cache, jsonb_array_elements(dados) e where chave = 'categorias' and e->>'codigo' = '9.99.99';
    if v_depois <> v_antes + 1 then raise exception 'aplicar duplicou ou não acrescentou: % → %', v_antes, v_depois; end if;
    if v_cat->>'descricao' <> 'Teste da migration' or v_cat->>'conta_inativa' <> 'S' then
      raise exception 'mesclar perdeu campo: %', v_cat;
    end if;
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;

  -- b) renomear leva o DE-PARA junto (casando sem acento e sem caixa)
  begin
    v_ref := public.plano_contas_renomear_referencias('3.1.2.19 OUTROS - Administrativo', '3.1.2.19 Outros Administrativos (teste)');
    if (v_ref->>'dre_mapa')::int = 0 then
      raise exception 'renomear não achou o DE-PARA de 3.1.2.19: %', v_ref;
    end if;
    raise notice 'renomear 3.1.2.19 moveria: %', v_ref;
    raise exception 'desfazer';
  exception when raise_exception then
    if sqlerrm <> 'desfazer' then raise; end if;
  end;

  -- c) o resumo traz uso e cadastro
  v_resumo := public.plano_contas_resumo('competencia');
  if not (v_resumo ? 'cadastro') then raise exception 'resumo sem cadastro'; end if;
  select c into v_cat from jsonb_array_elements(v_resumo->'categorias') c where c->>'codigo' = '1.01.03';
  if coalesce((v_cat->>'usos')::int, 0) = 0 then raise exception 'resumo sem uso em 1.01.03: %', v_cat; end if;
  raise notice 'categorias nunca usadas: %',
    (select count(*) from jsonb_array_elements(v_resumo->'categorias') c
      where not (c->>'totalizadora')::boolean and (c->>'usos')::int = 0);
end $$;
