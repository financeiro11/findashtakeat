-- Ninguém cria conta no Hub por conta própria.
--
-- ===========================================================================
-- ACHADO EM 30/08/2026, 23h20, DEPOIS DE A INVASÃO JÁ TER SIDO CONTIDA
--
-- Conferindo se o novo "Esqueci a senha" podia ser abusado, o teste seguinte
-- passou — e não devia:
--
--     POST /auth/v1/signup   {"email":"...", "password":"..."}   → HTTP 200
--
-- O cadastro público do GoTrue estava LIGADO. Com a anon key (que é pública,
-- está no bundle), qualquer pessoa da internet criava conta. E o estrago não
-- parava aí, porque três coisas se encaixavam:
--
--   1. O gatilho `on_auth_user_created` criava o `profiles` sozinho, com
--      `cargo = NULL`.
--   2. `moduleAccess(null)` cai no último `return` de `src/lib/modules.ts` —
--      que é ACESSO AO HUB FINANCEIRO INTEIRO. Cargo nulo não é "sem acesso",
--      é "acesso padrão".
--   3. A RLS do projeto é `to authenticated using (true)` em praticamente toda
--      tabela. Ou seja, nem precisava da tela: com a sessão na mão, a API
--      devolvia tudo.
--
-- Resumindo o caminho que estava aberto: cadastrar-se com um e-mail qualquer →
-- confirmar no próprio e-mail → ler o financeiro inteiro.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA SOLUÇÃO, e não "desligar o signup no painel"
--
-- Desligar no painel é o conserto CERTO e continua sendo necessário — mas é um
-- ajuste de configuração, fora do git, que ninguém revisa e que volta sozinho no
-- dia em que alguém restaurar um projeto ou clicar errado. Esta migração é a
-- rede embaixo: mesmo com o signup ligado, o cadastro não conclui.
--
-- COMO FUNCIONA: o Hub anota o e-mail em `cadastro_autorizado` ANTES de mandar o
-- Auth criar a conta (é o que `create-user` faz). O gatilho recusa qualquer
-- usuário cujo e-mail não esteja lá — e recusar dentro do gatilho aborta a
-- transação inteira, então nem o usuário nasce nem o e-mail de confirmação sai.
--
-- A alternativa que eu descartei era adivinhar a forma do INSERT ("se
-- `email_confirmed_at` for nulo, é signup público"). Funciona hoje e quebra
-- calada na próxima versão do GoTrue, do lado errado: passando a deixar entrar.
-- Uma lista explícita não depende de detalhe interno de ninguém.

/* ================================================== a autorização prévia */

create table if not exists public.cadastro_autorizado (
  email          text primary key,
  autorizado_em  timestamptz not null default now(),
  autorizado_por text,
  usado_em       timestamptz
);

comment on table public.cadastro_autorizado is
  'Quem PODE virar usuário. O Hub grava aqui antes de pedir ao Auth para criar a conta; o gatilho handle_new_user recusa quem não estiver na lista. É o que impede cadastro público mesmo com o signup ligado no painel.';

alter table public.cadastro_autorizado enable row level security;

-- Ninguém lê nem escreve pelo PostgREST: quem usa é o gatilho (security
-- definer) e a Edge Function `create-user` (service role, que ignora RLS).
-- Sem policy nenhuma, `authenticated` também não alcança — e não precisa.
revoke all on table public.cadastro_autorizado from anon, authenticated;

/* ========================================================== o porteiro */

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_autorizado boolean;
begin
  select true into v_autorizado
    from public.cadastro_autorizado
   where lower(email) = lower(NEW.email)
   limit 1;

  if not coalesce(v_autorizado, false) then
    -- Aborta a transação do GoTrue: a conta não é criada e o e-mail de
    -- confirmação não sai. A mensagem é seca de propósito — ela chega ao
    -- desconhecido que tentou, e não tem por que explicar o mecanismo.
    raise exception 'Cadastro não autorizado.'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (user_id, email, nome, cargo)
  values (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    /* O cargo passa a vir de quem cadastrou. O CASE por e-mail cravado no
       código saiu: ele resolvia o caso do Renan e deixava todo o resto em NULL
       — que, por causa do `moduleAccess`, é justamente o acesso mais amplo. */
    nullif(trim(coalesce(NEW.raw_user_meta_data->>'cargo', '')), '')
  )
  on conflict (user_id) do nothing;

  update public.cadastro_autorizado
     set usado_em = now()
   where lower(email) = lower(NEW.email);

  return NEW;
end;
$fn$;

comment on function public.handle_new_user() is
  'Porteiro do cadastro: recusa usuário cujo e-mail não esteja em cadastro_autorizado, e cria o profile com o cargo que veio de quem cadastrou. Ver o cabeçalho da migração 20260831002000.';

/* Os onze que já existem ficam na lista — senão um reparo futuro de cadastro
   (o caminho de `admin-reset-password` que recria usuário sumido do Auth)
   esbarraria no próprio porteiro. */
insert into public.cadastro_autorizado (email, autorizado_por, usado_em)
select u.email, 'existente em 30/08/2026', now()
  from auth.users u
 where u.email is not null
on conflict (email) do nothing;
