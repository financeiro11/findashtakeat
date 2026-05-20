UPDATE editais
SET visibility_status = 'visivel',
    exclusion_reason = NULL
WHERE match_score >= 60
  AND visibility_status = 'oculto_por_baixa_relevancia'
  AND COALESCE(opportunity_type, 'outro') NOT IN ('compra_publica','licitacao');