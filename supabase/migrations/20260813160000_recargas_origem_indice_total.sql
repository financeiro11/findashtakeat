-- Conserta o índice de origem em bancos onde a migration anterior já rodou.
--
-- O índice nasceu parcial (WHERE origem_id IS NOT NULL) e isso quebrava o upsert do
-- webhook: o Postgres só casa um ON CONFLICT com índice parcial quando a própria
-- instrução repete o mesmo predicado, e o supabase-js não emite esse WHERE. O evento
-- linha.sincronizada respondia 500 "no unique or exclusion constraint matching".
--
-- O predicado também era desnecessário: em índice único o Postgres trata NULL como
-- distinto, então as linhas cadastradas à mão (origem_id nulo) nunca colidem.
--
-- Idempotente: em banco novo a migration anterior já cria o índice na forma correta e
-- este arquivo apenas o recria igual.

DROP INDEX IF EXISTS public.idx_recargas_celulares_origem;

CREATE UNIQUE INDEX idx_recargas_celulares_origem
  ON public.recargas_celulares (origem, origem_id);
