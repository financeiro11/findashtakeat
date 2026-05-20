ALTER TABLE public.automacoes_catalogo
  ADD COLUMN IF NOT EXISTS execucoes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_falha date;