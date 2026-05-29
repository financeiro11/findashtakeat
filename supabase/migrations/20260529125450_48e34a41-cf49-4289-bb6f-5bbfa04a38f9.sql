
-- Projetos aprovados (cabeçalho)
CREATE TABLE public.projetos_aprovados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  orgao TEXT,
  valor_aprovado NUMERIC NOT NULL DEFAULT 0,
  valor_contrapartida NUMERIC NOT NULL DEFAULT 0,
  data_inicio DATE,
  duracao_meses INTEGER,
  prazo_final DATE,
  status TEXT NOT NULL DEFAULT 'Em execução',
  observacao TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_aprovados TO authenticated;
GRANT ALL ON public.projetos_aprovados TO service_role;
ALTER TABLE public.projetos_aprovados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all projetos_aprovados" ON public.projetos_aprovados FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER projetos_aprovados_updated BEFORE UPDATE ON public.projetos_aprovados
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Rubricas (categorias de despesa por projeto, com hierarquia)
CREATE TABLE public.projetos_aprovados_rubricas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id UUID NOT NULL REFERENCES public.projetos_aprovados(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.projetos_aprovados_rubricas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  valor_planejado NUMERIC NOT NULL DEFAULT 0,
  obrigatorio BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_aprovados_rubricas TO authenticated;
GRANT ALL ON public.projetos_aprovados_rubricas TO service_role;
ALTER TABLE public.projetos_aprovados_rubricas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all projetos_aprovados_rubricas" ON public.projetos_aprovados_rubricas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_pa_rubricas_projeto ON public.projetos_aprovados_rubricas(projeto_id);
CREATE TRIGGER pa_rubricas_updated BEFORE UPDATE ON public.projetos_aprovados_rubricas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Parcelas do edital (1ª, 2ª, 3ª etc.)
CREATE TABLE public.projetos_aprovados_parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id UUID NOT NULL REFERENCES public.projetos_aprovados(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  descricao TEXT,
  valor NUMERIC NOT NULL DEFAULT 0,
  recebido BOOLEAN NOT NULL DEFAULT false,
  data_prevista DATE,
  data_recebimento DATE,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_aprovados_parcelas TO authenticated;
GRANT ALL ON public.projetos_aprovados_parcelas TO service_role;
ALTER TABLE public.projetos_aprovados_parcelas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all projetos_aprovados_parcelas" ON public.projetos_aprovados_parcelas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_pa_parcelas_projeto ON public.projetos_aprovados_parcelas(projeto_id);
CREATE TRIGGER pa_parcelas_updated BEFORE UPDATE ON public.projetos_aprovados_parcelas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Compras / despesas (abatem do valor planejado da rubrica)
CREATE TABLE public.projetos_aprovados_compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id UUID NOT NULL REFERENCES public.projetos_aprovados(id) ON DELETE CASCADE,
  rubrica_id UUID NOT NULL REFERENCES public.projetos_aprovados_rubricas(id) ON DELETE RESTRICT,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  descricao TEXT NOT NULL,
  fornecedor TEXT,
  valor NUMERIC NOT NULL DEFAULT 0,
  nf_numero TEXT,
  nf_anexada BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'Confirmada',
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_aprovados_compras TO authenticated;
GRANT ALL ON public.projetos_aprovados_compras TO service_role;
ALTER TABLE public.projetos_aprovados_compras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all projetos_aprovados_compras" ON public.projetos_aprovados_compras FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_pa_compras_projeto ON public.projetos_aprovados_compras(projeto_id);
CREATE INDEX idx_pa_compras_rubrica ON public.projetos_aprovados_compras(rubrica_id);
CREATE TRIGGER pa_compras_updated BEFORE UPDATE ON public.projetos_aprovados_compras
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: Tecnova III com base na planilha enviada
WITH p AS (
  INSERT INTO public.projetos_aprovados (nome, orgao, valor_aprovado, valor_contrapartida, data_inicio, duracao_meses, prazo_final, status, ordem)
  VALUES ('Tecnova III', 'FAPES / FINEP', 494800.02, 24740.00, '2025-05-02', 24, '2027-05-31', 'Em execução', 0)
  RETURNING id
),
mc AS (
  INSERT INTO public.projetos_aprovados_rubricas (projeto_id, categoria, valor_planejado, ordem)
  SELECT id, 'Material de Consumo', 276000.00, 1 FROM p RETURNING id, projeto_id
),
ost AS (
  INSERT INTO public.projetos_aprovados_rubricas (projeto_id, categoria, valor_planejado, ordem)
  SELECT id, 'Outros Serviços de Terceiros', 164800.00, 2 FROM p RETURNING id, projeto_id
),
sub AS (
  INSERT INTO public.projetos_aprovados_rubricas (projeto_id, parent_id, categoria, valor_planejado, obrigatorio, ordem)
  SELECT ost.projeto_id, ost.id, c.categoria, c.valor, c.obrig, c.ord FROM ost,
    (VALUES
      ('Gasto mais "livre"', 69600.00::numeric, false, 1),
      ('Aceleração - obrigatório', 70000.00::numeric, true, 2),
      ('Internacionalização - obrigatório', 25200.00::numeric, true, 3)
    ) AS c(categoria, valor, obrig, ord)
  RETURNING id
),
outras AS (
  INSERT INTO public.projetos_aprovados_rubricas (projeto_id, categoria, valor_planejado, ordem)
  SELECT p.id, c.categoria, c.valor, c.ord FROM p,
    (VALUES
      ('Diárias', 0.01::numeric, 3),
      ('Equipamentos e Material Permanente', 54000.00::numeric, 4),
      ('Passagens', 0.01::numeric, 5)
    ) AS c(categoria, valor, ord)
  RETURNING id
)
INSERT INTO public.projetos_aprovados_parcelas (projeto_id, numero, descricao, valor, recebido)
SELECT p.id, x.numero, x.descricao, x.valor, x.recebido FROM p,
  (VALUES
    (1, '1ª Parcela do edital (FUNDACAO SUBVENCAO 72.100 + FAPES FINEP 180.248)', 252348.00::numeric, true),
    (2, '2ª Parcela do edital - Gastar Aceleração e Internacionalização (trilha Básica)', 0::numeric, false),
    (3, '3ª Parcela do edital - Gastar Internacionalização (trilha avançada)', 0::numeric, false)
  ) AS x(numero, descricao, valor, recebido);
