-- Realizado do Orçamento (Governança) vindo do Omie.
--
-- Estratégia (não-destrutiva e reversível):
--   • orcamento_area_linha ganha `realizado_omie` + `omie_sincronizado_em`.
--     O `realizado` original (tracker_vomie_2026) fica INTACTO.
--   • As views passam a usar COALESCE(realizado_omie, realizado): onde o Omie
--     tem dado, ele manda; onde não tem (linha sem categoria mapeada), cai no
--     tracker. Antes do 1º sync, realizado_omie é NULL em tudo → comportamento
--     idêntico ao atual.
--   • orcamento_omie_map: de-para categoria Omie → (área, subcategoria) do
--     orçamento. Chave = descricao_categoria (mesma que o omie-sync usa para casar
--     o movimento, via cCodCateg→descrição→normalização). Editável pelo time.
--   • Regime = competência (data de registro), igual à DRE do Omie.

-- ---------------------------------------------------------------------------
-- 1) Colunas de realizado Omie (não-destrutivas)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orcamento_area_linha
  ADD COLUMN IF NOT EXISTS realizado_omie      numeric,
  ADD COLUMN IF NOT EXISTS omie_sincronizado_em timestamptz;

-- ---------------------------------------------------------------------------
-- 2) De-para categoria Omie → linha do orçamento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamento_omie_map (
  descricao_categoria text PRIMARY KEY,   -- chave de casamento (= codigo_categoria do omie_dre_mapa)
  rubrica             text,               -- rubrica DRE (referência)
  area                text,               -- área do orçamento (NULL = fora do orçamento)
  subcategoria        text,               -- subcategoria do orçamento
  origem              text NOT NULL DEFAULT 'auto',   -- 'auto' (semeado) | 'manual' (ajustado pelo time)
  ativo               boolean NOT NULL DEFAULT true,
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.orcamento_omie_map TO authenticated;
GRANT ALL ON public.orcamento_omie_map TO service_role;
ALTER TABLE public.orcamento_omie_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_map"   ON public.orcamento_omie_map;
DROP POLICY IF EXISTS "auth_write_map"  ON public.orcamento_omie_map;
CREATE POLICY "auth_read_map"  ON public.orcamento_omie_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_map" ON public.orcamento_omie_map FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3) Log de sincronização
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamento_omie_sync_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status            text NOT NULL,
  ano               int,
  movimentos        int,
  linhas_atualizadas int,
  nao_mapeadas      int,
  valor_nao_mapeado numeric,
  erro              text,
  iniciado_em       timestamptz NOT NULL DEFAULT now(),
  concluido_em      timestamptz
);
GRANT SELECT ON public.orcamento_omie_sync_log TO authenticated;
GRANT ALL    ON public.orcamento_omie_sync_log TO service_role;
ALTER TABLE public.orcamento_omie_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_synclog" ON public.orcamento_omie_sync_log;
CREATE POLICY "auth_read_synclog" ON public.orcamento_omie_sync_log FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 4) Views: realizado efetivo = COALESCE(realizado_omie, realizado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_orcamento_area AS
SELECT area, ano, mes,
  sum(orcado) AS orcado,
  sum(orcado) FILTER (WHERE pessoal) AS orcado_pessoal,
  sum(COALESCE(realizado_omie, realizado)) AS realizado,
  sum(COALESCE(realizado_omie, realizado)) FILTER (WHERE pessoal) AS realizado_pessoal,
  (sum(orcado) - sum(COALESCE(realizado_omie, realizado))) AS saldo,
  CASE WHEN sum(orcado) <> 0 THEN round(sum(COALESCE(realizado_omie, realizado)) / sum(orcado) * 100, 1) ELSE NULL END AS consumido_pct,
  CASE
    WHEN sum(orcado) = 0 AND sum(COALESCE(realizado_omie, realizado)) = 0 THEN 'sem'
    WHEN sum(orcado) = 0 OR (sum(COALESCE(realizado_omie, realizado)) / sum(orcado)) > 1.0 THEN 'estourado'
    WHEN (sum(COALESCE(realizado_omie, realizado)) / sum(orcado)) >= 0.9 THEN 'atencao'
    ELSE 'dentro'
  END AS status,
  bool_or(realizado_omie IS NOT NULL) AS tem_omie
FROM public.orcamento_area_linha
GROUP BY area, ano, mes;

CREATE OR REPLACE VIEW public.vw_orcamento_area_linha AS
SELECT area, subcategoria, pessoal, ano, mes, orcado,
  COALESCE(realizado_omie, realizado)::numeric(14,2) AS realizado,
  (orcado - COALESCE(realizado_omie, realizado)) AS saldo,
  CASE WHEN orcado <> 0 THEN round(COALESCE(realizado_omie, realizado) / orcado * 100, 1) ELSE NULL END AS consumido_pct,
  CASE WHEN realizado_omie IS NOT NULL THEN 'omie' ELSE fonte END AS fonte_realizado
FROM public.orcamento_area_linha;

-- ---------------------------------------------------------------------------
-- 5) Token de cron para a função protegida (padrão internal_cron_tokens)
-- ---------------------------------------------------------------------------
INSERT INTO public.internal_cron_tokens (name) VALUES ('omie-orcamento-sync')
  ON CONFLICT (name) DO NOTHING;
