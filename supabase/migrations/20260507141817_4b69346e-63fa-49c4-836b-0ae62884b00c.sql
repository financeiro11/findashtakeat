
CREATE TABLE public.ai_model_pricing (
  model TEXT PRIMARY KEY,
  input_per_1m_usd NUMERIC NOT NULL DEFAULT 0,
  output_per_1m_usd NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read pricing" ON public.ai_model_pricing FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write pricing" ON public.ai_model_pricing FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.ai_model_pricing (model, input_per_1m_usd, output_per_1m_usd) VALUES
  ('google/gemini-3-flash-preview', 0.30, 2.50),
  ('google/gemini-2.5-flash', 0.30, 2.50),
  ('google/gemini-2.5-flash-lite', 0.10, 0.40),
  ('google/gemini-2.5-pro', 1.25, 10.00),
  ('openai/gpt-5', 1.25, 10.00),
  ('openai/gpt-5-mini', 0.25, 2.00),
  ('openai/gpt-5-nano', 0.05, 0.40);

CREATE TABLE public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX ai_usage_log_created_at_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX ai_usage_log_user_idx ON public.ai_usage_log (user_id);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read usage" ON public.ai_usage_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert usage" ON public.ai_usage_log FOR INSERT TO authenticated WITH CHECK (true);
