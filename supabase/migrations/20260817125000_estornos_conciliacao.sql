-- Estornos — o casamento Asaas × aba ESTORNOS e a regra que decide o que sai do churn.
--
-- Estado final da conciliação. No banco isto foi aplicado em quatro passos
-- (estornos_conciliacao, estornos_conciliacao_nome_limpo, estornos_regra_da_skill,
-- estornos_motivo_descarta_nulo); aqui vai consolidado, porque `create or replace`
-- deixaria os corpos antigos apenas na história e não no banco — e é o banco que este
-- arquivo precisa reproduzir.
--
-- POR QUE A CONTA MORA NO SQL E NÃO NA EDGE FUNCTION: são ~1.400 estornos × 222 linhas
-- da planilha e o casamento é um join. Em SQL é uma passada; em JS seriam 300 mil
-- comparações puxadas pela rede. E, principalmente, a regra fica calibrável por
-- migration — mexer no limiar ou na lista de motivos não pede deploy da função.
--
-- A REGRA É A DA SKILL "Churn Real — Takeat", que era rodada à mão todo mês e é de
-- onde vêm os números que a diretoria já viu. Três pontos dela que não são intuitivos:
--
--   1. O descarte tem DOIS motivos: "Cobrança indevida" e "Erro de pagamento". Hoje a
--      aba só usa o primeiro (o segundo ainda vai entrar no dropdown), então nada muda
--      agora — mas sem isto, no dia em que alguém escolhesse o motivo novo o painel
--      passaria a contar como churn algo que a skill descartava, calado.
--
--   2. O descarte é POR ESTABELECIMENTO, não por estorno: "basta uma [linha] estar
--      classificada como descarte para que todos os estornos dele no Asaas saiam do
--      churn real". Um estorno casado com a linha "Erro Processo - Comercial" de um
--      cliente que TAMBÉM tem uma linha "Cobrança indevida" sai do churn.
--
--   3. O casamento de última instância é SÓ POR NOME, sem data e sem valor — e isso
--      não é descuido. Medido: "Biscoitando Fortaleza" tem 8 parcelas estornadas no
--      mesmo dia, com vencimentos espalhados por 8 meses, e o pedido na planilha
--      datado 8 meses DEPOIS do estorno. Qualquer trava de data derruba o par. Também
--      não dá para casar por valor: o Asaas mostra a parcela, a planilha o total.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ---------------------------------------------------------------------------
-- Normalização
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estornos_chave(t text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent(t)), '[^a-z0-9]+', ' ', 'g'));
$$;

