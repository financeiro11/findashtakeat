ALTER TABLE public.auditoria_cartao_lancamentos
  ADD COLUMN IF NOT EXISTS omie_categoria_codigo    text,
  ADD COLUMN IF NOT EXISTS omie_categoria_descricao text,
  ADD COLUMN IF NOT EXISTS omie_match_confianca     text,
  ADD COLUMN IF NOT EXISTS omie_matched_em          timestamptz;