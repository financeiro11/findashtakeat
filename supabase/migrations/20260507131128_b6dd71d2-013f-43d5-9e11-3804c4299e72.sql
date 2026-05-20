
CREATE TABLE public.extratos_importados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('cartao','conta')),
  filename text NOT NULL,
  status text NOT NULL DEFAULT 'enviado',
  n8n_status integer,
  n8n_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extratos_importados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own imports" ON public.extratos_importados FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own imports" ON public.extratos_importados FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own imports" ON public.extratos_importados FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_extratos_user_created ON public.extratos_importados (user_id, created_at DESC);
