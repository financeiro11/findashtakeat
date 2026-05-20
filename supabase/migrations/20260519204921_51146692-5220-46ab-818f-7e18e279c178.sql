ALTER TABLE public.parceiros_indicacoes
  ADD COLUMN IF NOT EXISTS hubspot_url text,
  ADD COLUMN IF NOT EXISTS asaas_url text;