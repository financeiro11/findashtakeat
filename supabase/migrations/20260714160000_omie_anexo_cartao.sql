-- =====================================================================
-- Envio do comprovante da auditoria para o Omie.
--
-- O comprovante que o gestor anexa pelo link público hoje só vive no bucket
-- `comprovantes-auditoria` e na tabela `auditoria`. Estas colunas registram
-- quando (e em qual título do Omie) ele foi efetivamente anexado no ERP —
-- para que o botão seja idempotente e não anexe o mesmo arquivo duas vezes
-- a cada clique.
--
-- `omie_cod_titulo` é o nCodTitulo do Omie: é o que o geral/anexo/IncluirAnexo
-- exige, e é justamente o que o omie-match-cartao descartava (ele só guardava
-- a categoria do casamento).
-- =====================================================================

ALTER TABLE public.auditoria_cartao_lancamentos
  ADD COLUMN IF NOT EXISTS omie_cod_titulo       text,
  ADD COLUMN IF NOT EXISTS omie_anexo_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS omie_anexo_nome       text;

CREATE INDEX IF NOT EXISTS idx_cartao_omie_anexo_pendente
  ON public.auditoria_cartao_lancamentos (omie_anexo_enviado_em)
  WHERE omie_anexo_enviado_em IS NULL;
