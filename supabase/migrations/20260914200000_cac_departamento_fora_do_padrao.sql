-- ===========================================================================
-- PAINEL CAC: DEPARTAMENTO FORA DO PADRÃO.
--
-- Pedido de 14/09/2026: "assim como na DRE o próprio Hub indica pessoas que podem
-- estar com a categoria errada, quero algo parecido no painel CAC: colaboradores
-- que podem estar com o departamento errado em seus lançamentos".
--
-- ONDE MORA O DEPARTAMENTO DO LANÇAMENTO. O título do Omie não tem campo de
-- departamento (conferido nas 40 chaves de `detalhes`): ele está no NOME da
-- categoria — "3.2.7.2. Pessoal - Suporte", "3.1.1.5. Premiação - Comercial",
-- "3.2.7.5. Escala - Onboarding". A "família" é esse sufixo, e é a mesma regra de
-- `categoria_e_folha` (Pessoal | Premiação | Escala).
--
-- A RÉGUA É O CADASTRO, NÃO O HISTÓRICO. O alerta da DRE compara o fornecedor com
-- ele mesmo nos 6 meses anteriores. Aqui isso erra nos dois sentidos, medido:
--   • o erro que se repete vira "padrão": Gabriel, Igor, Leonardo e Nicolas são de
--     Onboarding e foram pagos em Pessoal/Escala - Suporte de março a julho — 46
--     lançamentos, R$ 52 mil. Pelo histórico estariam certos;
--   • quem muda de time vira alarme todo mês: o Tomás saiu de Onboarding para
--     Suporte em junho, que é o departamento do cadastro dele.
-- Então: o lançamento é suspeito quando a família dele não é a do departamento da
-- pessoa (`cac_departamento_familia`). O histórico só entra na severidade.
--
-- SEVERIDADE, na ordem em que interessa a quem está no painel:
--   alta   o dinheiro conta noutra linha do CAC (ou entra/sai dele). É o caso de
--          3.2.7.2 Pessoal - Suporte, que a linha Suporte conta INTEIRA: R$ 5.000
--          do João Lucas Wells (Produto) em ago/26 estão no CAC de Suporte;
--   media  a pessoa vinha sendo paga certo (>= 3 lançamentos nos 6 meses, >= 70%
--          na família esperada) e este destoa — o erro de digitação clássico;
--   baixa  vem sendo pago assim. O CAC não muda (a linha conta a pessoa pelo
--          cadastro), mas a DRE separa as equipes pela categoria e sai torta.
--
-- O QUE ENTRA: pessoa do cadastro cujo departamento tem família definida, em
-- lançamento que toca o CAC — ou a pessoa é de uma linha do painel, ou o
-- lançamento é contado por uma. RPA pago em Administrativo não é assunto daqui.
--
-- MÊS TRAVADO NÃO SOME. Na DRE o alerta de mês travado é ruído, porque o valor vem
-- congelado do tracker. O CAC recalcula todo mês a partir do Omie, então o erro de
-- março ainda está no número de março; a linha só leva a marca do cadeado.
--
-- DECISÃO SILENCIA, NÃO APAGA (a mesma lição de `omie_reclassificacoes_regras`):
-- ignorar grava uma linha em `cac_departamento_decisoes`, o caso continua sendo
-- devolvido com `decisao_id` e a tela o mostra na aba de ignorados, com o botão de
-- reabrir. Três alcances: o lançamento, a pessoa naquela família, ou o
-- departamento inteiro naquela família.
-- ===========================================================================

-- ─────────────────────── 1. De qual família cada departamento é pago ───────────────────────

create table if not exists public.cac_departamento_familia (
  departamento  text primary key,
  familias      text[] not null,
  observacao    text,
  atualizado_em timestamptz not null default now()
);

comment on table public.cac_departamento_familia is
  'Departamento de cac_pessoas → as famílias de categoria (o sufixo de "Pessoal - X", "Premiação - X", "Escala - X") em que ele é pago. Régua de cac_departamento_suspeitos. Departamento sem linha aqui não é conferido.';

alter table public.cac_departamento_familia enable row level security;
drop policy if exists "cac_departamento_familia le" on public.cac_departamento_familia;
create policy "cac_departamento_familia le" on public.cac_departamento_familia
  for select to authenticated using (true);
