-- =====================================================================
-- Integração Omie → DRE / DFC
-- - omie_dre_mapa: DE_PARA de categoria do Omie para a rubrica da DRE/DFC
-- - omie_sync_log: histórico de sincronizações
-- =====================================================================

CREATE TABLE public.omie_dre_mapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_categoria text NOT NULL,             -- código da categoria no Omie (ex.: "1.01.02")
  descricao_categoria text,                   -- descrição (apenas referência/visual)
  rubrica text NOT NULL,                       -- rótulo exato da linha na DRE/DFC do Hub
  demonstrativo text NOT NULL DEFAULT 'ambos'  -- onde aplica o mapeamento
    CHECK (demonstrativo IN ('dre', 'dfc', 'ambos')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo_categoria, demonstrativo)
);

CREATE INDEX idx_omie_dre_mapa_categoria ON public.omie_dre_mapa (codigo_categoria);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omie_dre_mapa TO authenticated;
GRANT ALL ON public.omie_dre_mapa TO service_role;

ALTER TABLE public.omie_dre_mapa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read omie_dre_mapa"
  ON public.omie_dre_mapa FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "Authenticated can insert omie_dre_mapa"
  ON public.omie_dre_mapa FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update omie_dre_mapa"
  ON public.omie_dre_mapa FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete omie_dre_mapa"
  ON public.omie_dre_mapa FOR DELETE
  TO authenticated USING (true);

-- ---------------------------------------------------------------------

CREATE TABLE public.omie_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  status text NOT NULL DEFAULT 'rodando'        -- 'rodando' | 'ok' | 'erro'
    CHECK (status IN ('rodando', 'ok', 'erro')),
  periodo_de date,
  periodo_ate date,
  categorias integer NOT NULL DEFAULT 0,
  movimentos integer NOT NULL DEFAULT 0,
  dre_linhas integer NOT NULL DEFAULT 0,
  dfc_linhas integer NOT NULL DEFAULT 0,
  nao_mapeadas integer NOT NULL DEFAULT 0,
  erro text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.omie_sync_log TO authenticated;
GRANT ALL ON public.omie_sync_log TO service_role;

ALTER TABLE public.omie_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read omie_sync_log"
  ON public.omie_sync_log FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "Authenticated can insert omie_sync_log"
  ON public.omie_sync_log FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update omie_sync_log"
  ON public.omie_sync_log FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
