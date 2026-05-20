
-- 1. Add verificado column to recargas_celulares
ALTER TABLE public.recargas_celulares
ADD COLUMN IF NOT EXISTS verificado text DEFAULT 'Não';

-- 2. Projetos table
CREATE TABLE IF NOT EXISTS public.projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem integer NOT NULL DEFAULT 0,
  automacao text NOT NULL,
  responsavel text,
  status text NOT NULL DEFAULT 'A fazer',
  descricao_entrega text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth all projetos" ON public.projetos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_projetos_updated_at
BEFORE UPDATE ON public.projetos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.projetos (ordem, automacao, responsavel, status, descricao_entrega) VALUES
  (1, 'BretA', 'Julia', 'Concluido', 'Aprovação no edital BretA'),
  (2, 'Remessa Pagamento', 'Julia', 'Em andamento', 'Implementação da remessa de pagamentos em lote'),
  (3, 'DashboaRd', 'Julia', 'Em andamento', 'Dash Financeiro com as principais metricas, dentro do Takeat OPS'),
  (4, 'Auditórias', 'Julia', 'A fazer', 'Auditorias de times, mais controle orçamentario e financeiro atuando em governancia');

-- 3. Demonstrações contábeis (DRE, Balancete, Balanço)
CREATE TABLE IF NOT EXISTS public.demonstracoes_contabeis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('dre','balancete','balanco')),
  periodo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, periodo)
);
ALTER TABLE public.demonstracoes_contabeis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth all dem" ON public.demonstracoes_contabeis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_dem_updated_at
BEFORE UPDATE ON public.demonstracoes_contabeis
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
