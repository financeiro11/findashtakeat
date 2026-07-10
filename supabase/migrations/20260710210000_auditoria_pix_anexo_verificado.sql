-- Passo de anexos separado do sync (o ListarAnexo por título estourava o wall-time
-- da edge function). Esta flag marca quais lançamentos já tiveram o anexo verificado,
-- permitindo preencher os comprovantes em lotes resumíveis (action "anexos").

ALTER TABLE public.auditoria_pix_lancamentos
  ADD COLUMN IF NOT EXISTS anexo_verificado boolean NOT NULL DEFAULT false;

-- Índice parcial: acelera "buscar os que ainda faltam verificar".
CREATE INDEX IF NOT EXISTS idx_auditoria_pix_anexo_pendente
  ON public.auditoria_pix_lancamentos (referencia)
  WHERE anexo_verificado = false;
