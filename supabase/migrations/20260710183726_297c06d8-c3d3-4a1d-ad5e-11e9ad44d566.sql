CREATE TABLE IF NOT EXISTS public.auditoria_pix_lancamentos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_unico        text NOT NULL UNIQUE,
  referencia      text NOT NULL,
  data            date,
  valor           numeric NOT NULL DEFAULT 0,
  descricao       text,
  favorecido      text,
  conta_corrente  text,
  categoria_codigo text,
  categoria       text,
  tem_comprovante boolean NOT NULL DEFAULT false,
  comprovante_url text,
  anexo_nome      text,
  status          text NOT NULL DEFAULT 'Pendente',
  observacao      text,
  gerado_em       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_pix_referencia ON public.auditoria_pix_lancamentos (referencia);
CREATE INDEX IF NOT EXISTS idx_auditoria_pix_status     ON public.auditoria_pix_lancamentos (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_pix_lancamentos TO authenticated;
GRANT ALL ON public.auditoria_pix_lancamentos TO service_role;

ALTER TABLE public.auditoria_pix_lancamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read auditoria_pix"
  ON public.auditoria_pix_lancamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update auditoria_pix"
  ON public.auditoria_pix_lancamentos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can insert auditoria_pix"
  ON public.auditoria_pix_lancamentos FOR INSERT TO authenticated WITH CHECK (true);