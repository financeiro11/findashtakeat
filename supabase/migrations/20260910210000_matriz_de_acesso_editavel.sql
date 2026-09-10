-- A matriz de acesso sai do código e vira dado.
--
-- Até aqui, o que cada perfil enxergava era uma constante em
-- `src/lib/modules.ts`: mudar o acesso da liderança exigia editar TypeScript,
-- buildar e publicar. Agora mora em `acesso_perfil`, e a tela
-- Configurações › Usuários › Perfis de acesso edita direto.
--
-- O CÓDIGO CONTINUA SENDO O PADRÃO, e isso é de propósito: perfil que não tem
-- linha nesta tabela cai nas capacidades escritas em `PERFIS`. Se a leitura
-- falhar (rede, RLS, tabela vazia), o Hub não abre tudo nem tranca tudo — usa a
-- matriz revisada que está no repositório. É o único default que se pode
-- auditar lendo um arquivo.
--
-- DUAS TRAVAS QUE NÃO SE EDITAM:
--   • `admin` tem tudo, sempre. É a chave da casa: se desse para tirar
--     `usuarios` do admin pela tela, a própria tela de perfis ficaria
--     inalcançável e o conserto exigiria SQL direto no banco.
--   • `restrito` não entra aqui. Ele não é um perfil que se escolhe, é onde cai
--     quem não tem perfil — e o que ele vê é nada.

-- ---------------------------------------------------------------------------
-- 1. A tabela
-- ---------------------------------------------------------------------------

create table if not exists public.acesso_perfil (
  perfil          text primary key,
  capacidades     text[] not null default '{}',
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid
);

alter table public.acesso_perfil drop constraint if exists acesso_perfil_valido;
alter table public.acesso_perfil add constraint acesso_perfil_valido
  check (perfil in (
    'admin', 'diretoria', 'lideranca', 'rh',
    'automacao', 'facilities', 'parcerias', 'externo'
  ));

comment on table public.acesso_perfil is
  'O que cada perfil enxerga. Espelha PERFIS em src/lib/modules.ts, que continua '
  'sendo o padrão de quem não tiver linha aqui. Editada em Configurações › Usuários.';

alter table public.acesso_perfil enable row level security;

-- LER é de todo mundo: cada pessoa precisa saber o próprio acesso para o Hub
-- montar o menu. A tabela não guarda dado de negócio, só o mapa de perfis.
drop policy if exists "Autenticado lê a matriz de acesso" on public.acesso_perfil;
create policy "Autenticado lê a matriz de acesso"
  on public.acesso_perfil for select to authenticated using (true);

-- ESCREVER é só do admin — é literalmente a régua de quem vê o quê.
drop policy if exists "Admin edita a matriz de acesso" on public.acesso_perfil;
create policy "Admin edita a matriz de acesso"
  on public.acesso_perfil for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- ---------------------------------------------------------------------------
-- 2. O admin é imutável — no banco, não só na tela
-- ---------------------------------------------------------------------------

create or replace function public.acesso_perfil_guarda()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Esconder o checkbox na tela não impede um PATCH no PostgREST. A garantia
  -- tem de estar aqui: qualquer escrita na linha do admin devolve a linha
  -- cheia, e apagá-la é recusado.
  if tg_op = 'DELETE' and old.perfil = 'admin' then
    raise exception 'a linha do admin não pode ser removida';
  end if;
  if new.perfil = 'admin' then
    new.capacidades := array[
      'metricas', 'tesouraria', 'conciliacao', 'demonstracoes', 'planejamento',
      'orcamento', 'societario', 'apresentacoes', 'editais', 'remuneracao',
      'time', 'biblioteca', 'maquinario', 'usuarios', 'parceiros', 'facilities',
      'assistente'
    ];
  end if;
  return new;
end;
$function$;

drop trigger if exists acesso_perfil_guarda on public.acesso_perfil;
create trigger acesso_perfil_guarda
  before insert or update or delete on public.acesso_perfil
  for each row execute function public.acesso_perfil_guarda();

-- ---------------------------------------------------------------------------
-- 3. Semente — a matriz decidida em 10/09/2026
-- ---------------------------------------------------------------------------

-- `on conflict do nothing`: rodar de novo não desfaz o que alguém editou pela
-- tela. Quem quiser voltar ao padrão apaga a linha, e o código assume.
insert into public.acesso_perfil (perfil, capacidades) values
  ('admin', array[
    'metricas','tesouraria','conciliacao','demonstracoes','planejamento','orcamento',
    'societario','apresentacoes','editais','remuneracao','time','biblioteca',
    'maquinario','usuarios','parceiros','facilities','assistente']),
  ('diretoria', array[
    'metricas','tesouraria','demonstracoes','planejamento','orcamento','societario',
    'apresentacoes','editais','remuneracao','time','biblioteca','parceiros','assistente']),
  ('lideranca', array['metricas','demonstracoes','planejamento','orcamento','assistente']),
  ('rh', array['remuneracao','biblioteca','assistente']),
  ('automacao', array['time','maquinario','biblioteca','assistente']),
  ('facilities', array['facilities']),
  ('parcerias', array['parceiros']),
  ('externo', array['demonstracoes','planejamento'])
on conflict (perfil) do nothing;

-- ---------------------------------------------------------------------------
-- 4. A folha passa a seguir a matriz
-- ---------------------------------------------------------------------------

-- Antes, esta função tinha a lista de perfis escrita dentro dela — o que
-- significava que tirar `remuneracao` de alguém pela tela escondia o menu e
-- DEIXAVA O DADO PASSANDO. As duas metades andam juntas agora porque leem a
-- mesma linha.
--
-- O `or p.perfil = 'admin'` é o cinto: se a linha do admin sumisse, ele perderia
-- a folha e não teria como se devolver o acesso.
create or replace function public.pode_ver_remuneracao()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select p.perfil = 'admin'
        or 'remuneracao' = any(coalesce(
             (select a.capacidades from public.acesso_perfil a where a.perfil = p.perfil),
             '{}'::text[]))
      from public.profiles p
     where p.user_id = auth.uid()
     limit 1), false)
$$;

revoke all on function public.pode_ver_remuneracao() from public;
revoke all on function public.pode_ver_remuneracao() from anon;
grant execute on function public.pode_ver_remuneracao() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Quem pode falar com o Assistente
-- ---------------------------------------------------------------------------

-- `assistente` é capacidade como as outras — sai da mesma tela. Existe porque o
-- system prompt do ai-chat injeta o negócio inteiro: esconder a bolinha no front
-- não fecha nada, a função responde a quem a chamar.
create or replace function public.pode_usar_assistente()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select p.perfil = 'admin'
        or 'assistente' = any(coalesce(
             (select a.capacidades from public.acesso_perfil a where a.perfil = p.perfil),
             '{}'::text[]))
      from public.profiles p
     where p.user_id = auth.uid()
     limit 1), false)
$$;

revoke all on function public.pode_usar_assistente() from public;
revoke all on function public.pode_usar_assistente() from anon;
grant execute on function public.pode_usar_assistente() to authenticated, service_role;

-- A tabela nasceria legível por anon como todo objeto novo deste projeto.
revoke all on table public.acesso_perfil from anon;
grant select, insert, update, delete on table public.acesso_perfil to authenticated;
grant all on table public.acesso_perfil to service_role;
