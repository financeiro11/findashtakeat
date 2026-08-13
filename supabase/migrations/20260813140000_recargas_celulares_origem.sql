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

-- NÃO pode ser índice parcial: o Postgres só casa um ON CONFLICT com índice parcial
-- se a própria instrução repetir o mesmo predicado, e o upsert do supabase-js não faz
-- isso — o webhook falharia com "no unique or exclusion constraint matching".
--
-- O parcial também era desnecessário: em índice único o Postgres trata NULL como
-- distinto, então as linhas cadastradas à mão (origem_id nulo) não colidem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recargas_celulares_origem
  ON public.recargas_celulares (origem, origem_id);
