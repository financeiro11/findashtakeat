-- Estornos — conciliação Asaas × aba ESTORNOS da planilha de churn.
--
-- O QUE ESTA TELA RESPONDE: quanto do que o Asaas devolveu ao cliente é perda de
-- verdade. Nem todo estorno é churn — parte é cobrança que nunca deveria ter saído
-- (duplicidade, cobrança depois do cancelamento). Quem decide isso é o time, na
-- coluna "Motivo" da aba ESTORNOS. Daí a conta:
--
--     churn real (mês) = estornado no mês − o que o time marcou "Cobrança indevida"
--
-- DUAS ARMADILHAS QUE DEFINEM O DESENHO:
--
-- 1) ESTORNO PARCIAL NÃO TEM STATUS PRÓPRIO. A cobrança devolvida pela metade
--    continua RECEIVED/CONFIRMED no Asaas; o estorno só aparece no array `refunds`.
--    Filtrar `status=REFUNDED` (o caminho óbvio) perde todos eles — medido: 12
--    cobranças parciais no espelho, R$ 6.001 já devolvidos, nenhuma com status
--    REFUNDED. Por isso a linha desta tabela é o ESTORNO, não a cobrança: uma
--    cobrança pode ter mais de um.
--
-- 2) A DATA DO ESTORNO NÃO É A COMPETÊNCIA. O mês do painel é o do VENCIMENTO da
--    cobrança — é assim que a diretoria lê. Um estorno feito em abril pode ser de
--    uma cobrança que vence em julho (o Asaas cancela a parcela lá na frente), e
--    ele pertence a julho. Consequência: o casamento com a planilha varre a
--    planilha INTEIRA, sem recorte de mês, senão essa linha nunca se acha.

-- ---------------------------------------------------------------------------
-- 1) Espelho dos estornos do Asaas — uma linha por estorno
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estornos_asaas (
  id                text PRIMARY KEY,     -- "<id_pagamento>#<i>" — a cobrança pode ter vários
  id_pagamento      text NOT NULL,
  indice            smallint NOT NULL DEFAULT 0,

  cliente_id        text,
  cliente_nome      text,                 -- resolvido em /customers e cacheado
  cliente_documento text,
  descricao         text,                 -- descrição da cobrança ("Parcela 2 de 3. …")
  assinatura        text,

  forma             text,                 -- billingType
  status_cobranca   text,                 -- REFUNDED (total) | RECEIVED/CONFIRMED (parcial)
  status_estorno    text,                 -- DONE | PENDING | CANCELLED
  parcial           boolean NOT NULL DEFAULT false,

  valor_cobranca    numeric NOT NULL DEFAULT 0,
  valor_estornado   numeric NOT NULL DEFAULT 0,

  data_estorno      date,
  data_vencimento   date,                 -- dueDate — MANDA na competência
  data_pagamento    date,
  competencia       date,                 -- 1º dia do mês de data_vencimento

  invoice_url       text,                 -- https://www.asaas.com/i/<code> — chave do casamento
  comprovante_url   text,

  -- preenchidos pela conciliação (estornos-sync, ação "recalcular")
  linha_planilha    integer,
  casamento         text,                 -- 'link' | 'comprovante' | 'nome+valor' | 'nome' | null
  motivo            text,                 -- copiado da planilha, para a tela não ter que juntar
  cobranca_indevida boolean NOT NULL DEFAULT false,

  dados             jsonb,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estornos_asaas_competencia_idx ON public.estornos_asaas (competencia);
CREATE INDEX IF NOT EXISTS estornos_asaas_pagamento_idx   ON public.estornos_asaas (id_pagamento);
CREATE INDEX IF NOT EXISTS estornos_asaas_linha_idx       ON public.estornos_asaas (linha_planilha);

-- ---------------------------------------------------------------------------
-- 2) Espelho da aba ESTORNOS — é dela que vem a classificação
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estornos_planilha (
  linha             integer PRIMARY KEY,  -- nº da linha na aba (a mesma que se abre no Sheets)
  estabelecimento   text,
  setor             text,
  periodo           text,
  valor_pago        numeric,
  valor_estornar    numeric,
  data_pagamento    date,
  data_solicitacao  date,
  mes               integer,              -- coluna "Mês" da planilha (mês da solicitação)
  forma             text,
  status            text,                 -- CONCLUÍDO, …
  data_realizada    date,
  links             text[],               -- "Link do Comprovante do Estorno" (pode ter mais de um)
  motivo            text,
  cobranca_indevida boolean NOT NULL DEFAULT false,
  observacoes       text,
  responsavel       text,
  executor          text,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estornos_planilha_indevida_idx ON public.estornos_planilha (cobranca_indevida);

-- ---------------------------------------------------------------------------
-- 3) RLS — leitura para quem está logado; escrita só pela service role (a sync)
-- ---------------------------------------------------------------------------
ALTER TABLE public.estornos_asaas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estornos_planilha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estornos_asaas_select_auth    ON public.estornos_asaas;
DROP POLICY IF EXISTS estornos_planilha_select_auth ON public.estornos_planilha;

