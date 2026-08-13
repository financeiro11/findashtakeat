-- Quando o colaborador pediu a recarga desta linha, e quando ela foi de fato feita.
--
-- recargas_celulares_solicitacoes guarda a FILA completa (todo pedido, com histórico
-- por colaborador). Estas duas colunas são o resumo da ÚLTIMA vez, para o card da tela
-- não precisar de subquery a cada render.
--
-- `ultima_recarga` já existia e continua sendo a data em que a recarga foi feita —
-- é ela que alimenta o cálculo de proxima_recarga. Não duplicamos esse dado.

ALTER TABLE public.recargas_celulares
  -- Data/hora do último pedido vindo do TakeatOS. Fica nulo nas linhas cadastradas
  -- à mão ou importadas de planilha, e o card simplesmente omite a linha.
  ADD COLUMN IF NOT EXISTS solicitado_em TIMESTAMPTZ;

COMMENT ON COLUMN public.recargas_celulares.solicitado_em IS
  'Data/hora da última solicitação de recarga (origem: TakeatOS). A recarga efetivada fica em ultima_recarga.';

-- A fila do dia é lida por ordem de pedido; o índice parcial só cobre quem tem pedido.
CREATE INDEX IF NOT EXISTS idx_recargas_celulares_solicitado_em
  ON public.recargas_celulares (solicitado_em DESC)
  WHERE solicitado_em IS NOT NULL;
