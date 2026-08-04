-- Alerta de reclassificação: o mesmo fornecedor caindo numa rubrica diferente
-- da que ele vinha caindo.
--
-- O QUE ISTO RESOLVE
-- Toda a DRE/DFC vem da categoria que alguém escolheu no Omie no momento do
-- lançamento. Errar a categoria não quebra nada — o número simplesmente aparece
-- na linha errada e o resultado do mês sai torto sem nenhum sinal de erro. Como
-- agora existe o drill-down por lançamento (`demonstracoes_lancamentos`), dá
-- para virar o jogo: se um fornecedor sempre caiu em "Equipe Onboarding" e
-- neste mês caiu em "Equipe Operacional", isso é suspeito e merece um aviso.
--
-- A REGRA (calibrada contra os dados reais de Set-25 a Jul-26)
--   1. Agrupa os lançamentos por fornecedor (nome normalizado do cadastro do
--      Omie; CNPJ/CPF quando não há nome).
--   2. Para cada fornecedor × mês, olha os 6 meses ANTERIORES e elege a rubrica
--      dominante — comparar só com o mês passado alertaria ao contrário quando
--      é justamente o mês passado que estava errado.
--   3. Só considera que existe padrão quando o histórico tem >= 3 lançamentos,
--      a rubrica dominante responde por >= 70% deles e o fornecedor não passeou
--      por mais de 3 rubricas na janela.
--   4. Descarta contraparte-balde pelo espalhamento DO PRÓPRIO MÊS: quem usa
--      mais de 3 rubricas num mês só não é fornecedor, é rótulo guarda-chuva.
--      Sem este corte, "Lancamento Fatura Cartao" — o pseudo-fornecedor onde
--      cada despesa do cartão entra com a sua categoria — sozinho gerava 511
--      dos 618 alertas (a fatura de Mai-26 abriu em 15 rubricas de uma vez).
--   5. Alerta quando a rubrica do lançamento difere da dominante.
--
-- O VALOR ENTRA COMO CONFIANÇA, NÃO COMO FILTRO
-- Valor colado na mediana histórica é o sinal mais forte que existe de que é a
-- MESMA despesa recorrente, só que mal classificada (o caso OPSCOPE: R$ 12.000
-- idênticos, três meses em "Equipe Onboarding" e no quarto em "Equipe
-- Operacional"). Valor muito distante costuma ser outra natureza de gasto do
-- mesmo fornecedor — continua listado, mas no fim da fila. Filtrar por valor
-- igual deixaria passar reajuste de contrato, que é justamente quando o
-- lançamento é refeito e a classificação se perde.

/* ============================================================
 *  Tabelas
 * ============================================================ */

-- Os alertas em si. Recalculados por inteiro a cada passada; o que sobrevive ao
-- recálculo é a decisão humana (status/ignorado_*) e o `detectado_em`, para o
-- painel saber o que é novidade.
create table if not exists public.omie_reclassificacoes (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null check (tipo in ('dre','dfc')),
  mes               text not null,                    -- 'Jul-26', a chave de coluna da tela
  rubrica           text not null,                    -- onde caiu agora (a célula que recebe o badge)
  rubrica_padrao    text not null,                    -- onde vinha caindo
  fornecedor_chave  text not null,
  fornecedor        text,
  cnpj_cpf          text,
  cod_titulo        text not null,                    -- nCodTitulo: único por lançamento no Omie
  data              date,
  valor             numeric,
  valor_padrao      numeric,                          -- mediana do histórico na rubrica padrão
  severidade        text not null check (severidade in ('alta','media','baixa')),
  hist_lancamentos  integer,
  hist_no_padrao    integer,
  hist_rubricas     integer,
  status            text not null default 'aberto' check (status in ('aberto','ignorado')),
  ignorado_em       timestamptz,
  ignorado_por      uuid,
  ignorado_motivo   text,
  detectado_em      timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  -- Um lançamento (nCodTitulo) rende no máximo um alerta por demonstrativo. A
  -- mesma categoria pode virar rubrica diferente na DRE e na DFC, daí o `tipo`.
  unique (tipo, cod_titulo)
);

create index if not exists omie_reclassificacoes_celula_idx
  on public.omie_reclassificacoes (tipo, rubrica, mes) where status = 'aberto';

-- Silêncio permanente por PAR de rubricas: "para este fornecedor, cair numa ou
-- noutra é normal". Fica fora da tabela de alertas de propósito — precisa valer
-- para os lançamentos que ainda nem chegaram, e a tabela de alertas é apagada e
-- reescrita a cada detecção.
--
-- A regra SILENCIA, não apaga: o lançamento continua entrando como 'ignorado' e
-- aparecendo no drill-down com o botão de reabrir. Se ele fosse eliminado na
-- detecção, um clique errado em "sempre pode cair nas duas" viraria uma regra
-- invisível, sem nenhum lugar na tela para desfazer.
create table if not exists public.omie_reclassificacoes_regras (
  id                uuid primary key default gen_random_uuid(),
  fornecedor_chave  text not null,
  fornecedor        text,
  rubrica_a         text not null,                    -- par normalizado com least()/greatest()
  rubrica_b         text not null,
  motivo            text,
  criado_por        uuid default auth.uid(),
  criado_em         timestamptz not null default now(),
  unique (fornecedor_chave, rubrica_a, rubrica_b)
);

alter table public.omie_reclassificacoes enable row level security;
alter table public.omie_reclassificacoes_regras enable row level security;

create policy "auth read omie_reclassificacoes"
  on public.omie_reclassificacoes for select to authenticated using (true);
create policy "auth read omie_reclassificacoes_regras"
  on public.omie_reclassificacoes_regras for select to authenticated using (true);
-- Escrita só pelas funções abaixo (security definer): o que muda é decisão de
-- auditoria, não linha solta editável pelo cliente.

/* ============================================================
 *  Detecção
 * ============================================================ */

create or replace function public.omie_reclassificacoes_detectar()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abertos integer;
begin
  drop table if exists _rec;

  create temporary table _rec on commit drop as
  with
  cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  -- Mesma limpeza de nome do drill-down (migration 20260803210000): MEI e
  -- autônomo vêm da Receita com o documento embutido na razão social.
  cli as (
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
    order by c->>'codigo'
  ),
  mov as (
    select m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
  ),
  tipos as (select unnest(array['dre','dfc']) as tipo),
  base as (
    select
      t.tipo,
      det,
      -- DRE por competência, DFC por caixa: a mesma cadeia de fallback do omie-sync.
      case when t.tipo = 'dre'
        then to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'),''),'DD/MM/YYYY')
        else to_date(nullif(coalesce(det->>'dDtPagamento', det->>'dDtCredito', det->>'dDtConcilia'),''),'DD/MM/YYYY')
      end as dt,
      det->>'cCodCateg' as codigo,
      (det->>'nValorTitulo')::numeric as bruto
    from mov, tipos t
  ),
  lanc as (
    select distinct on (b.tipo, b.det->>'nCodTitulo')
      b.tipo,
      b.dt,
      b.det->>'nCodTitulo' as cod_titulo,
      coalesce(nullif(btrim(cli.nome), ''), f.nome) as fornecedor,
      nullif(b.det->>'cCPFCNPJCliente','') as cnpj_cpf,
      lower(btrim(regexp_replace(unaccent(
        coalesce(nullif(btrim(cli.nome),''), f.nome, nullif(b.det->>'cCPFCNPJCliente',''), 'cli:'||coalesce(b.det->>'nCodCliente','?'))
      ), '\s+', ' ', 'g'))) as chave,
      dp.rubrica,
      abs(b.bruto) as valor,
      (extract(year from b.dt) * 12 + extract(month from b.dt))::int as mi
    from base b
    left join cat c on c.codigo = b.codigo
    left join cli on cli.codigo = b.det->>'nCodCliente'
    left join lib_fornecedores f
      on regexp_replace(coalesce(f.documento,''), '\D', '', 'g') =
         regexp_replace(coalesce(b.det->>'cCPFCNPJCliente',''), '\D', '', 'g')
     and regexp_replace(coalesce(f.documento,''), '\D', '', 'g') <> ''
    join omie_dre_mapa dp
      on dp.ativo is not false
     and dp.demonstrativo in (b.tipo, 'ambos')
     and lower(btrim(regexp_replace(unaccent(dp.codigo_categoria), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(unaccent(coalesce(c.descricao, b.codigo)), '\s+', ' ', 'g')))
    where b.dt is not null
      -- Sem nValorTitulo é a perna bancária do mesmo título: vale zero no
      -- demonstrativo e não tem classificação própria a auditar.
      and b.bruto is not null
      and b.dt >= (date_trunc('year', current_date) - interval '1 year')::date
      and b.dt <= current_date
    -- Se o DE-PARA mapear a mesma categoria em duas rubricas do mesmo
    -- demonstrativo, fica uma linha só: o alerta não é o lugar de expor esse
    -- outro problema, e duplicaria o aviso na tela.
    order by b.tipo, b.det->>'nCodTitulo', dp.rubrica
  ),
  -- Rubricas do fornecedor nos 6 meses anteriores a cada mês em que ele aparece.
  hist as (
    select l.tipo, l.chave, l.mi, h.rubrica,
           count(*) as n,
           sum(h.valor) as tot,
           (percentile_cont(0.5) within group (order by h.valor))::numeric as mediana
    from (select distinct tipo, chave, mi from lanc) l
    join lanc h
      on h.tipo = l.tipo and h.chave = l.chave
     and h.mi between l.mi - 6 and l.mi - 1
    group by 1,2,3,4
  ),
  dom as (
    select distinct on (tipo, chave, mi)
      tipo, chave, mi,
      rubrica as rubrica_padrao,
      n as n_dom,
      mediana,
      sum(n) over (partition by tipo, chave, mi) as n_hist,
      count(*) over (partition by tipo, chave, mi) as rubricas_hist
    from hist
    order by tipo, chave, mi, n desc, tot desc
  ),
  -- Em quantas rubricas a contraparte se espalhou no mês que está sendo
  -- avaliado. Fornecedor de verdade fica em uma ou duas; rótulo guarda-chuva
  -- (fatura de cartão, repasse de gateway) abre em dezenas.
  espalhamento as (
    select tipo, chave, mi, count(distinct rubrica) as rubricas_mes
    from lanc
    group by 1,2,3
  )
  select
    l.tipo,
    (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from l.dt)::int]
      || '-' || to_char(l.dt,'YY') as mes,
    l.rubrica,
    d.rubrica_padrao,
    l.chave as fornecedor_chave,
    l.fornecedor,
    l.cnpj_cpf,
    l.cod_titulo,
    l.dt as data,
    l.valor,
    d.mediana as valor_padrao,
    case
      when d.mediana > 0 and abs(l.valor - d.mediana) <= 0.10 * d.mediana then 'alta'
      when d.mediana > 0 and abs(l.valor - d.mediana) <= 0.50 * d.mediana then 'media'
      else 'baixa'
    end as severidade,
    d.n_hist::int  as hist_lancamentos,
    d.n_dom::int   as hist_no_padrao,
    d.rubricas_hist::int as hist_rubricas,
    -- Par já aceito para este fornecedor: entra calado, não deixa de entrar.
    case when g.id is not null then 'ignorado' else 'aberto' end as status_inicial,
    g.motivo as regra_motivo
  from lanc l
  join dom d on d.tipo = l.tipo and d.chave = l.chave and d.mi = l.mi
  join espalhamento e on e.tipo = l.tipo and e.chave = l.chave and e.mi = l.mi
  left join omie_reclassificacoes_regras g
    on g.fornecedor_chave = l.chave
   and g.rubrica_a = least(l.rubrica, d.rubrica_padrao)
   and g.rubrica_b = greatest(l.rubrica, d.rubrica_padrao)
  where d.n_hist >= 3                          -- histórico ralo não define padrão
    and d.n_dom::numeric / d.n_hist >= 0.7     -- e padrão frouxo também não
    and d.rubricas_hist <= 3                   -- contraparte-balde não tem padrão nenhum
    and e.rubricas_mes <= 3                    -- nem no mês corrente
    and l.rubrica <> d.rubrica_padrao;

  -- Lançamento corrigido no Omie some da lista — inclusive se estava ignorado,
  -- porque o motivo de ignorar deixou de existir.
  delete from omie_reclassificacoes r
  where not exists (
    select 1 from _rec x where x.tipo = r.tipo and x.cod_titulo = r.cod_titulo
  );

  insert into omie_reclassificacoes as r (
    tipo, mes, rubrica, rubrica_padrao, fornecedor_chave, fornecedor, cnpj_cpf,
    cod_titulo, data, valor, valor_padrao, severidade,
    hist_lancamentos, hist_no_padrao, hist_rubricas,
    status, ignorado_em, ignorado_motivo
  )
  select
    tipo, mes, rubrica, rubrica_padrao, fornecedor_chave, fornecedor, cnpj_cpf,
    cod_titulo, data, valor, valor_padrao, severidade,
    hist_lancamentos, hist_no_padrao, hist_rubricas,
    status_inicial,
    case when status_inicial = 'ignorado' then now() end,
    regra_motivo
  from _rec
  on conflict (tipo, cod_titulo) do update set
    mes = excluded.mes,
    rubrica = excluded.rubrica,
    rubrica_padrao = excluded.rubrica_padrao,
    fornecedor_chave = excluded.fornecedor_chave,
    fornecedor = excluded.fornecedor,
    cnpj_cpf = excluded.cnpj_cpf,
    data = excluded.data,
    valor = excluded.valor,
    valor_padrao = excluded.valor_padrao,
    severidade = excluded.severidade,
    hist_lancamentos = excluded.hist_lancamentos,
    hist_no_padrao = excluded.hist_no_padrao,
    hist_rubricas = excluded.hist_rubricas,
    atualizado_em = now();
    -- status, ignorado_* e detectado_em NÃO são tocados: a decisão de quem
    -- auditou tem que sobreviver ao recálculo, senão o mesmo caso volta a
    -- piscar toda vez que o Omie é sincronizado.

  select count(*) into v_abertos from omie_reclassificacoes where status = 'aberto';
  return v_abertos;
end;
$$;

/* ============================================================
 *  Gatilho: roda sozinho a cada dado novo vindo do Omie
 * ============================================================ */

-- O cache (`omie_cache`, chave 'movimentos') é reescrito por QUALQUER uma das
-- sincronizações quando elas repuxam o Omie. Pendurar aqui é o que faz a
-- comparação ser contínua sem depender de ninguém abrir tela nem de mais um cron.
create or replace function public.omie_cache_reclassificar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.chave = 'movimentos' then
    begin
      perform public.omie_reclassificacoes_detectar();
    exception when others then
      -- Alerta é acessório: se a detecção falhar, o sync do Omie (que é o dado
      -- de verdade) não pode cair junto.
      raise warning 'omie_reclassificacoes_detectar falhou: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists omie_cache_reclassifica on public.omie_cache;
create trigger omie_cache_reclassifica
  after insert or update on public.omie_cache
  for each row execute function public.omie_cache_reclassificar();

/* ============================================================
 *  Leitura pela tela
 * ============================================================ */

-- Uma chamada por página: devolve só as células que têm alerta.
create or replace function public.demonstracoes_reclassificacoes(p_tipo text)
returns table (
  rubrica     text,
  mes         text,
  alertas     bigint,
  severidade  text,
  valor_total numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.rubrica,
    r.mes,
    count(*) as alertas,
    -- A célula herda a maior severidade que tem dentro dela.
    case
      when bool_or(r.severidade = 'alta')  then 'alta'
      when bool_or(r.severidade = 'media') then 'media'
      else 'baixa'
    end as severidade,
    sum(r.valor) as valor_total
  from omie_reclassificacoes r
  where r.tipo = p_tipo and r.status = 'aberto'
  group by r.rubrica, r.mes;
$$;

-- Detalhe de uma célula: casa com a lista do drill-down pelo `cod_titulo`.
create or replace function public.demonstracoes_reclassificacoes_celula(
  p_tipo    text,
  p_rubrica text,
  p_mes     text
)
returns table (
  id               uuid,
  cod_titulo       text,
  fornecedor       text,
  rubrica_padrao   text,
  valor            numeric,
  valor_padrao     numeric,
  severidade       text,
  status           text,
  hist_lancamentos integer,
  hist_no_padrao   integer,
  ignorado_motivo  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, cod_titulo, fornecedor, rubrica_padrao, valor, valor_padrao,
         severidade, status, hist_lancamentos, hist_no_padrao, ignorado_motivo
  from omie_reclassificacoes
  where tipo = p_tipo and rubrica = p_rubrica and mes = p_mes;
$$;

/* ============================================================
 *  Decisão de quem audita
 * ============================================================ */

-- p_escopo = 'lancamento'  → cala só este lançamento.
-- p_escopo = 'fornecedor'  → cala o par de rubricas para este fornecedor, hoje
--                            e no futuro (é o que resolve o fornecedor que
--                            legitimamente cai em duas linhas).
create or replace function public.reclassificacao_ignorar(
  p_id     uuid,
  p_escopo text default 'lancamento',
  p_motivo text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.omie_reclassificacoes%rowtype;
  n integer;
begin
  select * into a from omie_reclassificacoes where id = p_id;
  if not found then
    raise exception 'alerta % não encontrado', p_id;
  end if;

  if p_escopo = 'fornecedor' then
    insert into omie_reclassificacoes_regras (fornecedor_chave, fornecedor, rubrica_a, rubrica_b, motivo)
    values (a.fornecedor_chave, a.fornecedor,
            least(a.rubrica, a.rubrica_padrao), greatest(a.rubrica, a.rubrica_padrao), p_motivo)
    on conflict (fornecedor_chave, rubrica_a, rubrica_b) do update set motivo = coalesce(excluded.motivo, omie_reclassificacoes_regras.motivo);

    update omie_reclassificacoes
       set status = 'ignorado', ignorado_em = now(), ignorado_por = auth.uid(), ignorado_motivo = p_motivo
     where fornecedor_chave = a.fornecedor_chave
       and least(rubrica, rubrica_padrao) = least(a.rubrica, a.rubrica_padrao)
       and greatest(rubrica, rubrica_padrao) = greatest(a.rubrica, a.rubrica_padrao);
  else
    update omie_reclassificacoes
       set status = 'ignorado', ignorado_em = now(), ignorado_por = auth.uid(), ignorado_motivo = p_motivo
     where id = p_id;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.reclassificacao_reabrir(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.omie_reclassificacoes%rowtype;
  v_regra integer;
  n integer;
begin
  select * into a from omie_reclassificacoes where id = p_id;
  if not found then
    raise exception 'alerta % não encontrado', p_id;
  end if;

  -- Reabrir um caso calado no escopo do fornecedor tem que derrubar a regra
  -- junto, senão a próxima detecção o cala de novo.
  delete from omie_reclassificacoes_regras
   where fornecedor_chave = a.fornecedor_chave
     and rubrica_a = least(a.rubrica, a.rubrica_padrao)
     and rubrica_b = greatest(a.rubrica, a.rubrica_padrao);
  get diagnostics v_regra = row_count;

  if v_regra > 0 then
    -- Havia regra: o silêncio era do par inteiro, então some com ele inteiro.
    update omie_reclassificacoes
       set status = 'aberto', ignorado_em = null, ignorado_por = null, ignorado_motivo = null
     where fornecedor_chave = a.fornecedor_chave
       and least(rubrica, rubrica_padrao) = least(a.rubrica, a.rubrica_padrao)
       and greatest(rubrica, rubrica_padrao) = greatest(a.rubrica, a.rubrica_padrao);
  else
    -- Sem regra, foi decisão avulsa: reabrir só ela, para não ressuscitar
    -- outros lançamentos que alguém conferiu um a um.
    update omie_reclassificacoes
       set status = 'aberto', ignorado_em = null, ignorado_por = null, ignorado_motivo = null
     where id = p_id;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.omie_reclassificacoes_detectar() from public;
revoke all on function public.demonstracoes_reclassificacoes(text) from public;
revoke all on function public.demonstracoes_reclassificacoes_celula(text, text, text) from public;
revoke all on function public.reclassificacao_ignorar(uuid, text, text) from public;
revoke all on function public.reclassificacao_reabrir(uuid) from public;

grant execute on function public.omie_reclassificacoes_detectar() to authenticated, service_role;
grant execute on function public.demonstracoes_reclassificacoes(text) to authenticated;
grant execute on function public.demonstracoes_reclassificacoes_celula(text, text, text) to authenticated;
grant execute on function public.reclassificacao_ignorar(uuid, text, text) to authenticated;
grant execute on function public.reclassificacao_reabrir(uuid) to authenticated;
