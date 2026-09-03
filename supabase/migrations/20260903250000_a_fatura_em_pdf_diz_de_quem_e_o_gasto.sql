-- O PDF da fatura do Sicoob é a única fonte que diz DE QUEM é cada gasto.
--
-- O .ofx vem consolidado (um `ACCTID`, nenhuma coluna de portador), e por isso a fatura
-- do líder só mostrava o que a analista tinha rateado à mão — 201 linhas com dono de 640
-- em ago/26. Deduzir pelo lojista foi medido em 03/09/2026 e erra demais: treinando em
-- junho e testando contra a verdade de agosto, 45% de acerto na regra frouxa e 71% na
-- mais conservadora. O PDF traz os blocos por portador, impressos.
--
-- Ler um PDF de 30 páginas não cabe nos 150s até a primeira resposta (o teto do gateway
-- em qualquer plano), então a leitura vira TAREFA: a função responde na hora com o id e
-- segue em `EdgeRuntime.waitUntil`. Esta tabela é onde o resultado espera quem perguntar.
CREATE TABLE IF NOT EXISTS public.cartao_fatura_rateio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia   date NOT NULL,
  arquivo       text,
  drive_id      text,
  -- rodando → pronto | erro. Sem 'cancelado': quem desistiu simplesmente não lê.
  status        text NOT NULL DEFAULT 'rodando',
  gravar        boolean NOT NULL DEFAULT false,
  resultado     jsonb,
  erro          text,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  terminado_em  timestamptz
);

CREATE INDEX IF NOT EXISTS cartao_fatura_rateio_comp_idx
  ON public.cartao_fatura_rateio (competencia, criado_em DESC);

ALTER TABLE public.cartao_fatura_rateio ENABLE ROW LEVEL SECURITY;

-- Quem está logado no Hub lê; escrever é só da função (service role, que ignora RLS).
-- `anon` não entra: o resultado lista nome de portador e gasto de todo mundo.
DROP POLICY IF EXISTS "hub le o rateio" ON public.cartao_fatura_rateio;
CREATE POLICY "hub le o rateio" ON public.cartao_fatura_rateio
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.cartao_fatura_rateio FROM anon;
GRANT SELECT ON public.cartao_fatura_rateio TO authenticated;

-- `A CLASSIFICAR` é o status das linhas que o PDF trouxe e o financeiro ainda não olhou.
-- Ele NÃO é cobrança: carimbar "SEM NF" em 400 linhas de uma vez viraria uma cobrança em
-- massa que ninguém pediu. A fatura do líder mostra a linha, deixa anexar e contestar, e
-- não a conta em "Falta você" — quem decide o que vira cobrança continua sendo a análise.
COMMENT ON COLUMN public.auditoria_cartao_lancamentos.status_nf IS
  'OK | SEM NF | ENCARGO | DISPENSADO (<piso) | SEM NF-ESPERADO | PARCELA (origem) | '
  'CONFERIR (passagem/hosp.) | OK (conferir) | A CLASSIFICAR (veio do PDF, ainda não analisada)';
