-- Perfis de acesso — a segmentação do Hub por pessoa.
--
-- CONTEXTO (10/09/2026)
--
-- O acesso saía de `profiles.cargo`, texto livre digitado à mão, comparado no
-- front contra cinco nomes conhecidos. O que não batesse caía no caso padrão, e
-- o caso padrão era o Hub Financeiro inteiro. Nesta data havia sete contas nessa
-- situação — três "Head de ..." criadas hoje e três de consultoria sem cargo
-- nenhum — todas enxergando captable, reportes ao conselho, extratos e a tela de
-- Usuários.
--
-- Esta migration cria o campo `perfil` (lista FECHADA), separado do `cargo` (que
-- continua livre e continua sendo o rótulo da pessoa na tela), e o protege.
--
-- TRÊS COISAS QUE ESTAVAM ERRADAS E SAEM CONSERTADAS JUNTO:
--
-- 1. A policy de UPDATE de `profiles` era `auth.uid() = user_id`. Ou seja: o
--    botão "Editar" da tela de Usuários NUNCA gravou nada de ninguém além de
--    quem estava logado — o update casava zero linhas, o PostgREST devolvia 200,
--    e a tela dizia "Usuário atualizado". Sem uma policy para admin, o seletor
--    de perfil nasceria com o mesmo defeito.
--
-- 2. `profiles_guard_cargo` protegia só `cargo`. Com `perfil` desprotegido,
--    qualquer pessoa se promoveria a admin com um PATCH no PostgREST — a anon
--    key está no bundle e a policy de update do próprio perfil permite.
--
-- 3. `pode_ver_remuneracao()` lia `cargo` por texto. Passa a ler `perfil`.
--
-- Idempotente de ponta a ponta: dá para repetir sem estrago (ver
-- supabase-db-query-aplica-ddl — o arquivo roda inteiro numa transação).

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists perfil text;

alter table public.profiles drop constraint if exists profiles_perfil_valido;
alter table public.profiles add constraint profiles_perfil_valido
  check (perfil is null or perfil in (
    'admin', 'diretoria', 'lideranca', 'rh',
    'automacao', 'facilities', 'parcerias', 'externo'
  ));

comment on column public.profiles.perfil is
  'O que a pessoa VÊ — lista fechada, espelhada em src/lib/modules.ts (PERFIS). '
  'NULL = acesso ainda não definido: o Hub não abre nenhuma tela. '
  'Não confundir com `cargo`, que é o que a pessoa É (texto livre, só rótulo).';

-- ---------------------------------------------------------------------------
-- 2. Quem é admin
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER porque é chamada de dentro de policies sobre a própria
-- `profiles`: sem isso, a leitura recursiva bate na RLS e a policy nunca resolve.
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select p.perfil = 'admin' from public.profiles p where p.user_id = auth.uid() limit 1),
    false)
$$;

-- Função nova em `public` nasce executável sem login neste projeto, e o EXECUTE
-- pode chegar por PUBLIC ou por grant direto — revogar dos dois (ver
-- supabase-grant-anon-automatico).
revoke all on function public.eh_admin() from public;
revoke all on function public.eh_admin() from anon;
grant execute on function public.eh_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A trava dos dois campos
-- ---------------------------------------------------------------------------

create or replace function public.profiles_guard_cargo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admins_restantes integer;
begin
  -- Cron, Edge Functions e RPCs definer passam direto: não têm auth.uid() e
  -- reprovariam na checagem de admin.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if public.eh_admin() then
    -- NÃO DEIXE A CASA SEM CHAVE. Se o último admin se rebaixar, ninguém mais
    -- consegue mexer em perfil nenhum pela tela — o conserto passaria a exigir
    -- SQL direto no banco. Barrar aqui custa uma linha e evita o lockout.
    if old.perfil = 'admin' and new.perfil is distinct from 'admin' then
      select count(*) into v_admins_restantes
        from public.profiles p
       where p.perfil = 'admin' and p.id <> old.id;
      if v_admins_restantes = 0 then
        raise exception 'este é o último admin do Hub — promova outra pessoa antes de mudar este perfil';
      end if;
    end if;
    return new;
  end if;

  -- Todo o resto: os dois campos voltam ao que eram, em silêncio. O update do
  -- próprio nome continua passando.
  new.cargo  := old.cargo;
  new.perfil := old.perfil;
  return new;
end;
$function$;

drop trigger if exists profiles_guard_cargo on public.profiles;
create trigger profiles_guard_cargo
  before update on public.profiles
  for each row execute function public.profiles_guard_cargo();

-- ---------------------------------------------------------------------------
-- 4. Admin pode editar a ficha dos outros
-- ---------------------------------------------------------------------------

-- A policy antiga ("Users can update own profile") continua: cada um edita a
-- sua. Esta soma o admin — as policies de UPDATE são OR entre si.
drop policy if exists "Admin pode atualizar qualquer profile" on public.profiles;
create policy "Admin pode atualizar qualquer profile"
  on public.profiles for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- ---------------------------------------------------------------------------
-- 5. Backfill — as 16 contas de 10/09/2026
-- ---------------------------------------------------------------------------

-- Por E-MAIL, e não por cargo, porque é justamente o cargo que não resolve: três
-- "Head de ..." têm acessos diferentes entre si, e as três contas da consultoria
-- não têm cargo nenhum. Esta lista é uma decisão de pessoas tomada numa data —
-- quem entrar depois nasce NULL e cai no aviso "acesso ainda não definido", que
-- é o comportamento desejado.
update public.profiles p set perfil = v.perfil
from (values
  -- CEO e financeiro: operam tudo.
  ('miguel@takeat.app',                'admin'),
  ('henriquem.takeat@gmail.com',       'admin'),
  ('juliarocon.takeat@gmail.com',      'admin'),
  ('financeiro@takeat.app',            'admin'),
  -- Diretoria: número consolidado e societário, sem a rotina do financeiro.
  ('luizpaulo@takeat.app',             'diretoria'),
  ('pedro.faro@takeat.app',            'diretoria'),
  -- Heads de área: resultado e métrica de cliente, sem folha nem societário.
  ('danilo@takeat.app',                'lideranca'),
  ('vmbuteri.takeat@gmail.com',        'lideranca'),
  -- RH: pessoas e o que se paga a elas.
  ('anaclara@takeat.app',              'rh'),
  -- Automação/RPA: o maquinário, sem os números do negócio.
  ('brittes.takeat@gmail.com',         'automacao'),
  ('rpa.takeat@gmail.com',             'automacao'),
  -- Módulos travados, como já era.
  ('renanbrandolini.takeat@gmail.com', 'facilities'),
  ('rita.takeat@gmail.com',            'parcerias'),
  ('thais.takeat@gmail.com',           'parcerias'),
  -- Consultoria estratégica: demonstrações e plano, nada mais.
  ('guilherme@vpxcompany.com',         'externo'),
  ('lucas.pedroni@vpxcompany.com',     'externo'),
  ('pedro.colusse@vpxcompany.com',     'externo')
) as v(email, perfil)
where lower(btrim(p.email)) = v.email
  and p.perfil is distinct from v.perfil;

-- ---------------------------------------------------------------------------
-- 6. A folha passa a olhar o perfil
-- ---------------------------------------------------------------------------

-- Esta lista tem de bater EXATAMENTE com os perfis que declaram a capacidade
-- `remuneracao` em src/lib/modules.ts. Uma esconde, a outra protege; divergir
-- faz a tela vir vazia para quem deveria ver, ou cheia para quem não deveria.
create or replace function public.pode_ver_remuneracao()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select p.perfil in ('admin', 'diretoria', 'rh')
       from public.profiles p
      where p.user_id = auth.uid()
      limit 1),
    false)
$$;

revoke all on function public.pode_ver_remuneracao() from public;
revoke all on function public.pode_ver_remuneracao() from anon;
grant execute on function public.pode_ver_remuneracao() to authenticated, service_role;
