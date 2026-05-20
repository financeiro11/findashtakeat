ALTER TABLE public.parceiros_cadastro
  ADD COLUMN IF NOT EXISTS metodo_bonificacao text,
  ADD COLUMN IF NOT EXISTS valor_bonificacao numeric;