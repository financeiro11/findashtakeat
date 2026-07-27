-- Sicoob — Conta Corrente (seção da aba Caixa do Hub).
-- Os dados são gravados por uma automação externa (n8n) que consome a API do Sicoob;
-- o frontend apenas LÊ dessas tabelas (nunca chama o Sicoob nem escreve).
-- A escrita é feita pela automação com a service_role (que ignora RLS); por isso não
-- há policy de INSERT — só leitura para usuários autenticados.

-- 1) Extrato de lançamentos (idempotente por id_transacao).
CREATE TABLE IF NOT EXISTS public.sicoob_extrato (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_transacao          text NOT NULL,                 -- dedup: evita duplicar no re-sync
  data_movimento        date,
  tipo                  text,                           -- 'credito' | 'debito'
  valor                 numeric,                        -- sempre positivo; o sinal vem de "tipo"
  historico             text,
  contraparte_nome      text,
  contraparte_documento text,
  numero_documento      text,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

-- Constraint UNIQUE obrigatória: a automação depende dela (ON CONFLICT) para não duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS sicoob_extrato_id_transacao_key ON public.sicoob_extrato (id_transacao);
-- Ordenação padrão da tabela: data_movimento desc.
CREATE INDEX IF NOT EXISTS sicoob_extrato_data_movimento_idx ON public.sicoob_extrato (data_movimento DESC);

-- 2) Saldo (append-only: uma linha/snapshot por sincronização; o saldo atual é o maior atualizado_em).
CREATE TABLE IF NOT EXISTS public.sicoob_saldo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta             text,
  saldo             numeric,
  saldo_disponivel  numeric,
  saldo_bloqueado   numeric,
  atualizado_em     timestamptz
);

CREATE INDEX IF NOT EXISTS sicoob_saldo_atualizado_em_idx ON public.sicoob_saldo (atualizado_em DESC);

-- Leitura para o app (authenticated); escrita só via service_role (automação n8n).
GRANT SELECT ON public.sicoob_extrato TO authenticated;
GRANT ALL    ON public.sicoob_extrato TO service_role;
GRANT SELECT ON public.sicoob_saldo   TO authenticated;
GRANT ALL    ON public.sicoob_saldo   TO service_role;

ALTER TABLE public.sicoob_extrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sicoob_saldo   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_sicoob_extrato" ON public.sicoob_extrato;
CREATE POLICY "auth_read_sicoob_extrato" ON public.sicoob_extrato FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_sicoob_saldo" ON public.sicoob_saldo;
CREATE POLICY "auth_read_sicoob_saldo" ON public.sicoob_saldo FOR SELECT TO authenticated USING (true);