-- O nome do cliente no Asaas carrega o carimbo do cancelamento: "Relax Food [CANCELADO
-- 04/26]". A planilha escreve "Relax Food". Comparar os dois crus derruba a semelhança
-- de trigramas o suficiente para o par não passar do limiar — era daí que vinham as
-- linhas de cartão que não achavam estorno nenhum, mesmo com o cliente ali na lista.
CREATE OR REPLACE FUNCTION public.estornos_nome(t text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT public.estornos_chave(regexp_replace(coalesce(t, ''), '\[[^]]*\]|\([^)]*\)', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Os motivos que tiram o estorno do churn
-- ---------------------------------------------------------------------------
-- CUIDADO AO MEXER: "Erro Processo - Comercial" e "Erro no processo - …" (13 linhas na
-- aba) são churn real. É por isso que a regra casa pelo COMEÇO do motivo e não por
-- "contém erro". `coalesce` porque `estornos_chave` é STRICT e a coluna é NOT NULL:
-- com motivo nulo isto devolvia NULL e a gravação estourava. Linha sem motivo não é
-- descarte — é churn real, como manda a skill para tudo que não está classificado.
CREATE OR REPLACE FUNCTION public.estornos_motivo_descarta(t text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT public.estornos_chave(coalesce(t, '')) LIKE 'cobranca indevida%'
      OR public.estornos_chave(coalesce(t, '')) LIKE 'erro de pagamento%';
$$;

ALTER TABLE public.estornos_asaas
  ADD COLUMN IF NOT EXISTS descarte_origem text;  -- 'linha' | 'estabelecimento' | null

COMMENT ON COLUMN public.estornos_asaas.descarte_origem IS
  '''linha'' = a linha casada tem motivo de descarte; ''estabelecimento'' = a linha casada NÃO tem, mas outra linha do mesmo estabelecimento tem (regra da skill).';

-- ---------------------------------------------------------------------------
-- A conciliação
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estornos_conciliar()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  resumo jsonb;
BEGIN
  DROP TABLE IF EXISTS _links;   DROP TABLE IF EXISTS _fatura;
  DROP TABLE IF EXISTS _comprov; DROP TABLE IF EXISTS _m;
  DROP TABLE IF EXISTS _lote;    DROP TABLE IF EXISTS _estab;

  -- A lista de motivos de descarte vale a partir daqui, e não do que a edge function
  -- gravou: assim ela mora num lugar só e muda por migration, sem reimplantar nada.
  UPDATE public.estornos_planilha
     SET cobranca_indevida = public.estornos_motivo_descarta(motivo)
   WHERE cobranca_indevida IS DISTINCT FROM public.estornos_motivo_descarta(motivo);

  CREATE TEMP TABLE _links ON COMMIT DROP AS
    SELECT p.linha, lower(l) AS link
    FROM public.estornos_planilha p, unnest(coalesce(p.links, '{}')) l;

  CREATE TEMP TABLE _fatura ON COMMIT DROP AS
    SELECT DISTINCT ON (cod) cod, linha FROM (
      SELECT (regexp_match(link, 'asaas\.com/i/([a-z0-9]+)'))[1] AS cod, linha
      FROM _links WHERE link ~ 'asaas\.com/i/'
    ) x WHERE cod IS NOT NULL ORDER BY cod, linha;

  CREATE TEMP TABLE _comprov ON COMMIT DROP AS
    SELECT DISTINCT ON (cod) cod, linha FROM (
      SELECT (regexp_match(link, 'asaas\.com/comprovantes/([a-z0-9%=_-]+)'))[1] AS cod, linha
      FROM _links WHERE link ~ 'asaas\.com/comprovantes/'
    ) x WHERE cod IS NOT NULL ORDER BY cod, linha;

  -- Um estabelecimento = várias linhas. A linha de DESCARTE ganha a preferência, para
  -- a classificação exibida ser a mesma que a skill daria.
  CREATE TEMP TABLE _estab ON COMMIT DROP AS
    SELECT DISTINCT ON (chave) chave, linha, descarta FROM (
      SELECT nullif(public.estornos_nome(p.estabelecimento), '') AS chave,
             p.linha, p.cobranca_indevida AS descarta, p.data_solicitacao
      FROM public.estornos_planilha p
      WHERE nullif(public.estornos_nome(p.estabelecimento), '') IS NOT NULL
    ) x ORDER BY chave, descarta DESC, data_solicitacao DESC NULLS LAST, linha DESC;

  CREATE TEMP TABLE _m (id text PRIMARY KEY, linha integer, como text) ON COMMIT DROP;

  -- 1) link da fatura — o casamento exato: o código de /i/<code> é o id da cobrança.
  INSERT INTO _m (id, linha, como)
  SELECT e.id, f.linha, 'link'
  FROM public.estornos_asaas e
  JOIN _fatura f
    ON f.cod = coalesce((regexp_match(lower(coalesce(e.invoice_url, '')), 'asaas\.com/i/([a-z0-9]+)'))[1],
                        lower(regexp_replace(e.id_pagamento, '^pay_', '')))
  ON CONFLICT (id) DO NOTHING;

  -- 2) link do comprovante do estorno
  INSERT INTO _m (id, linha, como)
  SELECT e.id, c.linha, 'comprovante'
  FROM public.estornos_asaas e
  JOIN _comprov c
    ON c.cod = (regexp_match(lower(coalesce(e.comprovante_url, '')), 'asaas\.com/comprovantes/([a-z0-9%=_-]+)'))[1]
  WHERE NOT EXISTS (SELECT 1 FROM _m m WHERE m.id = e.id)
  ON CONFLICT (id) DO NOTHING;

  -- 3) nome parecido + valor ou data próxima — só para linha que o link não resolveu.
  INSERT INTO _m (id, linha, como)
  SELECT DISTINCT ON (c.id) c.id, c.linha, CASE WHEN c.bate_valor THEN 'nome+valor' ELSE 'nome' END
  FROM (
    SELECT e.id, p.linha,
           ((p.valor_estornar IS NOT NULL AND abs(p.valor_estornar - e.valor_estornado) <= 0.05)
             OR (p.valor_pago IS NOT NULL AND abs(p.valor_pago - e.valor_cobranca) <= 0.05)) AS bate_valor,
           public.similarity(public.estornos_nome(e.cliente_nome), public.estornos_nome(p.estabelecimento)) AS sim
    FROM public.estornos_asaas e
    JOIN public.estornos_planilha p
      ON coalesce(p.estabelecimento, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM _m m2 JOIN public.estornos_asaas e2 ON e2.id = m2.id
                     WHERE m2.linha = p.linha AND m2.como IN ('link', 'comprovante'))
     AND public.similarity(public.estornos_nome(e.cliente_nome), public.estornos_nome(p.estabelecimento)) >= 0.62
    WHERE e.cliente_nome IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _m m WHERE m.id = e.id)
      AND ((p.valor_estornar IS NOT NULL AND abs(p.valor_estornar - e.valor_estornado) <= 0.05)
        OR (p.valor_pago IS NOT NULL AND abs(p.valor_pago - e.valor_cobranca) <= 0.05)
        OR (p.data_solicitacao IS NOT NULL AND e.data_estorno IS NOT NULL
            AND abs(e.data_estorno - p.data_solicitacao) <= 60))
  ) c
  ORDER BY c.id, c.bate_valor DESC, c.sim DESC, c.linha
  ON CONFLICT (id) DO NOTHING;

  -- 4) irmãos do mesmo lote — o cancelamento de um plano anual devolve as parcelas
  --    restantes de uma vez, no mesmo segundo, e o pedido registrado é um só.
  CREATE TEMP TABLE _lote ON COMMIT DROP AS
    SELECT DISTINCT ON (e.cliente_id, e.data_estorno) e.cliente_id, e.data_estorno, m.linha
    FROM _m m JOIN public.estornos_asaas e ON e.id = m.id
    WHERE e.cliente_id IS NOT NULL AND e.data_estorno IS NOT NULL
    ORDER BY e.cliente_id, e.data_estorno, m.linha;

  INSERT INTO _m (id, linha, como)
  SELECT e.id, l.linha, 'lote'
  FROM public.estornos_asaas e
  JOIN _lote l ON l.cliente_id = e.cliente_id AND l.data_estorno = e.data_estorno
  WHERE NOT EXISTS (SELECT 1 FROM _m m WHERE m.id = e.id)
  ON CONFLICT (id) DO NOTHING;

  -- 5) nome do estabelecimento, sem data e sem valor — a regra da skill, por último
  --    porque é a mais fraca. Sozinha ela responde por 41 estornos que nenhuma das
  --    outras achava.
  INSERT INTO _m (id, linha, como)
  SELECT e.id, x.linha, 'estabelecimento'
  FROM public.estornos_asaas e
  JOIN _estab x ON x.chave = public.estornos_nome(e.cliente_nome)
  WHERE e.cliente_nome IS NOT NULL
    AND nullif(public.estornos_nome(e.cliente_nome), '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM _m m WHERE m.id = e.id)
  ON CONFLICT (id) DO NOTHING;

  -- Grava o vínculo e a classificação.
  UPDATE public.estornos_asaas e
  SET linha_planilha = m.linha,
      casamento = m.como,
      motivo = p.motivo,
      cobranca_indevida = coalesce(p.cobranca_indevida, false),
      descarte_origem = CASE WHEN p.cobranca_indevida THEN 'linha' END
  FROM _m m
  JOIN public.estornos_planilha p ON p.linha = m.linha
  WHERE e.id = m.id;

  UPDATE public.estornos_asaas e
  SET linha_planilha = NULL, casamento = NULL, motivo = NULL,
      cobranca_indevida = false, descarte_origem = NULL
  WHERE NOT EXISTS (SELECT 1 FROM _m m WHERE m.id = e.id)
    AND (e.linha_planilha IS NOT NULL OR e.casamento IS NOT NULL
         OR e.cobranca_indevida OR e.descarte_origem IS NOT NULL);

  -- A regra do estabelecimento: uma linha de descarte tira TODOS os estornos daquele
  -- cliente do churn, mesmo os que casaram com outra linha dele.
  UPDATE public.estornos_asaas e
  SET cobranca_indevida = true, descarte_origem = 'estabelecimento'
  FROM _estab x
  WHERE x.chave = public.estornos_nome(e.cliente_nome)
    AND x.descarta
    AND NOT e.cobranca_indevida;

  SELECT jsonb_build_object(
    'estornos', (SELECT count(*) FROM public.estornos_asaas),
    'linhas_planilha', (SELECT count(*) FROM public.estornos_planilha),
    'casados', (SELECT count(*) FROM _m),
    'sem_classificacao', (SELECT count(*) FROM public.estornos_asaas) - (SELECT count(*) FROM _m),
    'descartados', (SELECT count(*) FROM public.estornos_asaas WHERE cobranca_indevida),
    'descarte_por_estabelecimento', (SELECT count(*) FROM public.estornos_asaas WHERE descarte_origem = 'estabelecimento'),
    'linhas_sem_estorno', (SELECT count(*) FROM public.estornos_planilha p
                           WHERE NOT EXISTS (SELECT 1 FROM _m m WHERE m.linha = p.linha)),
    'por_criterio', (SELECT coalesce(jsonb_object_agg(como, n), '{}'::jsonb)
                     FROM (SELECT como, count(*) AS n FROM _m GROUP BY como) z)
  ) INTO resumo;

  RETURN resumo;
END;
$$;

-- Função nova em `public` nasce chamável por `anon` (o GRANT vem do papel PUBLIC).
REVOKE ALL ON FUNCTION public.estornos_chave(text) FROM anon;
REVOKE ALL ON FUNCTION public.estornos_nome(text) FROM anon;
REVOKE ALL ON FUNCTION public.estornos_motivo_descarta(text) FROM anon;
REVOKE ALL ON FUNCTION public.estornos_conciliar() FROM anon;
GRANT EXECUTE ON FUNCTION public.estornos_conciliar() TO authenticated, service_role;
