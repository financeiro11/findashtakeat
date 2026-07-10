CREATE TABLE public.asaas_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referencia text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}',
  gerado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referencia)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asaas_snapshots TO authenticated;
GRANT ALL ON public.asaas_snapshots TO service_role;

ALTER TABLE public.asaas_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read asaas_snapshots"
  ON public.asaas_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert asaas_snapshots"
  ON public.asaas_snapshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update asaas_snapshots"
  ON public.asaas_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);