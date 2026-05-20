
CREATE TABLE public.bp_anual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ano integer NOT NULL UNIQUE,
  dados jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bp_anual ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all bp" ON public.bp_anual FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER bp_anual_upd BEFORE UPDATE ON public.bp_anual FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.base_conhecimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  conteudo text NOT NULL,
  tipo text NOT NULL DEFAULT 'nota',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.base_conhecimento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all bk" ON public.base_conhecimento FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER bk_upd BEFORE UPDATE ON public.base_conhecimento FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.cenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  periodo_base text,
  meses_projecao integer NOT NULL DEFAULT 12,
  premissas jsonb NOT NULL DEFAULT '{}'::jsonb,
  projecao jsonb,
  sensibilidade jsonb,
  analise text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all cen" ON public.cenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER cen_upd BEFORE UPDATE ON public.cenarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
