CREATE TABLE public.historico_financeiro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metrica text NOT NULL,
  ano integer NOT NULL,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor numeric NOT NULL DEFAULT 0,
  origem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hf_metrica_ano_mes ON public.historico_financeiro (metrica, ano, mes);
CREATE INDEX idx_hf_origem ON public.historico_financeiro (origem);

ALTER TABLE public.historico_financeiro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all hf" ON public.historico_financeiro
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_hf_updated_at
  BEFORE UPDATE ON public.historico_financeiro
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();