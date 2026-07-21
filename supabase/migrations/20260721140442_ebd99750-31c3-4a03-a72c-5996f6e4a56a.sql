ALTER TABLE public.facilities_cotacoes
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb;