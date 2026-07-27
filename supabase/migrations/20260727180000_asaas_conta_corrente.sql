-- Asaas — Conta Corrente (aba do seletor Sicoob/Asaas na área Caixa do Hub).
-- Espelha o modelo do Sicoob: os dados são gravados por uma automação externa (n8n)
-- que consome a API do Asaas; o frontend apenas LÊ (nunca escreve). A automação grava
-- com service_role (ignora RLS), então não há policy de INSERT — só leitura autenticada.

-- 1) Extrato de lançamentos (idempotente por id_transacao).
CREATE TABLE IF NOT EXISTS public.asaas_extrato (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_transacao          text NOT NULL,
  data_movimento        date,
  tipo                  text,                           -- 'credito' | 'debito'
  valor                 numeric,                        -- sempre positivo; sinal vem de "tipo"
  historico             text,
  contraparte_nome      text,
  contraparte_documento text,
  numero_documento      text,
  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asaas_extrato_id_transacao_key ON public.asaas_extrato (id_transacao);
CREATE INDEX IF NOT EXISTS asaas_extrato_data_movimento_idx ON public.asaas_extrato (data_movimento DESC);

-- 2) Saldo (append-only: uma linha/snapshot por sync; saldo atual = maior atualizado_em).
CREATE TABLE IF NOT EXISTS public.asaas_saldo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta             text,
  saldo             numeric,
  saldo_disponivel  numeric,
  saldo_bloqueado   numeric,
  atualizado_em     timestamptz
);

CREATE INDEX IF NOT EXISTS asaas_saldo_atualizado_em_idx ON public.asaas_saldo (atualizado_em DESC);

GRANT SELECT ON public.asaas_extrato TO authenticated;
GRANT ALL    ON public.asaas_extrato TO service_role;
GRANT SELECT ON public.asaas_saldo   TO authenticated;
GRANT ALL    ON public.asaas_saldo   TO service_role;

ALTER TABLE public.asaas_extrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_saldo   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_asaas_extrato" ON public.asaas_extrato;
CREATE POLICY "auth_read_asaas_extrato" ON public.asaas_extrato FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_asaas_saldo" ON public.asaas_saldo;
CREATE POLICY "auth_read_asaas_saldo" ON public.asaas_saldo FOR SELECT TO authenticated USING (true);
