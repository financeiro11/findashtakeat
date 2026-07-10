-- Resolução do nome do fornecedor sai de dentro do sync (fazia ~150 ConsultarCliente
-- inline e estourava o timeout HTTP) e passa para o passo em lotes (ação "anexos").
--   • cod_cliente: código do cliente/fornecedor no Omie — o sync grava, o lote resolve;
--   • cnpj_cpf: CNPJ/CPF cru — fallback de exibição enquanto o nome não foi resolvido.
-- `favorecido` passa a ser propriedade do passo em lotes (o sync não o sobrescreve),
-- então re-sincronizar não reverte um nome já resolvido.

ALTER TABLE public.auditoria_pix_lancamentos
  ADD COLUMN IF NOT EXISTS cod_cliente text,
  ADD COLUMN IF NOT EXISTS cnpj_cpf    text;
