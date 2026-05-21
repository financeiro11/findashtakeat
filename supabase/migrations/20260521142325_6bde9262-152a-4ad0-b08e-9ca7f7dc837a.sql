CREATE TABLE public.playbook_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Novo fluxo',
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Rotinas internas',
  status TEXT NOT NULL DEFAULT 'Rascunho',
  owner_name TEXT,
  playbook_id UUID,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  archived BOOLEAN NOT NULL DEFAULT false,
  last_edited_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.playbook_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all playbook_flows"
ON public.playbook_flows
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_playbook_flows_updated_at
BEFORE UPDATE ON public.playbook_flows
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_playbook_flows_updated_at ON public.playbook_flows (updated_at DESC);
CREATE INDEX idx_playbook_flows_playbook_id ON public.playbook_flows (playbook_id);