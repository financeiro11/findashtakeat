-- Vínculo entre a linha cadastrada aqui e a linha correspondente no TakeatOS.
--
-- Sem isso, o único jeito de reconhecer "é a mesma linha" seria comparar número ou
-- nome — que muda de formato entre os dois sistemas e falha em homônimo. Com o id de
-- origem, cadastrar o mesmo número duas vezes no TakeatOS atualiza o registro daqui
-- em vez de criar um duplicado.

ALTER TABLE public.recargas_celulares
  ADD COLUMN IF NOT EXISTS origem TEXT,
  ADD COLUMN IF NOT EXISTS origem_id TEXT;

COMMENT ON COLUMN public.recargas_celulares.origem_id IS
  'Id da linha no sistema de origem (TakeatOS). Chave de idempotência do webhook.';

-- Parcial: linhas cadastradas à mão aqui continuam com origem_id nulo, e várias
-- delas não podem colidir entre si num índice único comum.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recargas_celulares_origem
  ON public.recargas_celulares (origem, origem_id)
  WHERE origem_id IS NOT NULL;
