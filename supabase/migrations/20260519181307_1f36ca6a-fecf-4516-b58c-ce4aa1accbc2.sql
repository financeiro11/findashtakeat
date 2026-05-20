CREATE TABLE public.parceiros_indicacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_negocio text UNIQUE NOT NULL,
  id_campanha text,
  nome_campanha text,
  indicador text,
  email_indicador text,
  vendedor text,
  codigo_indicacao text,
  nome_negocio text,
  mrr numeric,
  valor_total numeric,
  data_indicacao date,
  data_venda date,
  canal_aquisicao text,
  origem text,
  responsavel_takeat text,
  observacoes text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_parceiros_indicacoes_id_negocio ON public.parceiros_indicacoes (id_negocio);
CREATE INDEX idx_parceiros_indicacoes_data_indicacao ON public.parceiros_indicacoes (data_indicacao);

ALTER TABLE public.parceiros_indicacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read parceiros_indicacoes"
ON public.parceiros_indicacoes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth insert parceiros_indicacoes"
ON public.parceiros_indicacoes FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Auth update parceiros_indicacoes"
ON public.parceiros_indicacoes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Auth delete parceiros_indicacoes"
ON public.parceiros_indicacoes FOR DELETE TO authenticated USING (true);