
-- Playbooks table
CREATE TABLE public.playbooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Rotinas internas',
  status TEXT NOT NULL DEFAULT 'Rascunho',
  owner_name TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived BOOLEAN NOT NULL DEFAULT false,
  last_edited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all playbooks" ON public.playbooks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_playbooks_updated_at
  BEFORE UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Playbook assets table
CREATE TABLE public.playbook_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playbook_id UUID NOT NULL REFERENCES public.playbooks(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playbook_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all playbook_assets" ON public.playbook_assets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('playbook-assets', 'playbook-assets', true);

CREATE POLICY "auth read playbook-assets" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'playbook-assets');
CREATE POLICY "public read playbook-assets" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'playbook-assets');
CREATE POLICY "auth upload playbook-assets" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'playbook-assets');
CREATE POLICY "auth update playbook-assets" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'playbook-assets');
CREATE POLICY "auth delete playbook-assets" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'playbook-assets');

-- Seed initial playbooks
INSERT INTO public.playbooks (title, description, category, status, owner_name, content) VALUES
('Fechamento mensal financeiro', 'Rotina geral de fechamento financeiro mensal da empresa.', 'Fechamento mensal', 'Rascunho', 'Júlia Rocon',
 '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Objetivo"}]},{"type":"paragraph","content":[{"type":"text","text":"Garantir que todas as movimentações financeiras do mês sejam registradas, conciliadas e validadas."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Checklist de fechamento"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Conferência de extratos bancários"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Validação no Omie"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Pontos de atenção revisados"}]}]}]}]}'::jsonb),
('Importação de extrato bancário para o Omie', 'Processo para importar lançamentos bancários no ERP Omie.', 'Importação para Omie', 'Publicado', 'Júlia Rocon',
 '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Arquivos necessários"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Extrato OFX/CSV do banco"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Planilha padrão Takeat"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Passo a passo"}]},{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Baixar extrato no internet banking"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Padronizar colunas"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Importar no Omie"}]}]}]}]}'::jsonb),
('Conferência de lançamentos de cartão de crédito', 'Processo de conferência e classificação dos lançamentos de cartão.', 'Cartão de crédito', 'Em revisão', 'Henrique Moura',
 '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Objetivo"}]},{"type":"paragraph","content":[{"type":"text","text":"Conferir e classificar todos os lançamentos do cartão corporativo."}]}]}'::jsonb),
('Captação e organização de editais', 'Rotina para monitorar, avaliar e organizar editais relevantes.', 'Editais', 'Rascunho', 'Júlia Rocon',
 '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Fontes de editais"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"FINEP"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"FAPES"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"BNDES"}]}]}]}]}'::jsonb);
