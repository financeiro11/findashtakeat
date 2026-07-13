CREATE OR REPLACE FUNCTION public.profiles_guard_cargo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cargo IS DISTINCT FROM OLD.cargo AND current_user <> 'service_role' THEN
    NEW.cargo := OLD.cargo;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_cargo ON public.profiles;
CREATE TRIGGER trg_profiles_guard_cargo
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_cargo();