drop policy if exists "cac_departamento_familia escreve" on public.cac_departamento_familia;
create policy "cac_departamento_familia escreve" on public.cac_departamento_familia
  for all to authenticated
  using (public.pode_ver_remuneracao()) with check (public.pode_ver_remuneracao());

revoke all on public.cac_departamento_familia from anon;
grant select, insert, update, delete on public.cac_departamento_familia to authenticated;
grant all on public.cac_departamento_familia to service_role;

/* Tirado dos dados de set/25 a set/26 (departamento do cadastro × família dos
   lançamentos). `do nothing`: rodar de novo não desfaz um ajuste feito depois. */
insert into public.cac_departamento_familia (departamento, familias, observacao) values
  ('Branding e Conteúdo', '{Marketing}',               null),
  ('Performance',         '{Marketing}',               null),
  ('Comunidade',          '{Marketing}',               null),
  ('Eventos',             '{Marketing,"Novos Canais"}',
   'Pago em Novos Canais até mai/26 e em Marketing desde jun/26 (Guilherme e Thais). As duas valem até alguém decidir qual é a certa.'),
  ('Canais Indiretos',    '{"Novos Canais"}',          null),
  ('Field Sales',         '{Comercial}',               null),
  ('Inside Sales',        '{Comercial}',               null),
  ('Franquia',            '{Comercial}',               null),
  ('Franquias',           '{Comercial}',               null),
  ('MGM',                 '{Sucesso}',                 'A Nathalia Marques é paga em Sucesso (7 de 7 lançamentos).'),
  ('Liderança OPS',       '{Onboarding,Sucesso,Suporte}', 'A liderança responde pelas três equipes de operação.'),
  ('Onboarding e Setup',  '{Onboarding}',              null),
  ('Sucesso',             '{Sucesso}',                 null),
  ('Suporte',             '{Suporte}',                 null),
  ('Produto',             '{Tecnologia}',              null),
  ('Tecnologia',          '{Tecnologia}',              null),
  ('RPA',                 '{Automações,Administrativo}', null),
  ('Administrativo',      '{Administrativo}',          null),
  ('Financeiro',          '{Administrativo}',          null),
  ('RH/DP',               '{Administrativo}',          null)
on conflict (departamento) do nothing;

-- ─────────────────────── 2. O que alguém já deu por normal ───────────────────────

create table if not exists public.cac_departamento_decisoes (
  id            uuid primary key default gen_random_uuid(),
  escopo        text not null check (escopo in ('lancamento', 'pessoa', 'departamento')),
  familia       text not null,
  cnpj          text,
  departamento  text,
  cod_titulo    bigint,
  motivo        text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  constraint cac_departamento_decisoes_alcance check (
       (escopo = 'lancamento'   and cnpj is not null and cod_titulo is not null and departamento is null)
    or (escopo = 'pessoa'       and cnpj is not null and cod_titulo is null     and departamento is null)
    or (escopo = 'departamento' and departamento is not null and cnpj is null   and cod_titulo is null)
  )
);

create unique index if not exists cac_departamento_decisoes_uniq
  on public.cac_departamento_decisoes (escopo, familia, coalesce(cnpj, ''), coalesce(departamento, ''), coalesce(cod_titulo, 0));

comment on table public.cac_departamento_decisoes is
  'Silêncio sobre um caso de cac_departamento_suspeitos. Não apaga: o caso continua voltando com decisao_id, e a tela o mostra como ignorado. Escrita só por cac_departamento_ignorar / cac_departamento_reabrir.';

/* Tem CNPJ de gente e aponta quem recebe fora do departamento: é folha. */
alter table public.cac_departamento_decisoes enable row level security;
drop policy if exists "cac_departamento_decisoes é folha" on public.cac_departamento_decisoes;
create policy "cac_departamento_decisoes é folha" on public.cac_departamento_decisoes
  for select to authenticated using (public.pode_ver_remuneracao());

revoke all on public.cac_departamento_decisoes from anon;
grant select on public.cac_departamento_decisoes to authenticated;
grant all on public.cac_departamento_decisoes to service_role;

-- ─────────────────────── 3. A detecção ───────────────────────

/* Sem trava, para o bloco de conferência abaixo (que roda sem sessão) e para quem
   tiver service role. `authenticated` chega só pela casca. */
