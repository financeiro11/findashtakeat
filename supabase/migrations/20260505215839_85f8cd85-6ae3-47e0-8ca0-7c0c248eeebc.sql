CREATE TABLE public.de_para_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Crédito','Débito')),
  categoria TEXT,
  centro_custo TEXT,
  conta TEXT,
  cliente_fornecedor TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.de_para_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.de_para_rules FOR SELECT USING (true);
CREATE POLICY "public insert" ON public.de_para_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON public.de_para_rules FOR UPDATE USING (true);
CREATE POLICY "public delete" ON public.de_para_rules FOR DELETE USING (true);
CREATE INDEX ON public.de_para_rules (keyword);