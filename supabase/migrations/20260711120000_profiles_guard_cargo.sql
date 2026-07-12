-- Impede AUTO-ESCALADA DE PRIVILÉGIO via profiles.cargo.
--
-- A policy de UPDATE de profiles permite o usuário editar a própria linha
-- (USING auth.uid() = user_id), porém SEM restrição de coluna. Como o front libera
-- as páginas conforme o `cargo`, qualquer usuário podia se auto-promover fazendo
--   update profiles set cargo = 'financeiro' where user_id = auth.uid();
-- e destravar o Hub inteiro (inclusive um usuário travado como "parcerias").
--
-- Este trigger preserva o `cargo` em updates feitos por CLIENTES (roles authenticated/
-- anon): a tentativa de mudar o cargo é silenciosamente ignorada. Mudanças de cargo
-- passam a valer apenas via SERVICE ROLE (funções admin / back-office). A criação de
-- usuário não é afetada (define o cargo no INSERT, não no UPDATE).

CREATE OR REPLACE FUNCTION public.profiles_guard_cargo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cargo IS DISTINCT FROM OLD.cargo AND current_user <> 'service_role' THEN
    NEW.cargo := OLD.cargo;  -- ignora a alteração de cargo vinda do cliente
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_cargo ON public.profiles;
CREATE TRIGGER trg_profiles_guard_cargo
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_cargo();
