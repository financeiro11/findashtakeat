
CREATE TABLE public.parceiros_indicacoes_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  indicacao_id uuid,
  id_negocio text,
  snapshot jsonb,
  user_id uuid,
  user_email text,
  user_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.parceiros_indicacoes_audit TO authenticated;
GRANT ALL ON public.parceiros_indicacoes_audit TO service_role;

ALTER TABLE public.parceiros_indicacoes_audit ENABLE ROW LEVEL SECURITY;

-- Somente Victor Brittes lê a auditoria.
CREATE POLICY "victor_read_audit" ON public.parceiros_indicacoes_audit
  FOR SELECT TO authenticated
  USING (auth.uid() = 'a32c1044-9637-4a62-8dfe-205c4b660e79'::uuid);

-- Qualquer usuário autenticado registra suas próprias ações (mas só Victor tem UI para apagar).
CREATE POLICY "insert_own_audit" ON public.parceiros_indicacoes_audit
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX parceiros_indicacoes_audit_created_idx ON public.parceiros_indicacoes_audit (created_at DESC);
