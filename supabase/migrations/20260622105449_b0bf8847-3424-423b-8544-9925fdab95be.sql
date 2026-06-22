CREATE TABLE public.embaixador_valores_calculados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embaixador text NOT NULL,
  embaixador_normalizado text NOT NULL,
  mes text NOT NULL,
  bonificacao_total numeric NOT NULL DEFAULT 0,
  recorrencia_total numeric NOT NULL DEFAULT 0,
  soma numeric NOT NULL DEFAULT 0,
  calculado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (embaixador_normalizado, mes)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.embaixador_valores_calculados TO authenticated;
GRANT ALL ON public.embaixador_valores_calculados TO service_role;

ALTER TABLE public.embaixador_valores_calculados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read embaixador_valores_calculados"
  ON public.embaixador_valores_calculados FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert embaixador_valores_calculados"
  ON public.embaixador_valores_calculados FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update embaixador_valores_calculados"
  ON public.embaixador_valores_calculados FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);