-- A GUARDA DO PERFIL NUNCA DISPAROU.
--
-- `profiles_guard_cargo` existe desde 10/09/2026 para impedir que alguém escreva
-- o próprio `perfil` — a policy de UPDATE de `profiles` deixa cada pessoa editar
-- a própria linha (é assim que ela troca o próprio nome), e a trava contra
-- autopromoção era o trigger. A primeira linha dele é:
--
--     if current_user in ('service_role', 'postgres', 'supabase_admin')
--       then return new;
--
-- **`current_user` dentro de uma função `SECURITY DEFINER` é o DONO da função,
-- não quem chamou.** A função é do `postgres`, então essa condição é
-- SEMPRE VERDADEIRA e o trigger devolvia `new` intacto para todo mundo. Medido
-- em 10/09/2026, com a sessão de uma conta `lideranca`:
--
--     current_user (fora do definer) = authenticated
--     current_user (dentro)          = postgres      ← o atalho
--     auth.uid()                     = <a conta>
--     eh_admin()                     = false
--
-- E o efeito, com um UPDATE na própria linha: `perfil` virou `admin`. Ou seja,
-- qualquer conta logada podia tomar o Hub inteiro com um PATCH em
-- `/rest/v1/profiles?user_id=eq.<ela mesma>` — Captable, o Flip, os reportes ao
-- conselho, a folha, e a própria tela de Usuários, de onde se cria e se exclui
-- conta. O teste foi desfeito na hora.
--
-- O CONSERTO: perguntar pelo JWT, não pelo dono da função. `auth.role()` atravessa
-- o `SECURITY DEFINER` porque lê `request.jwt.claims`, que é da requisição e não
-- do dono — e é a mesma coisa que `auth.uid()` já lia duas linhas abaixo.
--
--   sem JWT      → cron, psql, `supabase db query`  → passa
--   service_role → Edge Function com a chave de serviço → passa
--   authenticated/anon → é gente, e gente é conferida
--
-- `remuneracao_atualizar` tem um comentário que repete o mesmo engano ("o
-- `current_user = 'postgres'` deixa o cron passar"), mas o CÓDIGO dela sempre
-- perguntou por `auth.uid()`. Só o comentário está errado; corrigido abaixo para
-- ninguém copiar o padrão de novo.

create or replace function public.profiles_guard_cargo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_papel            text := coalesce(auth.role(), '');
  v_admins_restantes integer;
begin
  /* NÃO USE `current_user` AQUI. Dentro de uma função SECURITY DEFINER ele é o
     dono (postgres), e a condição vale para qualquer um que chame — foi assim
     que este trigger passou a existir sem nunca funcionar. O papel da REQUISIÇÃO
     é o que separa o cron de uma pessoa. */
  if v_papel = '' or v_papel = 'service_role' then
    return new;
  end if;

  if public.eh_admin() then
    -- NÃO DEIXE A CASA SEM CHAVE. Se o último admin se rebaixar, ninguém mais
    -- consegue mexer em perfil nenhum pela tela — o conserto passaria a exigir
    -- SQL direto no banco.
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

  -- Todo o resto: os campos de acesso voltam ao que eram, em silêncio. O update
  -- do próprio nome continua passando.
  new.cargo         := old.cargo;
  new.perfil        := old.perfil;
  new.setores_folha := old.setores_folha;
  return new;
end;
$function$;

/* A policy de auto-edição tinha USING e nenhum WITH CHECK: a linha VELHA era
   conferida, a NOVA não. Sem isto, a pessoa podia apontar a própria linha para
   o `user_id` de outra conta — o trigger não olha `user_id`, e não olharia. */
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Só o comentário: o código desta função sempre perguntou por `auth.uid()`.
comment on function public.remuneracao_atualizar() is
  'Recarrega a folha do Omie. A guarda é auth.uid(): sem JWT (cron, service '
  'role) passa; com JWT, exige pode_ver_remuneracao(). NÃO use current_user '
  'numa função SECURITY DEFINER — lá ele é o dono, não quem chamou.';
