-- Classificação de cada automação por nível da pirâmide de maturidade (N1..N5),
-- exibida como badge no Catálogo (aba IA & Automação da Visão do Time).
ALTER TABLE public.automacoes_catalogo ADD COLUMN IF NOT EXISTS nivel int;
