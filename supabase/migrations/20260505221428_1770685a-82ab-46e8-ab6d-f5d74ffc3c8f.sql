
-- Profiles for users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cargo TEXT,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert profiles"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete profiles"
  ON public.profiles FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Automatically create a profile row when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nome, cargo, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'cargo', ''),
    NEW.email
  );
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Restrict de_para_rules to authenticated users
DROP POLICY IF EXISTS "public read" ON public.de_para_rules;
DROP POLICY IF EXISTS "public insert" ON public.de_para_rules;
DROP POLICY IF EXISTS "public update" ON public.de_para_rules;
DROP POLICY IF EXISTS "public delete" ON public.de_para_rules;

CREATE POLICY "Auth read rules" ON public.de_para_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert rules" ON public.de_para_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update rules" ON public.de_para_rules FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete rules" ON public.de_para_rules FOR DELETE TO authenticated USING (true);

-- Automations catalog
CREATE TABLE public.automacoes_catalogo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem INT NOT NULL DEFAULT 0,
  automacao TEXT NOT NULL,
  responsavel TEXT,
  status TEXT NOT NULL DEFAULT 'A fazer',
  dor TEXT,
  solucao TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.automacoes_catalogo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read catalogo" ON public.automacoes_catalogo FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert catalogo" ON public.automacoes_catalogo FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update catalogo" ON public.automacoes_catalogo FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete catalogo" ON public.automacoes_catalogo FOR DELETE TO authenticated USING (true);

CREATE TRIGGER catalogo_updated_at BEFORE UPDATE ON public.automacoes_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
