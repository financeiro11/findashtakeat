-- Auditoria · o líder passa a ver a FATURA INTEIRA do cartão dele, não só o que foi cobrado.
--
-- O /l/<token> já existe desde 07/2026 e os líderes usam (a Thais abriu o dela 37 vezes).
-- Mas ele mostra só os `id_unicos` que alguém acrescentou numa cobrança. Na prática:
--
--     Thais  ·  link: 26 itens / R$  5.841   ·  cartão 3148: 87 itens / R$ 35.988
--     Miguel ·  link: 46 itens / R$ 18.791   ·  cartão 3618: 435 itens / R$ 331.917
--
-- E em ago/26 NENHUM lançamento virou achado, então hoje o link não mostra agosto nenhum.
-- O líder enxerga uma fresta da própria fatura e não consegue conferir o total.
--
-- Agora o mesmo link ganha uma segunda aba com todos os lançamentos do cartão dele —
-- com e sem comprovante — a partir de ago/26. Os meses anteriores ficam de fora de
-- propósito: o .ofx do Sicoob é o extrato CONSOLIDADO da conta (um único ACCTID, uma única
-- linha "ANUIDADE VISA C (3485)" por fatura), então jan–jul têm o gasto mas não têm dono.
-- Deduzir o dono pelo estabelecimento não serve: medido sobre jun+ago, só 51,8% dos
-- lançamentos têm dono único — UBER é de 7 pessoas, CLAUDE.AI de 6, LATAM de 3. Chutar
-- pôe a corrida de um na página do outro, e numa tela que serve pra cobrar isso é pior
-- que não mostrar. O histórico se forma daqui pra frente, mês a mês.
--
-- ---------------------------------------------------------------------------
-- Duas decisões que valem explicação:
--
-- 1) O TOKEN PASSA A SER CHAVEADO POR `card_final`, não por nome.
--    `criar_token_e_registrar` casa por `lower(responsavel)`, e o nome é furado: o mesmo
--    Henrique tem SEIS tokens ("Henrique Anjos Moura" × "Henrique dos Anjos Moura"), e o
--    Luiz aparece como duas pessoas na base do cartão ("Luiz PC Chacara" × "Luiz P C
--    Chácara") só por causa do acento. O final do cartão é estável, é único por pessoa e
--    já está na tabela.
--
-- 2) OS 4 DÍGITOS SÃO CONFIRMAÇÃO, NÃO SENHA.
--    Quem identifica o líder é o token (16 hex). Os dígitos provam que quem abriu tem o
--    cartão na mão, então um link encaminhado no WhatsApp não basta. Eles NÃO são segredo
--    — `preview_msg_ajuste` já manda "cartão final 3618" no corpo da mensagem — e por isso
--    sozinhos não serviriam: 10 cartões em 10.000 combinações é enumerável em minutos.
--    Daí o freio: 5 erros e o link dorme 15 minutos.

-- ---------------------------------------------------------------------------
-- 1) O token ganha o cartão
-- ---------------------------------------------------------------------------
ALTER TABLE public.magic_tokens
  ADD COLUMN IF NOT EXISTS card_final           text,
  ADD COLUMN IF NOT EXISTS fatura_erros         int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fatura_bloqueio_ate  timestamptz,
  ADD COLUMN IF NOT EXISTS fatura_abertura_em   timestamptz;

COMMENT ON COLUMN public.magic_tokens.card_final IS
  'Final do cartão do líder. É a identidade estável do link — o nome varia de grafia.';
COMMENT ON COLUMN public.magic_tokens.fatura_erros IS
  'Erros seguidos nos 4 dígitos. Zera ao acertar; 5 acendem o bloqueio.';

