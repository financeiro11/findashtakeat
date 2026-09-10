-- Esconder deixa de ser a única trava: o banco passa a recusar.
--
-- ---------------------------------------------------------------------------
-- O DIAGNÓSTICO (10/09/2026)
--
-- A matriz de `acesso_perfil` tira a tela da frente da pessoa. Não tira o dado:
-- das 222 tabelas, a policy de ~206 é `true` para qualquer autenticado, e quem
-- chama o PostgREST direto lê tudo.
--
-- Só que o buraco maior NÃO são as tabelas. São as RPCs: o Hub tem 199 funções
-- `security definer`, todas de `postgres` (`rolbypassrls = true`), e só 43
-- checam alguma coisa. Definer FURA A RLS POR CONSTRUÇÃO — é para isso que ela
-- serve. Ou seja: eu poderia trancar `omie_cache` com a policy mais estrita do
-- mundo e `demonstracoes_lancamentos` continuaria devolvendo data, contraparte,
-- CNPJ, categoria e valor de qualquer lançamento para qualquer sessão. O mesmo
-- vale para `cap_notas_titulos` (o contas a pagar inteiro), `cartao_omie_*` e
-- `caixa_notas_lista`.
--
-- Por isso são duas frentes, e esta migration entrega a peça comum das duas.
--
-- ---------------------------------------------------------------------------
-- POR QUE COMEÇA EM MODO AVISO
--
-- Uma tabela é lida por mais telas do que o nome sugere. `demonstracoes_contabeis`
-- é lida por Demonstrações, Apresentações, Dashboard e BP — quatro capacidades
-- (medido por `scripts/mapa-acesso.mjs`, que cruza o `.from(...)` de cada arquivo
-- com o PORTÃO). Fechar por palpite tira a tela de quem tinha acesso legítimo, e
-- o sintoma não é erro: é tela vazia, que ninguém relaciona com a migration de
-- ontem.
--
-- Então cada capacidade tem um interruptor. Em `aviso`, a checagem REGISTRA quem
-- teria sido barrado e deixa passar. Em `bloqueio`, recusa. Vira-se a chave
-- capacidade a capacidade, depois de olhar o registro — que é a diferença entre
-- medir e torcer.
--
-- Nesta migration só o SOCIETÁRIO nasce em `bloqueio`: é uma tabela só
-- (`investimentos_snapshot`), lida por uma tela só, e é o dado mais sensível do
-- Hub. Todo o resto entra em `aviso`.

-- ---------------------------------------------------------------------------
-- 1. Os interruptores
-- ---------------------------------------------------------------------------

create table if not exists public.acesso_modo (
  capacidade text primary key,
  modo       text not null default 'aviso' check (modo in ('aviso', 'bloqueio')),
  mudado_em  timestamptz not null default now()
);

comment on table public.acesso_modo is
  'Por capacidade: `aviso` registra quem seria barrado e deixa passar; `bloqueio` recusa. '
  'Capacidade sem linha aqui é tratada como `aviso` — o padrão nunca é fechar sozinho.';

insert into public.acesso_modo (capacidade, modo) values
  ('societario',    'bloqueio'),   -- captable, flip, exterior: fecha agora
  ('remuneracao',   'bloqueio'),   -- já fechada desde antes, por pode_ver_remuneracao()
  ('assistente',    'bloqueio'),   -- idem, por pode_usar_assistente()
  ('demonstracoes', 'aviso'),
  ('planejamento',  'aviso'),
  ('orcamento',     'aviso'),
  ('tesouraria',    'aviso'),
  ('conciliacao',   'aviso'),
  ('metricas',      'aviso'),
  ('apresentacoes', 'aviso'),
  ('editais',       'aviso'),
  ('time',          'aviso'),
  ('biblioteca',    'aviso'),
  ('maquinario',    'aviso'),
  ('usuarios',      'aviso'),
  ('parceiros',     'aviso'),
  ('facilities',    'aviso')
on conflict (capacidade) do nothing;

alter table public.acesso_modo enable row level security;
drop policy if exists "Autenticado lê os modos" on public.acesso_modo;
create policy "Autenticado lê os modos" on public.acesso_modo
  for select to authenticated using (true);
drop policy if exists "Admin muda os modos" on public.acesso_modo;
create policy "Admin muda os modos" on public.acesso_modo
  for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- ---------------------------------------------------------------------------
-- 2. O registro do modo aviso
-- ---------------------------------------------------------------------------

