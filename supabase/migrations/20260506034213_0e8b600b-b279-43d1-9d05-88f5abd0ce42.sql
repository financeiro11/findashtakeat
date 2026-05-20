CREATE TABLE public.recargas_celulares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proprietario TEXT NOT NULL,
  numero TEXT,
  situacao TEXT,
  setor TEXT,
  ultima_recarga DATE,
  proxima_recarga DATE,
  valor NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.recargas_viagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.recargas_viagens_itens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  viagem_id UUID NOT NULL REFERENCES public.recargas_viagens(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  setor TEXT,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recargas_celulares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recargas_viagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recargas_viagens_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all rc" ON public.recargas_celulares FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all rv" ON public.recargas_viagens FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all rvi" ON public.recargas_viagens_itens FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_rc_updated BEFORE UPDATE ON public.recargas_celulares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rv_updated BEFORE UPDATE ON public.recargas_viagens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_rv_data ON public.recargas_viagens(data);
CREATE INDEX idx_rvi_viagem ON public.recargas_viagens_itens(viagem_id);