-- Backfill: casa o nome do token com o gestor da base do cartão por PRIMEIRO + ÚLTIMO
-- nome, sem acento. É o que resolve "Ana Clara Rossi Mongin" × "Ana C Rossi Mongin" e
-- "Henrique dos Anjos Moura" × "Henrique Anjos Moura" sem confundir o Henrique com o
-- Guilherme (os dois terminam em "Moura", mas o primeiro nome separa).
WITH nome_do_cartao AS (
  SELECT DISTINCT ON (chave) chave, card_final
  FROM (
    SELECT
      lower(unaccent(split_part(btrim(gestor), ' ', 1))) || '|' ||
      lower(unaccent(regexp_replace(btrim(gestor), '^.*\s', ''))) AS chave,
      card_final,
      count(*) OVER (PARTITION BY card_final) AS peso
    FROM public.auditoria_cartao_lancamentos
    WHERE card_final IS NOT NULL
      AND gestor IS NOT NULL
      AND gestor NOT IN ('(consolidado)', '(sem cartão)', 'Cartão Provisório')
  ) x
  ORDER BY chave, peso DESC
)
UPDATE public.magic_tokens t
SET card_final = n.card_final
FROM nome_do_cartao n
WHERE t.card_final IS NULL
  AND n.chave = lower(unaccent(split_part(btrim(t.responsavel), ' ', 1))) || '|' ||
                lower(unaccent(regexp_replace(btrim(t.responsavel), '^.*\s', '')));

-- Um líder, um link. Os tokens antigos duplicados (o Henrique tem 6) ficam revogados —
-- o mais recente de cada cartão é o que sobrevive, porque é o que foi enviado por último.
WITH ranqueado AS (
  SELECT token,
         row_number() OVER (PARTITION BY card_final ORDER BY criado_em DESC) AS pos
  FROM public.magic_tokens
  WHERE card_final IS NOT NULL AND status <> 'revogado'
)
UPDATE public.magic_tokens t
SET status = 'revogado'
FROM ranqueado r
WHERE t.token = r.token AND r.pos > 1;

CREATE UNIQUE INDEX IF NOT EXISTS magic_tokens_um_ativo_por_cartao_idx
  ON public.magic_tokens (card_final)
  WHERE card_final IS NOT NULL AND status <> 'revogado';

-- ---------------------------------------------------------------------------
-- 2) Contestação — o único verbo que ainda não existia
-- ---------------------------------------------------------------------------
-- Anexar e justificar já existem. Faltava o líder poder dizer "esse gasto não é meu" ou
-- "o valor está errado", que é a única coisa que ele sabe e o financeiro não.
CREATE TABLE IF NOT EXISTS public.cartao_contestacoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_unico     text NOT NULL,
  card_final   text NOT NULL,
  responsavel  text,
  motivo       text NOT NULL CHECK (motivo IN ('nao_reconheco', 'valor_errado', 'nao_e_meu', 'outro')),
  texto        text,
  status       text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'resolvida', 'recusada')),
  resposta     text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid
);

-- Uma contestação aberta por lançamento: reenviar corrige a que está lá, não empilha.
CREATE UNIQUE INDEX IF NOT EXISTS cartao_contestacoes_aberta_idx
  ON public.cartao_contestacoes (id_unico) WHERE status = 'aberta';

