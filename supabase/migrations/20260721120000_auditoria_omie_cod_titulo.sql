-- Id do título do Omie que casou com o achado (nCodTitulo). Sua PRESENÇA prova que a
-- categoria veio de um movimento REAL do Omie (não de um casamento fantasma), e permite
-- abrir/conferir o título. Preenchido pelo omie-match-cartao junto com a categoria.
ALTER TABLE public.auditoria
  ADD COLUMN IF NOT EXISTS omie_cod_titulo text;