-- UNLOGGED de propósito: é diagnóstico descartável, não dado do negócio. Perder
-- numa queda do servidor é aceitável; pagar WAL por cada leitura recusada, não.
create unlogged table if not exists public.acesso_negado (
  id          bigserial primary key,
  quando      timestamptz not null default now(),
  user_id     uuid,
  perfil      text,
  capacidade  text not null,
  onde        text
);

create index if not exists acesso_negado_cap_idx on public.acesso_negado (capacidade, quando desc);

comment on table public.acesso_negado is
  'O que o modo `aviso` teria barrado. Olhe aqui ANTES de virar uma capacidade '
  'para `bloqueio` — é o que diz se o mapa está certo. Ver acesso_negado_resumo.';

alter table public.acesso_negado enable row level security;
drop policy if exists "Admin lê o que seria negado" on public.acesso_negado;
create policy "Admin lê o que seria negado" on public.acesso_negado
  for select to authenticated using (public.eh_admin());

create or replace view public.acesso_negado_resumo as
  select capacidade, perfil, onde,
         count(*) as tentativas,
         max(quando) as ultima
    from public.acesso_negado
   group by capacidade, perfil, onde
   order by count(*) desc;

-- ---------------------------------------------------------------------------
-- 3. `pode` — a frase única
-- ---------------------------------------------------------------------------

-- Mesma matriz da tela (Configurações › Usuários › Perfis de acesso). O
-- `or perfil = 'admin'` é o cinto de sempre: se a linha do admin sumisse, ele
-- perderia o acesso e não teria como se devolver nada.
create or replace function public.pode(p_cap text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select p.perfil = 'admin'
        or p_cap = any(coalesce(
             (select a.capacidades from public.acesso_perfil a where a.perfil = p.perfil),
             '{}'::text[]))
      from public.profiles p
     where p.user_id = auth.uid()
     limit 1), false)
$$;

