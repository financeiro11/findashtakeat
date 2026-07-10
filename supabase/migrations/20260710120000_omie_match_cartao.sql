-- Cruzamento dos lançamentos do cartão (auditoria) com os movimentos do Omie:
-- guarda a categoria contábil do Omie casada por valor + data (+ descrição).

ALTER TABLE public.auditoria_cartao_lancamentos
  ADD COLUMN IF NOT EXISTS omie_categoria_codigo    text,
  ADD COLUMN IF NOT EXISTS omie_categoria_descricao text,
  ADD COLUMN IF NOT EXISTS omie_match_confianca     text,  -- 'alta' | 'media' | 'baixa'
  ADD COLUMN IF NOT EXISTS omie_matched_em          timestamptz;
