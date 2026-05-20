
ALTER TABLE public.editais
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS fonte text,
  ADD COLUMN IF NOT EXISTS resumo_ia text,
  ADD COLUMN IF NOT EXISTS regiao text,
  ADD COLUMN IF NOT EXISTS match_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS documentos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS riscos text,
  ADD COLUMN IF NOT EXISTS proximos_passos text,
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'Encontrado',
  ADD COLUMN IF NOT EXISTS prioridade text NOT NULL DEFAULT 'Média',
  ADD COLUMN IF NOT EXISTS data_captura timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS criterios_elegibilidade text;

CREATE INDEX IF NOT EXISTS idx_editais_pipeline_stage ON public.editais(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_editais_status ON public.editais(status);
CREATE INDEX IF NOT EXISTS idx_editais_prazo_envio ON public.editais(prazo_envio);