create or replace function public.acesso_modo_de(p_cap text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Capacidade desconhecida vale como `aviso`. Uma capacidade nova não deve
  -- nascer bloqueando o Hub por esquecimento de inserir a linha.
  select coalesce((select m.modo from public.acesso_modo m where m.capacidade = p_cap), 'aviso')
$$;

-- ---------------------------------------------------------------------------
-- 4. `pode_ler` — a versão para POLICY
-- ---------------------------------------------------------------------------

-- STABLE e SEM ESCRITA, ao contrário de `exigir`. Policy é avaliada dentro de
-- SELECT — e o PostgREST abre transação READ ONLY em GET, onde qualquer INSERT
-- derrubaria a consulta inteira. Além disso a policy roda por linha em alguns
-- planos: registrar aqui geraria milhares de linhas por página aberta.
--
-- Consequência assumida: o modo `aviso` NÃO mede leitura direta de tabela, só
-- RPC. Para as tabelas, quem responde "quem lê isto?" é o
-- `scripts/mapa-acesso.mjs`, que lê o código em vez de esperar o tráfego.
create or replace function public.pode_ler(p_cap text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    -- Cron, service_role e RPC definer não têm auth.uid(): não é gente, é o
    -- próprio Hub trabalhando. Barrar aqui quebraria toda a automação.
    when auth.uid() is null then true
    when public.acesso_modo_de(p_cap) <> 'bloqueio' then true
    else public.pode(p_cap)
  end
$$;

-- ---------------------------------------------------------------------------
-- 5. `exigir` — a versão para RPC
-- ---------------------------------------------------------------------------

-- Devolve boolean em vez de dar `raise`: assim serve tanto para função plpgsql
-- (`if not exigir(...) then return; end if;`) quanto para função `language sql`,
-- onde entra como `where public.exigir('x') and (...)` e faz a consulta devolver
-- zero linhas. Sem isso, cada função SQL teria de virar plpgsql só para ganhar
-- um `if`.
create or replace function public.exigir(p_cap text, p_onde text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_modo text;
  v_perfil text;
begin
  if auth.uid() is null then return true; end if;   -- cron / service_role
  if public.pode(p_cap) then return true; end if;

  v_modo := public.acesso_modo_de(p_cap);

  /* O registro é BEST-EFFORT e por isso vive num bloco próprio: muitas das
     funções que chamam isto são STABLE, e várias rodam sob transação read-only
     do PostgREST. Um INSERT que falha ali não pode derrubar a chamada — o
     diagnóstico é o acessório, a decisão é o principal. */
  begin
    select p.perfil into v_perfil from public.profiles p where p.user_id = auth.uid();
    insert into public.acesso_negado (user_id, perfil, capacidade, onde)
    values (auth.uid(), v_perfil, p_cap, coalesce(p_onde, 'rpc'));
  exception when others then null;
  end;

  return v_modo <> 'bloqueio';
end;
$function$;

revoke all on function public.pode(text) from public;
revoke all on function public.pode(text) from anon;
revoke all on function public.pode_ler(text) from public;
revoke all on function public.pode_ler(text) from anon;
revoke all on function public.exigir(text, text) from public;
revoke all on function public.exigir(text, text) from anon;
revoke all on function public.acesso_modo_de(text) from public;
revoke all on function public.acesso_modo_de(text) from anon;
grant execute on function public.pode(text) to authenticated, service_role;
grant execute on function public.pode_ler(text) to authenticated, service_role;
grant execute on function public.exigir(text, text) to authenticated, service_role;
grant execute on function public.acesso_modo_de(text) to authenticated, service_role;

revoke all on table public.acesso_modo from anon;
revoke all on table public.acesso_negado from anon;
grant select on table public.acesso_modo to authenticated;
grant select on table public.acesso_negado to authenticated;
grant all on table public.acesso_modo to service_role;
grant all on table public.acesso_negado to service_role;
grant usage, select on sequence public.acesso_negado_id_seq to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. SOCIETÁRIO: a primeira que fecha de verdade
-- ---------------------------------------------------------------------------

-- Captable, o flip e as empresas no exterior. Uma tabela, uma tela, o dado mais
-- sensível que o Hub guarda — participação de cada sócio. Era
-- `to authenticated using (true)`: qualquer conta lia.
drop policy if exists "investimentos_snapshot_rw_auth" on public.investimentos_snapshot;
drop policy if exists "Societário: só quem tem a capacidade" on public.investimentos_snapshot;
create policy "Societário: só quem tem a capacidade"
  on public.investimentos_snapshot for all to authenticated
  using (public.pode_ler('societario'))
  with check (public.pode_ler('societario'));

-- ---------------------------------------------------------------------------
-- 7. A prova do padrão nas RPCs: demonstracoes_lancamentos
-- ---------------------------------------------------------------------------

-- Esta função já tinha sido pega uma vez, em 04/08/2026, respondendo à anon key
-- (ver a nota de `supabase-grant-anon-automatico`). O `anon` foi fechado; a
-- função seguiu aberta a QUALQUER pessoa logada, devolvendo o razão inteiro.
--
-- Fica em `aviso` como o resto de demonstrações: por enquanto ela registra quem
-- não deveria estar ali e continua respondendo. Vira bloqueio quando
-- `acesso_negado_resumo` mostrar que ninguém legítimo aparece na lista.
--
-- O PADRÃO É EMBRULHAR, NÃO REESCREVER. A original vira `_interno` e ganha uma
-- casca com a mesma assinatura, que checa e delega. Reescrever o corpo — 60
-- linhas de SQL com regex, unaccent e escapes — só para inserir um `if` é a
-- forma mais fácil de introduzir um bug de cálculo numa migration de segurança.
-- E o mesmo molde serve para as outras ~40 RPCs que faltam.
do $$
begin
  -- Idempotente: se a interna já existe, a migration já rodou.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'demonstracoes_lancamentos_interno'
  ) then
    alter function public.demonstracoes_lancamentos(text, text, text)
      rename to demonstracoes_lancamentos_interno;
  end if;
end $$;

-- A interna some do alcance de quem chama pela API: só a casca é pública. Sem
-- isto, bastaria pedir `demonstracoes_lancamentos_interno` e pular a checagem.
revoke all on function public.demonstracoes_lancamentos_interno(text, text, text) from public;
revoke all on function public.demonstracoes_lancamentos_interno(text, text, text) from anon;
revoke all on function public.demonstracoes_lancamentos_interno(text, text, text) from authenticated;
grant execute on function public.demonstracoes_lancamentos_interno(text, text, text) to service_role;

create or replace function public.demonstracoes_lancamentos(
  p_tipo text, p_rubrica text, p_mes text
)
returns table(
  data date, vencimento date, titulo text, documento text, contraparte text,
  cnpj_cpf text, categoria_codigo text, categoria_descricao text, grupo text,
  status text, valor numeric, cod_titulo text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.exigir('demonstracoes', 'demonstracoes_lancamentos') then
    return;  -- em bloqueio devolve vazio; em aviso `exigir` já deixou passar
  end if;
  return query
    select * from public.demonstracoes_lancamentos_interno(p_tipo, p_rubrica, p_mes);
end;
$function$;

revoke all on function public.demonstracoes_lancamentos(text, text, text) from public;
revoke all on function public.demonstracoes_lancamentos(text, text, text) from anon;
grant execute on function public.demonstracoes_lancamentos(text, text, text) to authenticated, service_role;
