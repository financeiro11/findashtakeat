CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cargo text;
BEGIN
  -- Cargo por e-mail (whitelist) — sobrepõe metadata quando o e-mail é conhecido.
  v_cargo := CASE lower(NEW.email)
    WHEN 'renanbrandolini.takeat@gmail.com' THEN 'facilities'
    ELSE COALESCE(NEW.raw_user_meta_data->>'cargo', '')
  END;

  INSERT INTO public.profiles (user_id, nome, cargo, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    v_cargo,
    NEW.email
  );
  RETURN NEW;
END;
$function$;