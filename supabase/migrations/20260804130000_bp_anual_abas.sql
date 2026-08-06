-- O importador do BP lia só a primeira aba da planilha (Consolidado), então as
-- abas Equipe, Operação e Geral nunca chegavam ao banco — o quadro de cargos e
-- o headcount por área ficavam presos numa constante do frontend.
-- `abas` guarda todas as abas da planilha como matriz crua (aba → linhas × colunas);
-- `dados` continua sendo a Consolidado, no formato antigo, pra não quebrar o parse.
ALTER TABLE public.bp_anual
  ADD COLUMN IF NOT EXISTS abas jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.bp_anual.abas IS
  'Todas as abas da planilha do BP como matriz crua: {"Equipe": [[celula, ...], ...], ...}';
