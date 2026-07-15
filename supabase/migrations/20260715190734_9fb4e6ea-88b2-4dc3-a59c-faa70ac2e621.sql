CREATE TABLE public.recargas_viagens_manuais (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  colaborador TEXT NOT NULL,
  destino TEXT NOT NULL,
  data_ida DATE,
  data_volta DATE,
  dias INTEGER NOT NULL DEFAULT 0,
  valor_total NUMERIC NOT NULL DEFAULT 0,
  viagem_hash TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recargas_viagens_manuais TO authenticated;
GRANT ALL ON public.recargas_viagens_manuais TO service_role;

ALTER TABLE public.recargas_viagens_manuais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read recargas_viagens_manuais"
  ON public.recargas_viagens_manuais FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert recargas_viagens_manuais"
  ON public.recargas_viagens_manuais FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update recargas_viagens_manuais"
  ON public.recargas_viagens_manuais FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete recargas_viagens_manuais"
  ON public.recargas_viagens_manuais FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_recargas_viagens_manuais_updated_at
  BEFORE UPDATE ON public.recargas_viagens_manuais
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();