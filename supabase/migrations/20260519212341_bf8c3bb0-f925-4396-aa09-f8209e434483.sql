
CREATE TABLE public.parceiros_cadastro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tier text NOT NULL DEFAULT 'Não possui',
  bonificacao boolean NOT NULL DEFAULT false,
  recorrencia boolean NOT NULL DEFAULT false,
  metodo_recorrencia text,
  valor_recorrencia numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parceiros_cadastro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read parceiros_cadastro" ON public.parceiros_cadastro FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert parceiros_cadastro" ON public.parceiros_cadastro FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update parceiros_cadastro" ON public.parceiros_cadastro FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete parceiros_cadastro" ON public.parceiros_cadastro FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_parceiros_cadastro_updated_at
BEFORE UPDATE ON public.parceiros_cadastro
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
