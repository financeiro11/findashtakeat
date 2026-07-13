-- Painel "Caixa" (panorama consolidado do caixa · Omie).
--
-- Duas tabelas:
--   • omie_caixa_snapshot — o dashboard inteiro já calculado (JSONB), no mesmo
--     espírito de demonstracoes_contabeis: a função omie-caixa-sync grava e a
--     página lê o snapshot mais recente (render instantâneo, sem bater no Omie).
--   • omie_caixa_conta — 1 linha por conta corrente do Omie, com o saldo do último
--     sync + metadados EDITÁVEIS pelo time (rótulo, subtítulo, ordem, saldo_inicial
--     para calibrar o saldo real e se entra no consolidado).

-- ---------------------------------------------------------------------------
-- Snapshot do painel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.omie_caixa_snapshot (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dados           jsonb NOT NULL,
  sincronizado_em timestamptz,                       -- horário do dado no Omie
  gerado_em       timestamptz NOT NULL DEFAULT now(),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omie_caixa_snapshot_gerado
  ON public.omie_caixa_snapshot (gerado_em DESC);

GRANT SELECT ON public.omie_caixa_snapshot TO authenticated;
GRANT ALL    ON public.omie_caixa_snapshot TO service_role;

ALTER TABLE public.omie_caixa_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read omie_caixa_snapshot" ON public.omie_caixa_snapshot;
CREATE POLICY "Authenticated can read omie_caixa_snapshot"
  ON public.omie_caixa_snapshot FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Contas correntes (saldo + metadados editáveis)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.omie_caixa_conta (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ncodcc         text NOT NULL UNIQUE,               -- código da conta no Omie (nCodCC)
  banco          text,
  nome           text,                               -- descrição vinda do Omie
  nome_exibicao  text,                               -- rótulo custom (opcional)
  subtitulo      text,                               -- ex.: "ag. 0912 · cc 45820-3"
  saldo_inicial  numeric NOT NULL DEFAULT 0,         -- calibração manual do saldo real
  saldo          numeric NOT NULL DEFAULT 0,         -- último saldo calculado pelo sync
  ordem          int     NOT NULL DEFAULT 100,
  incluir        boolean NOT NULL DEFAULT true,      -- entra no saldo consolidado?
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omie_caixa_conta_ordem
  ON public.omie_caixa_conta (ordem, nome);

GRANT SELECT, UPDATE ON public.omie_caixa_conta TO authenticated;
GRANT ALL           ON public.omie_caixa_conta TO service_role;

ALTER TABLE public.omie_caixa_conta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read omie_caixa_conta" ON public.omie_caixa_conta;
CREATE POLICY "Authenticated can read omie_caixa_conta"
  ON public.omie_caixa_conta FOR SELECT TO authenticated USING (true);

-- O time pode editar rótulo/subtítulo/ordem/saldo_inicial/incluir; o sync (service_role)
-- cuida de ncodcc/nome/banco/saldo. A policy de UPDATE libera authenticated — as colunas
-- de identidade do Omie são reescritas pelo próprio sync no próximo ciclo.
DROP POLICY IF EXISTS "Authenticated can update omie_caixa_conta" ON public.omie_caixa_conta;
CREATE POLICY "Authenticated can update omie_caixa_conta"
  ON public.omie_caixa_conta FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
