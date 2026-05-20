ALTER TABLE public.recargas_viagens_itens
  ADD COLUMN IF NOT EXISTS evento text,
  ADD COLUMN IF NOT EXISTS evento_inicio date,
  ADD COLUMN IF NOT EXISTS evento_fim date;