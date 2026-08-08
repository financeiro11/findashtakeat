-- ============================================================
-- CARGA 3b - Confianca ponderada pelo tamanho da amostra
-- Problema: share puro da categoria modal da 1.0 para fornecedor com 1 titulo.
-- 100% de acerto sobre 1 ocorrencia nao e evidencia, e confianca e justamente
-- o numero que autoriza o humano a ligar permite_auto_lancamento (item V10).
-- Encolhimento: confianca = share * n/(n+2). n=1 -> 0.33 | n=5 -> 0.71 | n=20 -> 0.91
-- Coerente com a secao 11.2: "promocao exige volume minimo de aplicacoes".
-- ============================================================

update public.lib_fornecedores f
set confianca = round(
      (f.confianca * f.n_ocorrencias::numeric) / (f.n_ocorrencias + 2), 4)
where f.n_ocorrencias > 0;

comment on column public.lib_fornecedores.confianca is
  'Participacao da categoria modal nos titulos do fornecedor, encolhida pelo tamanho da amostra '
  '(share * n/(n+2)). De 0 a 1. Calculada, nao digitada. Fornecedor com poucas ocorrencias '
  'nunca chega perto de 1, mesmo com 100% de consistencia.';;
