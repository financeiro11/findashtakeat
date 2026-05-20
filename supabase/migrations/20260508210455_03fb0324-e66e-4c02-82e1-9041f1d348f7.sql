
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Fontes
CREATE TABLE IF NOT EXISTS public.editais_fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'api',
  endpoint text,
  ativo boolean NOT NULL DEFAULT false,
  intervalo_horas integer NOT NULL DEFAULT 24,
  ultima_sync timestamptz,
  proxima_sync timestamptz DEFAULT now(),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.editais_fontes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all editais_fontes" ON public.editais_fontes FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_editais_fontes_updated_at BEFORE UPDATE ON public.editais_fontes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Logs
CREATE TABLE IF NOT EXISTS public.editais_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_slug text NOT NULL,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  duracao_ms integer,
  status text NOT NULL DEFAULT 'sucesso',
  capturados integer NOT NULL DEFAULT 0,
  novos integer NOT NULL DEFAULT 0,
  duplicados integer NOT NULL DEFAULT 0,
  descartados_filtro integer NOT NULL DEFAULT 0,
  erros jsonb DEFAULT '[]'::jsonb,
  mensagem text
);

ALTER TABLE public.editais_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all editais_sync_logs" ON public.editais_sync_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_sync_logs_iniciado ON public.editais_sync_logs(iniciado_em DESC);
CREATE INDEX idx_sync_logs_fonte ON public.editais_sync_logs(fonte_slug);

-- Editais dedupe fields
ALTER TABLE public.editais
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS hash_dedupe text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_editais_fonte_external ON public.editais(fonte, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_editais_hash_dedupe ON public.editais(hash_dedupe) WHERE hash_dedupe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_editais_status ON public.editais(status);
CREATE INDEX IF NOT EXISTS idx_editais_created ON public.editais(created_at DESC);

-- Realtime for editais
ALTER TABLE public.editais REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.editais;

-- Seed fontes
INSERT INTO public.editais_fontes (slug, nome, tipo, endpoint, ativo, intervalo_horas, config) VALUES
  ('pncp', 'PNCP - Portal Nacional de Contratações Públicas', 'api', 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta', true, 24, '{"keywords":["inovação","inteligência artificial","IA","foodtech","food service","SaaS","transformação digital","automação","analytics","startup","eficiência operacional","tecnologia"]}'::jsonb),
  ('finep', 'Finep', 'scraping', 'http://www.finep.gov.br/chamadas-publicas', false, 24, '{}'::jsonb),
  ('bndes', 'BNDES', 'scraping', 'https://www.bndes.gov.br/wps/portal/site/home/onde-atuamos/inovacao', false, 24, '{}'::jsonb),
  ('sebrae', 'Sebrae', 'scraping', 'https://www.sebrae.com.br/sites/PortalSebrae/editais', false, 24, '{}'::jsonb),
  ('embrapii', 'EMBRAPII', 'scraping', 'https://embrapii.org.br/chamadas-publicas/', false, 24, '{}'::jsonb),
  ('govbr', 'Gov.br', 'scraping', 'https://www.gov.br/pt-br/categorias/financiamento-e-credito', false, 24, '{}'::jsonb),
  ('inovativa', 'InovAtiva Brasil', 'scraping', 'https://www.inovativabrasil.com.br/', false, 24, '{}'::jsonb),
  ('fapes', 'FAPES', 'scraping', 'https://fapes.es.gov.br/editais', false, 24, '{}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
