-- Investimentos (Takeat LTD/LLC) — persiste o export do contador importado no /investimentos.
-- Uma linha por entidade; `dados` guarda todas as abas parseadas (Balance Sheet, P&L,
-- Cash Flow, AP Aging, GL, TB, Capital) em JSONB. Antes ficava só em memória (sumia ao
-- navegar/atualizar); agora sobrevive.

CREATE TABLE IF NOT EXISTS public.investimentos_snapshot (
  entity        text PRIMARY KEY,          -- "Takeat LTD" | "Takeat LLC"
  dados         jsonb NOT NULL,            -- EntityData: { balance, pl, cf, ap, gl, tb, capital, issuedAt }
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investimentos_snapshot ENABLE ROW LEVEL SECURITY;

-- Usuários logados leem e gravam (a importação é feita no cliente com a sessão do usuário).
DROP POLICY IF EXISTS "investimentos_snapshot_rw_auth" ON public.investimentos_snapshot;
CREATE POLICY "investimentos_snapshot_rw_auth"
  ON public.investimentos_snapshot FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
