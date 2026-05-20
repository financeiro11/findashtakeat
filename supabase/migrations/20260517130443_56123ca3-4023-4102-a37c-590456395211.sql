
-- Departamentos
CREATE TABLE public.lib_departamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  descricao text,
  gestor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cargos
CREATE TABLE public.lib_cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Centros de custo
CREATE TABLE public.lib_centros_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text UNIQUE,
  nome text NOT NULL,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Colaboradores
CREATE TABLE public.lib_colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text,
  telefone text,
  cargo_id uuid REFERENCES public.lib_cargos(id) ON DELETE SET NULL,
  departamento_id uuid REFERENCES public.lib_departamentos(id) ON DELETE SET NULL,
  gestor_id uuid REFERENCES public.lib_colaboradores(id) ON DELETE SET NULL,
  centro_custo_id uuid REFERENCES public.lib_centros_custo(id) ON DELETE SET NULL,
  data_admissao date,
  status text NOT NULL DEFAULT 'ativo',
  tags text[] NOT NULL DEFAULT '{}',
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lib_colaboradores_nome ON public.lib_colaboradores (lower(nome));

ALTER TABLE public.lib_departamentos
  ADD CONSTRAINT lib_departamentos_gestor_fk FOREIGN KEY (gestor_id) REFERENCES public.lib_colaboradores(id) ON DELETE SET NULL;

-- Fornecedores
CREATE TABLE public.lib_fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  documento text,
  categoria text,
  contato_nome text,
  contato_email text,
  contato_telefone text,
  status text NOT NULL DEFAULT 'ativo',
  tags text[] NOT NULL DEFAULT '{}',
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Políticas / regras operacionais
CREATE TABLE public.lib_politicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  categoria text,
  conteudo text NOT NULL,
  aplica_a text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Triggers updated_at
CREATE TRIGGER trg_lib_departamentos_updated BEFORE UPDATE ON public.lib_departamentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lib_cargos_updated BEFORE UPDATE ON public.lib_cargos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lib_centros_custo_updated BEFORE UPDATE ON public.lib_centros_custo FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lib_colaboradores_updated BEFORE UPDATE ON public.lib_colaboradores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lib_fornecedores_updated BEFORE UPDATE ON public.lib_fornecedores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lib_politicas_updated BEFORE UPDATE ON public.lib_politicas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.lib_departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lib_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lib_centros_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lib_colaboradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lib_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lib_politicas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all lib_departamentos" ON public.lib_departamentos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all lib_cargos" ON public.lib_cargos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all lib_centros_custo" ON public.lib_centros_custo FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all lib_colaboradores" ON public.lib_colaboradores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all lib_fornecedores" ON public.lib_fornecedores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all lib_politicas" ON public.lib_politicas FOR ALL TO authenticated USING (true) WITH CHECK (true);