ALTER TABLE public.cartao_contestacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contestacoes lê autenticado" ON public.cartao_contestacoes;
CREATE POLICY "contestacoes lê autenticado" ON public.cartao_contestacoes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "contestacoes resolve autenticado" ON public.cartao_contestacoes;
CREATE POLICY "contestacoes resolve autenticado" ON public.cartao_contestacoes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3) O portão: valida token + dígitos, e devolve o cartão
-- ---------------------------------------------------------------------------
-- Devolve o card_final quando o par confere, NULL quando não. Sem RAISE de propósito:
-- exceção desfaz a transação e levaria junto o contador de erros do freio.
CREATE OR REPLACE FUNCTION public.fatura_cartao_do_token(p_token text, p_digitos text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row magic_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.status = 'revogado' THEN RETURN NULL; END IF;
  IF v_row.expira_em IS NOT NULL AND v_row.expira_em < now() THEN RETURN NULL; END IF;
  IF v_row.card_final IS NULL THEN RETURN NULL; END IF;
  IF regexp_replace(coalesce(p_digitos, ''), '\D', '', 'g') <> v_row.card_final THEN RETURN NULL; END IF;
  RETURN v_row.card_final;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) A fatura do líder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_fatura_via_token(
  p_token   text,
  p_digitos text,
  p_ip      text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row     magic_tokens%ROWTYPE;
  v_digitos text;
  v_meses   jsonb;
  v_resumo  jsonb;
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;

  IF NOT FOUND OR v_row.status = 'revogado' THEN
    RETURN jsonb_build_object('erro', 'Link inválido ou revogado');
  END IF;

  IF v_row.expira_em IS NOT NULL AND v_row.expira_em < now() THEN
    RETURN jsonb_build_object('erro', 'Link expirado. Fale com o financeiro.');
  END IF;

  IF v_row.card_final IS NULL THEN
    RETURN jsonb_build_object(
      'erro', 'Ainda não sabemos qual cartão é o seu. Fale com o financeiro pra liberar sua fatura.');
  END IF;

  -- Freio antes de conferir: 5 erros seguidos e o link dorme 15 minutos. É o que impede
  -- varrer as 10.000 combinações de 4 dígitos.
  IF v_row.fatura_bloqueio_ate IS NOT NULL AND v_row.fatura_bloqueio_ate > now() THEN
    RETURN jsonb_build_object(
      'erro', 'Muitas tentativas. Tente de novo em alguns minutos.',
      'bloqueado', true);
  END IF;

  v_digitos := regexp_replace(coalesce(p_digitos, ''), '\D', '', 'g');

  -- Sem dígitos = só perguntando de quem é o link, pra tela saber o que pedir.
  IF v_digitos = '' THEN
    RETURN jsonb_build_object(
      'precisa_digitos', true,
      'responsavel', v_row.responsavel);
  END IF;

  IF v_digitos <> v_row.card_final THEN
    UPDATE magic_tokens
    SET fatura_erros = fatura_erros + 1,
        fatura_bloqueio_ate = CASE WHEN fatura_erros + 1 >= 5
                                   THEN now() + interval '15 minutes' ELSE NULL END
    WHERE token = p_token;
    RETURN jsonb_build_object(
      'erro', 'Esses não são os 4 últimos dígitos do seu cartão.',
      'precisa_digitos', true,
      'restam', greatest(0, 4 - v_row.fatura_erros));
  END IF;

  UPDATE magic_tokens
  SET fatura_erros = 0,
      fatura_bloqueio_ate = NULL,
      fatura_abertura_em = now(),
      acessos = acessos + 1,
      ultimo_acesso = now(),
      ip_ultimo_acesso = coalesce(p_ip, ip_ultimo_acesso)
  WHERE token = p_token;

  -- Um bloco por mês, do mais recente pro mais antigo. Começa em ago/26 — ver o cabeçalho.
  SELECT jsonb_agg(m ORDER BY (m->>'competencia') DESC)
  INTO v_meses
  FROM (
    SELECT jsonb_build_object(
      'competencia', to_char(c.competencia, 'YYYY-MM-DD'),
      'label', to_char(c.competencia, 'MM/YYYY'),
      'total', sum(c.valor),
      'itens', jsonb_agg(jsonb_build_object(
        'id_unico', c.id_unico,
        'data', to_char(c.data, 'DD/MM/YYYY'),
        'estabelecimento', CASE
          WHEN c.estabelecimento IS NULL OR c.estabelecimento = ''
            OR c.estabelecimento ILIKE '%não identificado%'
          THEN coalesce(nullif(c.descricao_original, ''), c.estabelecimento, '—')
          ELSE c.estabelecimento
        END,
        'categoria', nullif(c.categoria, ''),
        'parcela', nullif(c.parcela, ''),
        'valor', c.valor,
        'observacao', nullif(c.observacao, ''),
        -- Três situações, não os 8 valores crus de status_nf: o líder precisa saber se a
        -- linha espera algo DELE, não o vocabulário interno da auditoria.
        'situacao', CASE
          WHEN coalesce(c.link_comprovante, '') <> '' OR c.status_nf = 'OK' THEN 'ok'
          WHEN c.status_nf IN ('ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO', 'PARCELA (origem)')
            THEN 'dispensado'
          ELSE 'pendente'
        END,
        -- Frase, não o código interno. E NULL quando não há o que dizer: 'OK' escrito
        -- na linha não informa nada a quem está lendo a própria fatura.
        'motivo', CASE c.status_nf
          WHEN 'OK'                        THEN NULL
          WHEN 'ENCARGO'                   THEN 'Encargo do cartão'
          WHEN 'DISPENSADO (<piso)'        THEN 'Abaixo do piso — não precisa de nota'
          WHEN 'SEM NF-ESPERADO'           THEN 'Não se espera nota fiscal'
          WHEN 'PARCELA (origem)'          THEN 'A nota está na 1ª parcela'
          WHEN 'CONFERIR (passagem/hosp.)' THEN 'Confirmar o valor total da viagem'
          WHEN 'OK (conferir)'             THEN 'Comprovante recebido, falta conferir'
          WHEN 'SEM NF'                    THEN 'Falta a nota fiscal'
          ELSE c.status_nf
        END,
        'tem_comprovante', (coalesce(c.link_comprovante, '') <> ''),
        'justificativa', a.justificativa,
        'achado_status', a.status,
        'contestacao', ct.motivo,
        'contestacao_texto', ct.texto
      ) ORDER BY c.data DESC, abs(c.valor) DESC)
    ) AS m
    FROM auditoria_cartao_lancamentos c
    LEFT JOIN auditoria a  ON a.id_transacao = c.id_unico
    LEFT JOIN cartao_contestacoes ct ON ct.id_unico = c.id_unico AND ct.status = 'aberta'
    WHERE c.card_final = v_row.card_final
      AND c.competencia >= date '2026-08-01'
    GROUP BY c.competencia
  ) meses;

  SELECT jsonb_build_object(
    'lancamentos', count(*),
    'total', coalesce(sum(c.valor), 0),
    'pendentes', count(*) FILTER (
      WHERE coalesce(c.link_comprovante, '') = ''
        AND c.status_nf NOT IN ('OK', 'ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO', 'PARCELA (origem)')),
    'com_comprovante', count(*) FILTER (WHERE coalesce(c.link_comprovante, '') <> '')
  )
  INTO v_resumo
  FROM auditoria_cartao_lancamentos c
  WHERE c.card_final = v_row.card_final
    AND c.competencia >= date '2026-08-01';

  RETURN jsonb_build_object(
    'responsavel', v_row.responsavel,
    'card_final', v_row.card_final,
    'resumo', v_resumo,
    'meses', coalesce(v_meses, '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Agir em QUALQUER linha do próprio cartão
-- ---------------------------------------------------------------------------
-- As RPCs que já existem (`salvar_justificativa_via_token`, `registrar_comprovante_via_token`)
-- só aceitam id_unico que esteja na lista `id_unicos` do token, e escrevem em `auditoria`.
-- A fatura tem linhas que nunca viraram achado — não há linha em `auditoria` pra elas —
-- então o caminho é escrever direto na base do cartão, com o cartão como autorização.
CREATE OR REPLACE FUNCTION public.fatura_justificar_via_token(
  p_token    text,
  p_digitos  text,
  p_id_unico text,
  p_texto    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cartao text;
  v_texto  text;
BEGIN
  v_cartao := fatura_cartao_do_token(p_token, p_digitos);
  IF v_cartao IS NULL THEN
    RETURN jsonb_build_object('erro', 'Acesso não confere');
  END IF;

  v_texto := btrim(coalesce(p_texto, ''));
  IF v_texto = '' THEN
    RETURN jsonb_build_object('erro', 'Escreva a justificativa');
  END IF;
  IF length(v_texto) > 4000 THEN
    RETURN jsonb_build_object('erro', 'Justificativa longa demais (máx. 4000 caracteres)');
  END IF;

  -- O cartão da linha É a autorização: sem isso o token de um líder escreveria na linha
  -- de outro só sabendo o id_unico.
  IF NOT EXISTS (
    SELECT 1 FROM auditoria_cartao_lancamentos
    WHERE id_unico = p_id_unico AND card_final = v_cartao
  ) THEN
    RETURN jsonb_build_object('erro', 'Este lançamento não é do seu cartão');
  END IF;

  UPDATE auditoria_cartao_lancamentos
  SET observacao = v_texto, updated_at = now()
  WHERE id_unico = p_id_unico AND card_final = v_cartao;

  -- Quando a linha TAMBÉM é um achado cobrado, a justificativa vale nos dois lugares —
  -- senão a tela da auditoria segue cobrando o que o líder já respondeu.
  UPDATE auditoria
  SET justificativa = v_texto,
      status = CASE WHEN status = 'Pendente' THEN 'Em análise' ELSE status END,
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'evento', 'justificativa_na_fatura', 'canal', 'link_publico',
        'token', p_token, 'timestamp', now())),
      updated_at = now()
  WHERE id_transacao = p_id_unico;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fatura_contestar_via_token(
  p_token    text,
  p_digitos  text,
  p_id_unico text,
  p_motivo   text,
  p_texto    text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cartao text;
  v_resp   text;
BEGIN
  v_cartao := fatura_cartao_do_token(p_token, p_digitos);
  IF v_cartao IS NULL THEN
    RETURN jsonb_build_object('erro', 'Acesso não confere');
  END IF;

  IF p_motivo NOT IN ('nao_reconheco', 'valor_errado', 'nao_e_meu', 'outro') THEN
    RETURN jsonb_build_object('erro', 'Motivo inválido');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auditoria_cartao_lancamentos
    WHERE id_unico = p_id_unico AND card_final = v_cartao
  ) THEN
    RETURN jsonb_build_object('erro', 'Este lançamento não é do seu cartão');
  END IF;

  SELECT responsavel INTO v_resp FROM magic_tokens WHERE token = p_token;

  INSERT INTO cartao_contestacoes (id_unico, card_final, responsavel, motivo, texto)
  VALUES (p_id_unico, v_cartao, v_resp, p_motivo, nullif(btrim(coalesce(p_texto, '')), ''))
  ON CONFLICT (id_unico) WHERE status = 'aberta'
  DO UPDATE SET motivo = excluded.motivo, texto = excluded.texto, criado_em = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Desfazer: o líder contestou por engano e quer voltar atrás.
CREATE OR REPLACE FUNCTION public.fatura_descontestar_via_token(
  p_token text, p_digitos text, p_id_unico text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cartao text;
BEGIN
  v_cartao := fatura_cartao_do_token(p_token, p_digitos);
  IF v_cartao IS NULL THEN
    RETURN jsonb_build_object('erro', 'Acesso não confere');
  END IF;

  DELETE FROM cartao_contestacoes
  WHERE id_unico = p_id_unico AND card_final = v_cartao AND status = 'aberta';

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Portas: o anônimo só enxerga estas quatro, e nenhuma tabela
-- ---------------------------------------------------------------------------
-- Mesmo desenho de 20260830233000_fechar_as_portas_abertas_para_anon.sql. Revoga de
-- `public` junto porque `anon` herda de PUBLIC — revogar só de anon não pega.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('resolver_fatura_via_token', 'fatura_justificar_via_token',
                        'fatura_contestar_via_token', 'fatura_descontestar_via_token',
                        'fatura_cartao_do_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f.assinatura);
  END LOOP;

  -- `fatura_cartao_do_token` fica de fora do grant: é o verificador interno, e exposto
  -- viraria um oráculo que confirma dígito por dígito sem passar pelo freio.
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('resolver_fatura_via_token', 'fatura_justificar_via_token',
                        'fatura_contestar_via_token', 'fatura_descontestar_via_token')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.assinatura);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.cartao_contestacoes FROM anon;
