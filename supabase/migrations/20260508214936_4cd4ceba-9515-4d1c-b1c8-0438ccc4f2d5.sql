
-- 1. Novos campos na tabela editais
ALTER TABLE public.editais
  ADD COLUMN IF NOT EXISTS visibility_status text NOT NULL DEFAULT 'visivel',
  ADD COLUMN IF NOT EXISTS relevance_reason text,
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS source_priority integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS opportunity_type text;

CREATE INDEX IF NOT EXISTS idx_editais_visibility ON public.editais(visibility_status);
CREATE INDEX IF NOT EXISTS idx_editais_opp_type ON public.editais(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_editais_match_score ON public.editais(match_score);

-- 2. Tabela de configurações do filtro (singleton — 1 linha)
CREATE TABLE IF NOT EXISTS public.edital_filter_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_match_score integer NOT NULL DEFAULT 60,
  preferred_keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  excluded_keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  preferred_sources text[] NOT NULL DEFAULT ARRAY[]::text[],
  excluded_sources text[] NOT NULL DEFAULT ARRAY[]::text[],
  preferred_regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  opportunity_types text[] NOT NULL DEFAULT ARRAY['fomento','subvencao','chamada_publica','programa_startup','aceleracao','premio']::text[],
  show_low_relevance boolean NOT NULL DEFAULT false,
  show_pncp_results boolean NOT NULL DEFAULT true,
  pncp_min_match_score integer NOT NULL DEFAULT 80,
  fapes_priority_boost integer NOT NULL DEFAULT 30,
  startup_priority_boost integer NOT NULL DEFAULT 20,
  innovation_priority_boost integer NOT NULL DEFAULT 20,
  perfil_empresa text DEFAULT '',
  notif_prazo boolean NOT NULL DEFAULT true,
  notif_diarias boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.edital_filter_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth all efs" ON public.edital_filter_settings;
CREATE POLICY "auth all efs" ON public.edital_filter_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_efs_updated ON public.edital_filter_settings;
CREATE TRIGGER trg_efs_updated BEFORE UPDATE ON public.edital_filter_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Seed singleton com perfil Takeat
INSERT INTO public.edital_filter_settings (
  min_match_score, preferred_keywords, excluded_keywords,
  preferred_sources, opportunity_types, pncp_min_match_score,
  fapes_priority_boost, startup_priority_boost, innovation_priority_boost,
  perfil_empresa, preferred_regions
)
SELECT
  60,
  ARRAY[
    'inovação','inovacao','startup','inteligência artificial','inteligencia artificial','ia',
    'saas','software','sistema de gestão','plataforma','tecnologia','automação','automacao',
    'analytics','dados','business intelligence','bi','erp','aplicativo','app',
    'transformação digital','transformacao digital','foodtech','food service','restaurante','restaurantes',
    'cardápio digital','delivery','atendimento digital','autoatendimento',
    'pme','pmes','pesquisa e desenvolvimento','p&d','pd&i','pdi',
    'subvenção','subvencao','fomento','desenvolvimento tecnológico','desenvolvimento tecnologico',
    'nova economia','clusters de inovação','clusters de inovacao','extensão tecnológica','extensao tecnologica',
    'competitividade','produtividade','aceleração','aceleracao','prêmio','premio'
  ],
  ARRAY[
    'obra','obras','engenharia','construção','construcao','reforma','pavimentação','pavimentacao',
    'limpeza','vigilância','vigilancia','merenda','alimentação escolar','alimentacao escolar',
    'combustível','combustivel','medicamento','medicamentos','veículo','veiculo','veículos','veiculos',
    'manutenção predial','manutencao predial','material de expediente','material de limpeza',
    'locação de máquinas','locacao de maquinas','transporte escolar','uniforme','pneus',
    'peças automotivas','pecas automotivas','farda','gêneros alimentícios','generos alimenticios',
    'medicamento hospitalar'
  ],
  ARRAY['fapes','finep','embrapii','sebrae','inovativa','bndes'],
  ARRAY['fomento','subvencao','chamada_publica','programa_startup','aceleracao','premio'],
  80, 30, 20, 20,
  'Startup SaaS de tecnologia para food service. Soluções para restaurantes: gestão, delivery, autoatendimento, automação, dados e IA. Sede no Espírito Santo.',
  ARRAY['ES','Espírito Santo','Vitória','Vila Velha','Serra','Cariacica','Nacional']
WHERE NOT EXISTS (SELECT 1 FROM public.edital_filter_settings);

-- 4. Atualizar prioridade das fontes existentes
UPDATE public.editais_fontes SET intervalo_horas = 12 WHERE slug = 'fapes';