CREATE POLICY estornos_asaas_select_auth    ON public.estornos_asaas    FOR SELECT TO authenticated USING (true);
CREATE POLICY estornos_planilha_select_auth ON public.estornos_planilha FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 4) A série mensal — a conta do painel, somada no banco
-- ---------------------------------------------------------------------------
-- Somar no cliente seria um convite ao corte silencioso de 1.000 linhas do
-- PostgREST (são ~1.300 estornos e crescendo).
--
-- `p_pendentes` decide se o estorno que o Asaas ainda não concluiu entra na conta.
-- Estorno de cartão nasce PENDING e vira DONE em alguns dias; incluir antecipa o
-- número, excluir mantém o painel igual ao dinheiro que já saiu. O padrão é NÃO
-- incluir, e a tela mostra o pendente à parte para ninguém ser pego de surpresa.
CREATE OR REPLACE FUNCTION public.estornos_serie(p_pendentes boolean DEFAULT false)
RETURNS TABLE (
  competencia          date,
  qtd                  integer,
  qtd_parciais         integer,
  estornado            numeric,
  indevida             numeric,
  qtd_indevida         integer,
  churn_real           numeric,
  nao_classificado     numeric,
  qtd_nao_classificado integer,
  pendente             numeric,
  qtd_pendente         integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.competencia,
    count(*) FILTER (WHERE e.status_estorno = 'DONE' OR p_pendentes)::int                     AS qtd,
    count(*) FILTER (WHERE e.parcial AND (e.status_estorno = 'DONE' OR p_pendentes))::int     AS qtd_parciais,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.status_estorno = 'DONE' OR p_pendentes), 0)                          AS estornado,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS indevida,
    count(*) FILTER (WHERE e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes))::int                       AS qtd_indevida,
    coalesce(sum(e.valor_estornado) FILTER (WHERE NOT e.cobranca_indevida AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS churn_real,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.linha_planilha IS NULL AND (e.status_estorno = 'DONE' OR p_pendentes)), 0) AS nao_classificado,
    count(*) FILTER (WHERE e.linha_planilha IS NULL AND (e.status_estorno = 'DONE' OR p_pendentes))::int                  AS qtd_nao_classificado,
    coalesce(sum(e.valor_estornado) FILTER (WHERE e.status_estorno = 'PENDING'), 0)           AS pendente,
    count(*) FILTER (WHERE e.status_estorno = 'PENDING')::int                                 AS qtd_pendente
  FROM public.estornos_asaas e
  WHERE e.competencia IS NOT NULL
    AND e.status_estorno <> 'CANCELLED'
  GROUP BY e.competencia
  ORDER BY e.competencia;
$$;

-- Uma função nova em `public` nasce chamável por `anon` (o GRANT vem do papel PUBLIC).
-- Aqui não tem nada para um visitante ver.
REVOKE ALL ON FUNCTION public.estornos_serie(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.estornos_serie(boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Linhas da planilha que nenhum estorno do Asaas encontrou
-- ---------------------------------------------------------------------------
-- O outro lado da conferência: pedido registrado que o Asaas não mostra. Ou o
-- estorno saiu por fora (PIX, boleto — o Asaas não tem como saber), ou não foi
-- feito. Sem esta lista o painel só enxergaria metade do buraco.
CREATE OR REPLACE FUNCTION public.estornos_planilha_orfas()
RETURNS TABLE (
  linha            integer,
  estabelecimento  text,
  motivo           text,
  status           text,
  forma            text,
  valor_estornar   numeric,
  data_solicitacao date,
  mes              integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.linha, p.estabelecimento, p.motivo, p.status, p.forma,
         p.valor_estornar, p.data_solicitacao, p.mes
  FROM public.estornos_planilha p
  WHERE NOT EXISTS (SELECT 1 FROM public.estornos_asaas e WHERE e.linha_planilha = p.linha)
  ORDER BY p.data_solicitacao DESC NULLS LAST, p.linha DESC;
$$;

REVOKE ALL ON FUNCTION public.estornos_planilha_orfas() FROM anon;
GRANT EXECUTE ON FUNCTION public.estornos_planilha_orfas() TO authenticated, service_role;