create or replace function public.cac_departamento_suspeitos_completo(p_ano integer)
returns table (
  cod_titulo bigint, mes integer, cnpj text, pessoa text, departamento text,
  departamento_rh text, familias_rh text[],
  categoria text, categoria_descricao text, familia text, familias_esperadas text[], valor numeric,
  linha_id uuid, linha_rotulo text, linha_propria_id uuid, linha_propria_rotulo text,
  hist_lancamentos integer, hist_esperados integer, severidade text, mes_travado boolean,
  decisao_id uuid, decisao_escopo text, decisao_motivo text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cat as (
    select e->>'codigo' as codigo, e->>'descricao' as descricao
      from public.omie_cache, lateral jsonb_array_elements(dados) e
     where chave = 'categorias'
  ),
  -- O ano pedido e os 6 meses antes dele: janeiro também tem histórico.
  base as materialized (
    select pg.cod_titulo, pg.cnpj, pg.categoria, c.descricao as categoria_descricao,
           btrim(substring(c.descricao from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$')) as familia,
           pg.valor,
           date_trunc('month', pg.competencia)::date as mes0,
           p.nome as pessoa, p.departamento, f.familias
      from public.cac_pagamentos pg
      join public.cac_pessoas p on p.cnpj = pg.cnpj
      join public.cac_departamento_familia f on f.departamento = p.departamento
      join cat c on c.codigo = pg.categoria
     where pg.competencia >= (make_date(p_ano, 1, 1) - interval '6 months')::date
       and pg.competencia <  make_date(p_ano + 1, 1, 1)
  ),
  susp as materialized (
    select b.* from base b
     where b.familia is not null
       and b.familia <> all(b.familias)
       and b.mes0 >= make_date(p_ano, 1, 1)
  ),
  -- O setor do RH, pela mesma casação de `cac_pessoas_rh` (CNPJ inteiro ou raiz).
  rh as materialized (
    select distinct on (s.cnpj) s.cnpj, coalesce(m.departamento, r.setor) as departamento_rh
      from (select distinct x.cnpj from susp x) s
      join public.rh_colaboradores r
        on regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g') = s.cnpj
        or (length(regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g')) = 8
            and length(s.cnpj) = 14
            and left(s.cnpj, 8) = regexp_replace(coalesce(r.cnpj, ''), '[^0-9]', '', 'g'))
      left join public.cac_setor_rh m on m.setor = r.setor
     where r.nome !~* 'teste'
     order by s.cnpj, nullif(btrim(coalesce(r.datadesl, '')), '') nulls first
  ),
  calc as (
    select s.*,
           (select count(*) from base h
             where h.cnpj = s.cnpj and h.familia is not null
               and h.mes0 >= (s.mes0 - interval '6 months')::date and h.mes0 < s.mes0)::int as hist_lancamentos,
           (select count(*) from base h
             where h.cnpj = s.cnpj and h.familia is not null and h.familia = any(h.familias)
               and h.mes0 >= (s.mes0 - interval '6 months')::date and h.mes0 < s.mes0)::int as hist_esperados,
           -- Onde o dinheiro está contando hoje…
           (select l.id from public.cac_linhas l
             where l.ativo and not l.manual and public.cac_linha_casa(l, s.cnpj, s.categoria)
             order by l.ordem limit 1) as linha_id,
           -- …e onde a pessoa mora pelo cadastro.
           (select l.id from public.cac_linhas l
             where l.ativo and not l.manual and s.departamento = any(l.departamentos)
             order by l.ordem limit 1) as linha_propria_id
      from susp s
  )
  select c.cod_titulo,
         extract(month from c.mes0)::int,
         c.cnpj, c.pessoa, c.departamento,
         rh.departamento_rh, fr.familias,
         c.categoria, c.categoria_descricao, c.familia, c.familias, c.valor,
         c.linha_id, l1.rotulo, c.linha_propria_id, l2.rotulo,
         c.hist_lancamentos, c.hist_esperados,
         case
           when c.linha_id is distinct from c.linha_propria_id then 'alta'
           when c.hist_lancamentos >= 3 and c.hist_esperados::numeric / c.hist_lancamentos >= 0.7 then 'media'
           else 'baixa'
         end,
         exists (select 1 from public.demonstracoes_mes_trancado t where t.col_key = to_char(c.mes0, 'Mon-YY')),
         d.id, d.escopo, d.motivo
    from calc c
    left join rh on rh.cnpj = c.cnpj
    left join public.cac_departamento_familia fr on fr.departamento = rh.departamento_rh
    left join public.cac_linhas l1 on l1.id = c.linha_id
    left join public.cac_linhas l2 on l2.id = c.linha_propria_id
    -- A decisão mais estreita que alcança o caso é a que a tela mostra.
    left join lateral (
      select x.id, x.escopo, x.motivo
        from public.cac_departamento_decisoes x
       where x.familia = c.familia
         and (   (x.escopo = 'lancamento'   and x.cnpj = c.cnpj and x.cod_titulo = c.cod_titulo)
              or (x.escopo = 'pessoa'       and x.cnpj = c.cnpj)
              or (x.escopo = 'departamento' and x.departamento = c.departamento))
       order by case x.escopo when 'lancamento' then 0 when 'pessoa' then 1 else 2 end
       limit 1
    ) d on true
   where c.linha_id is not null or c.linha_propria_id is not null
   order by c.mes0, c.pessoa
$function$;

revoke all on function public.cac_departamento_suspeitos_completo(integer) from public;
revoke all on function public.cac_departamento_suspeitos_completo(integer) from anon;
revoke all on function public.cac_departamento_suspeitos_completo(integer) from authenticated;
grant execute on function public.cac_departamento_suspeitos_completo(integer) to service_role;

/* A casca. Nome e valor de folha, pessoa a pessoa: sem a folha inteira não abre,
   como `cac_celula`. Colunas NOMEADAS, não `s.*` — ver armadilhas-postgres. */
create or replace function public.cac_departamento_suspeitos(p_ano integer)
returns table (
  cod_titulo bigint, mes integer, cnpj text, pessoa text, departamento text,
  departamento_rh text, familias_rh text[],
  categoria text, categoria_descricao text, familia text, familias_esperadas text[], valor numeric,
  linha_id uuid, linha_rotulo text, linha_propria_id uuid, linha_propria_rotulo text,
  hist_lancamentos integer, hist_esperados integer, severidade text, mes_travado boolean,
  decisao_id uuid, decisao_escopo text, decisao_motivo text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.pode_ver_remuneracao() then
    return;
  end if;
  return query
    select s.cod_titulo, s.mes, s.cnpj, s.pessoa, s.departamento,
           s.departamento_rh, s.familias_rh,
           s.categoria, s.categoria_descricao, s.familia, s.familias_esperadas, s.valor,
           s.linha_id, s.linha_rotulo, s.linha_propria_id, s.linha_propria_rotulo,
           s.hist_lancamentos, s.hist_esperados, s.severidade, s.mes_travado,
           s.decisao_id, s.decisao_escopo, s.decisao_motivo
      from public.cac_departamento_suspeitos_completo(p_ano) s;
end;
$function$;

revoke all on function public.cac_departamento_suspeitos(integer) from public;
revoke all on function public.cac_departamento_suspeitos(integer) from anon;
grant execute on function public.cac_departamento_suspeitos(integer) to authenticated, service_role;

-- ─────────────────────── 4. Ignorar e reabrir ───────────────────────

create or replace function public.cac_departamento_ignorar(
  p_escopo       text,
  p_familia      text,
  p_cnpj         text   default null,
  p_departamento text   default null,
  p_cod_titulo   bigint default null,
  p_motivo       text   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.pode_ver_remuneracao() then
    raise exception 'Decidir sobre lançamento de folha exige acesso à folha.';
  end if;

  -- Cada alcance leva só o que é dele; o check da tabela recusa o que faltar.
  insert into public.cac_departamento_decisoes (escopo, familia, cnpj, departamento, cod_titulo, motivo)
  values (
    p_escopo,
    p_familia,
    case when p_escopo in ('lancamento', 'pessoa') then p_cnpj end,
    case when p_escopo = 'departamento' then p_departamento end,
    case when p_escopo = 'lancamento' then p_cod_titulo end,
    nullif(btrim(coalesce(p_motivo, '')), '')
  )
  on conflict (escopo, familia, coalesce(cnpj, ''), coalesce(departamento, ''), coalesce(cod_titulo, 0))
  do update set motivo = coalesce(excluded.motivo, public.cac_departamento_decisoes.motivo)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.cac_departamento_ignorar(text, text, text, text, bigint, text) from public;
revoke all on function public.cac_departamento_ignorar(text, text, text, text, bigint, text) from anon;
grant execute on function public.cac_departamento_ignorar(text, text, text, text, bigint, text) to authenticated, service_role;

/* Apaga a DECISÃO, não o caso: com ela some o silêncio, e tudo o que ela
   alcançava (a pessoa inteira, o departamento inteiro) volta a aparecer. */
create or replace function public.cac_departamento_reabrir(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  if not public.pode_ver_remuneracao() then
    raise exception 'Decidir sobre lançamento de folha exige acesso à folha.';
  end if;
  delete from public.cac_departamento_decisoes where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.cac_departamento_reabrir(uuid) from public;
revoke all on function public.cac_departamento_reabrir(uuid) from anon;
grant execute on function public.cac_departamento_reabrir(uuid) to authenticated, service_role;

-- ─────────────────────── 5. Conferência ───────────────────────

do $$
declare
  v     text;
  n     integer;
  v_ini timestamptz;
  v_ms  numeric;
begin
  -- A família sai do sufixo, e só de categoria de pessoa.
  if btrim(substring('3.2.7.5. Escala - Onboarding' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$')) <> 'Onboarding'
  or btrim(substring('3.1.1.10 Pessoal - Novos Canais' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$')) <> 'Novos Canais'
  or btrim(substring('3.1.1.5. Premiação - Comercial' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$')) <> 'Comercial' then
    raise exception 'o regex da família não pegou o sufixo';
  end if;
  if substring('3.2.22 Diretores - Administrativo' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$') is not null
  or substring('3.1.3.4 Transportes e Viagens - Marketing' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$') is not null then
    raise exception 'o regex da família pegou categoria que não é de pessoa';
  end if;

  -- Departamento de linha do painel sem família = gente que nunca é conferida, calada.
  select string_agg(distinct d, ', ') into v
    from public.cac_linhas l, unnest(l.departamentos) d
   where l.ativo and not l.manual
     and not exists (select 1 from public.cac_departamento_familia f where f.departamento = d);
  if v is not null then
    raise exception 'departamento do painel sem família em cac_departamento_familia: %', v;
  end if;

  -- A família cadastrada tem de existir no plano de contas, senão a régua não casa nunca.
  select string_agg(distinct x, ', ') into v
    from public.cac_departamento_familia f, unnest(f.familias) x
   where not exists (
     select 1 from public.omie_cache, lateral jsonb_array_elements(dados) e
      where chave = 'categorias'
        and btrim(substring(e->>'descricao' from '(?:Pessoal|Premia[çc][ãa]o|Escala)\s*-\s*(.+)$')) = x);
  if v is not null then
    raise exception 'família que nenhuma categoria do Omie tem: %', v;
  end if;

  -- Cabe no tempo da API. Duas chamadas: a primeira paga o cache frio.
  perform count(*) from public.cac_departamento_suspeitos_completo(2026);
  v_ini := clock_timestamp();
  select count(*) into n from public.cac_departamento_suspeitos_completo(2026);
  v_ms := extract(epoch from clock_timestamp() - v_ini) * 1000;
  raise notice 'cac_departamento_suspeitos(2026): % lançamento(s) em % ms', n, round(v_ms);
  if v_ms > 5000 then
    raise exception 'cac_departamento_suspeitos leva % ms', round(v_ms);
  end if;

  -- O caso que motivou a severidade alta: Produto pago em 3.2.7.2 Pessoal - Suporte.
  if not exists (
    select 1 from public.cac_departamento_suspeitos_completo(2026)
     where pessoa ilike 'João Lucas Wells%' and mes = 8 and familia = 'Suporte'
       and severidade = 'alta' and linha_rotulo = 'Suporte' and linha_propria_id is null
  ) then
    raise exception 'João Lucas Wells ago/26 em Suporte não saiu como alta';
  end if;

  -- E o que não pode acusar: o Tomás em Suporte, que é o departamento do cadastro.
  if exists (
    select 1 from public.cac_departamento_suspeitos_completo(2026)
     where pessoa ilike 'Tomás Guillermo%' and familia = 'Suporte'
  ) then
    raise exception 'acusou lançamento na família do próprio departamento';
  end if;

  -- Sem sessão, `pode_ver_remuneracao()` é falso: a casca não pode devolver nada.
  if exists (select 1 from public.cac_departamento_suspeitos(2026)) then
    raise exception 'a trava da folha não segurou a casca';
  end if;
end $$;
