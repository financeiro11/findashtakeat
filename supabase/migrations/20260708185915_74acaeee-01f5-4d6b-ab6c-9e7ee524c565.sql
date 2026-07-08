-- Aplica migrations 20260708120000_omie_integration.sql + 20260708130000_omie_de_para_seed.sql (idempotente)
CREATE TABLE IF NOT EXISTS public.omie_dre_mapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_categoria text NOT NULL,
  descricao_categoria text,
  rubrica text NOT NULL,
  demonstrativo text NOT NULL DEFAULT 'ambos' CHECK (demonstrativo IN ('dre','dfc','ambos')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo_categoria, demonstrativo)
);
CREATE INDEX IF NOT EXISTS idx_omie_dre_mapa_categoria ON public.omie_dre_mapa (codigo_categoria);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.omie_dre_mapa TO authenticated;
GRANT ALL ON public.omie_dre_mapa TO service_role;
ALTER TABLE public.omie_dre_mapa ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated can read omie_dre_mapa" ON public.omie_dre_mapa FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated can insert omie_dre_mapa" ON public.omie_dre_mapa FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated can update omie_dre_mapa" ON public.omie_dre_mapa FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated can delete omie_dre_mapa" ON public.omie_dre_mapa FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.omie_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  status text NOT NULL DEFAULT 'rodando' CHECK (status IN ('rodando','ok','erro')),
  periodo_de date, periodo_ate date,
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
DO $$ BEGIN
  CREATE POLICY "Authenticated can read omie_sync_log" ON public.omie_sync_log FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated can insert omie_sync_log" ON public.omie_sync_log FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Authenticated can update omie_sync_log" ON public.omie_sync_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed DE_PARA será inserido via aplicação subsequente do arquivo já existente
-- 20260708130000_omie_de_para_seed.sql (será re-executado pelo supabase migration runner).