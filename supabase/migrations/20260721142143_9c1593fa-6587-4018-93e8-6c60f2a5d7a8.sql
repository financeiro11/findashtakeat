CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, nome, cargo)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    CASE NEW.email
      WHEN 'renanbrandolini.takeat@gmail.com' THEN 'Facilities'
      ELSE NULL
    END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

UPDATE public.profiles SET cargo = 'Facilities' WHERE lower(trim(cargo)) = 'facilities';