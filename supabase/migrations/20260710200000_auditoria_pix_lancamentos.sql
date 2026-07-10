-- Lançamentos PIX (a auditar) puxados do Omie — já conciliados/categorizados pela
-- conciliação diária Sicoob → Omie. Espelha auditoria_cartao_lancamentos, mas a
-- origem é o movimento financeiro do Omie (não uma fatura de cartão).
--
-- Regras aplicadas na carga (Edge Function omie-pix-sync):
--   • só saídas (natureza "P") pagas via PIX;
--   • NÃO entram categorias de pessoal / premiação / escala / benefícios;
--   • se o movimento tem anexo no Omie, o link vem junto (tem_comprovante = true).

CREATE TABLE IF NOT EXISTS public.auditoria_pix_lancamentos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_unico        text NOT NULL UNIQUE,          -- nCodTitulo do Omie (estável entre syncs)
  referencia      text NOT NULL,                 -- "YYYY-MM" (competência do pagamento)
  data            date,                          -- data do pagamento
  valor           numeric NOT NULL DEFAULT 0,
  descricao       text,                          -- histórico / observação do movimento
  favorecido      text,                          -- cliente / fornecedor
  conta_corrente  text,                          -- conta bancária de origem (Sicoob)
  categoria_codigo text,                         -- cCodCateg do Omie
  categoria       text,                          -- descrição da categoria (plano de contas)
  tem_comprovante boolean NOT NULL DEFAULT false,
  comprovante_url text,                          -- link do anexo no Omie, quando houver
  anexo_nome      text,
  status          text NOT NULL DEFAULT 'Pendente', -- workflow de auditoria (editável no Hub)
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
