ALTER TABLE public.automacoes_catalogo
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS horas_mes numeric;