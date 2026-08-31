-- A resposta do líder ganha coluna própria, para não apagar a anotação do financeiro.
--
-- `auditoria_cartao_lancamentos.observacao` é o caderno de trabalho da auditoria — 111
-- linhas têm coisas como "NF-e 91.970 de 15/07 - 981,54 - titulo CARTAO DE CREDITO
-- PAGSEGURO" ou "Airbnb HMX4SA5JAZ - 5.300,00 em 6x; viajante Miguel Carvalho". São notas
-- que a analista escreveu para si.
--
-- `fatura_justificar_via_token` estava gravando a justificativa do líder EM CIMA disso.
-- Ninguém veria erro: a nota simplesmente desapareceria, substituída por um texto que diz
-- outra coisa. Nenhuma linha se perdeu ainda (conferido antes de mudar), mas o primeiro
-- líder a justificar num gasto anotado levaria a nota junto.
--
-- Agora são dois campos com dois donos: `observacao` é do financeiro, `justificativa_lider`
-- é de quem gastou. Nenhum escreve no do outro.

ALTER TABLE public.auditoria_cartao_lancamentos
  ADD COLUMN IF NOT EXISTS justificativa_lider    text,
  ADD COLUMN IF NOT EXISTS justificativa_lider_em timestamptz;

COMMENT ON COLUMN public.auditoria_cartao_lancamentos.observacao IS
  'Anotação de trabalho do FINANCEIRO. O líder nunca escreve aqui — a resposta dele vai '
  'em justificativa_lider.';
COMMENT ON COLUMN public.auditoria_cartao_lancamentos.justificativa_lider IS
  'O que o portador do cartão respondeu pelo /l/<token>.';

-- ---------------------------------------------------------------------------
-- As escritas passam a respeitar a divisão
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fatura_justificar_via_token(
  p_token text, p_digitos text, p_id_unico text, p_texto text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cartao text;
  v_texto  text;
  v_achado text;
BEGIN
  v_cartao := fatura_cartao_do_token(p_token, p_digitos);
  IF v_cartao IS NULL THEN RETURN jsonb_build_object('erro', 'Acesso não confere'); END IF;

  v_texto := btrim(coalesce(p_texto, ''));
  IF v_texto = '' THEN RETURN jsonb_build_object('erro', 'Escreva a justificativa'); END IF;
  IF length(v_texto) > 4000 THEN
    RETURN jsonb_build_object('erro', 'Justificativa longa demais (máx. 4000 caracteres)');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auditoria_cartao_lancamentos
                 WHERE id_unico = p_id_unico AND card_final = v_cartao) THEN
    RETURN jsonb_build_object('erro', 'Este lançamento não é do seu cartão');
  END IF;

  UPDATE auditoria_cartao_lancamentos
  SET justificativa_lider = v_texto, justificativa_lider_em = now(), updated_at = now()
  WHERE id_unico = p_id_unico AND card_final = v_cartao;

  v_achado := achado_do_lancamento(p_id_unico);
  IF v_achado IS NOT NULL THEN
    UPDATE auditoria
    SET justificativa = v_texto,
        status = CASE WHEN status = 'Pendente' THEN 'Em análise' ELSE status END,
        trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'evento', 'justificativa_na_fatura', 'canal', 'link_publico',
          'token', p_token, 'texto', v_texto, 'timestamp', now())),
        updated_at = now()
    WHERE id_unico = v_achado;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_justificativa_via_token(
  p_token text, p_id_unico text, p_texto text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_evento jsonb;
  v_alvo   text;
BEGIN
  IF NOT validar_token_para_id_unico(p_token, p_id_unico) THEN
    RETURN jsonb_build_object('erro', 'Token inválido ou não cobre este lançamento');
  END IF;

  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RETURN jsonb_build_object('erro', 'Justificativa vazia');
  END IF;

  v_evento := jsonb_build_object(
    'evento', 'justificativa_recebida', 'canal', 'link_publico',
    'token', p_token, 'texto', p_texto, 'timestamp', now());

  UPDATE auditoria
  SET justificativa = p_texto,
      status = 'Em análise',
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(v_evento),
      updated_at = now()
  WHERE id_unico = p_id_unico;

  v_alvo := lancamento_do_achado(p_id_unico);
  IF v_alvo IS NOT NULL THEN
    UPDATE auditoria_cartao_lancamentos
    SET justificativa_lider = p_texto, justificativa_lider_em = now(), updated_at = now()
    WHERE id_unico = v_alvo;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'Em análise');
END;
$function$;

-- ---------------------------------------------------------------------------
-- A fatura mostra os dois textos, cada um no seu lugar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_fatura_via_token(
  p_token text, p_digitos text, p_ip text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row     magic_tokens%ROWTYPE;
  v_digitos text;
  v_acesso  jsonb;
  v_nome    text;
  v_meses   jsonb;
  v_resumo  jsonb;
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;

  IF NOT FOUND OR v_row.status = 'revogado' THEN
    RETURN jsonb_build_object('erro', 'Link inválido ou revogado');
  END IF;

  IF v_row.card_final IS NULL THEN
    RETURN jsonb_build_object(
      'erro', 'Ainda não sabemos qual cartão é o seu. Fale com o financeiro pra liberar sua fatura.');
  END IF;

  v_acesso := cartao_acesso(v_row.card_final);
  v_nome := coalesce(v_acesso->>'nome', v_row.responsavel);

  IF NOT (v_acesso->>'aberto')::boolean THEN
    RETURN jsonb_build_object(
      'erro', 'Este cartão foi encerrado. Se ainda precisa enviar alguma coisa, fale com o financeiro.',
      'encerrado', true);
  END IF;

  IF v_row.fatura_bloqueio_ate IS NOT NULL AND v_row.fatura_bloqueio_ate > now() THEN
    RETURN jsonb_build_object(
      'erro', 'Muitas tentativas. Tente de novo em alguns minutos.', 'bloqueado', true);
  END IF;

  v_digitos := regexp_replace(coalesce(p_digitos, ''), '\D', '', 'g');

  IF v_digitos = '' THEN
    RETURN jsonb_build_object('precisa_digitos', true, 'responsavel', v_nome);
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
  SET fatura_erros = 0, fatura_bloqueio_ate = NULL, fatura_abertura_em = now(),
      acessos = acessos + 1, ultimo_acesso = now(),
      ip_ultimo_acesso = coalesce(p_ip, ip_ultimo_acesso)
  WHERE token = p_token;

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
        'ordem_data', to_char(c.data, 'YYYY-MM-DD'),
        'estabelecimento', CASE
          WHEN c.estabelecimento IS NULL OR c.estabelecimento = ''
            OR c.estabelecimento ILIKE '%não identificado%'
          THEN coalesce(nullif(c.descricao_original, ''), c.estabelecimento, '—')
          ELSE c.estabelecimento
        END,
        'categoria', nullif(c.categoria, ''),
        'parcela', nullif(c.parcela, ''),
        'valor', c.valor,
        -- O que ELE escreveu. A `observacao` do financeiro não entra aqui: pré-preencher a
        -- caixa com a nota da analista faria o líder salvar de volta um texto que não é dele.
        'justificativa', coalesce(c.justificativa_lider, a.justificativa),
        -- A nota do financeiro vai como contexto, só leitura — e sem as que são recado
        -- interno ("cobrar Fulano", "aguardando..."), mesmo critério de `preview_msg_ajuste`.
        'nota_interna', CASE
          WHEN c.observacao ~* '^(cobrar |pendente de |verificar com |aguardando |solicitar |acompanhar )'
            THEN NULL
          ELSE nullif(btrim(coalesce(c.observacao, '')), '')
        END,
        'situacao', CASE
          WHEN coalesce(c.link_comprovante, '') <> '' OR c.status_nf = 'OK' THEN 'ok'
          WHEN c.status_nf IN ('ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO', 'PARCELA (origem)')
            THEN 'dispensado'
          ELSE 'pendente'
        END,
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
    'responsavel', v_nome,
    'card_final', v_row.card_final,
    'encerrando', coalesce((v_acesso->>'encerrando')::boolean, false),
    'acesso_ate', v_acesso->>'acesso_ate',
    'resumo', v_resumo,
    'meses', coalesce(v_meses, '[]'::jsonb)
  );
END;
$function$;

-- A aba de pendências lê a resposta do líder do campo novo, não mais da `observacao`.
CREATE OR REPLACE FUNCTION public.resolver_token(p_token text, p_ip text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row    magic_tokens%ROWTYPE;
  v_itens  jsonb;
  v_qtd    int;
  v_total  numeric;
  v_acesso jsonb;
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;

  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Token inválido'); END IF;
  IF v_row.status = 'revogado' THEN
    RETURN jsonb_build_object('erro', 'Este link foi revogado');
  END IF;

  IF v_row.card_final IS NOT NULL THEN
    v_acesso := cartao_acesso(v_row.card_final);
    IF NOT (v_acesso->>'aberto')::boolean THEN
      RETURN jsonb_build_object(
        'erro', 'Este cartão foi encerrado. Se ainda precisa enviar alguma coisa, fale com o financeiro.');
    END IF;
  END IF;

  UPDATE magic_tokens
  SET acessos = acessos + 1, ultimo_acesso = now(), ip_ultimo_acesso = p_ip
  WHERE token = p_token;

  SELECT jsonb_agg(jsonb_build_object(
    'id_unico', a.id_unico,
    'estabelecimento', CASE
      WHEN c.estabelecimento IS NULL OR c.estabelecimento = '' THEN
        coalesce(nullif(c.descricao_original, ''), split_part(a.titulo, ' R$', 1))
      WHEN c.estabelecimento ILIKE '%não identificado%' THEN
        coalesce(nullif(c.descricao_original, ''), c.estabelecimento)
      ELSE c.estabelecimento
    END,
    'valor', a.valor,
    'regra', a.regra,
    'categoria', coalesce(c.categoria, a.categoria),
    'data', to_char(coalesce(c.data, a.data_lancamento), 'DD/MM/YYYY'),
    'cartao_final', c.card_final,
    'parcela', c.parcela,
    'status', a.status,
    'link_comprovante', a.link_comprovante,
    'justificativa', coalesce(a.justificativa, c.justificativa_lider),
    'resolvido', (a.link_comprovante IS NOT NULL
                  OR a.justificativa IS NOT NULL
                  OR c.justificativa_lider IS NOT NULL)
  ) ORDER BY (a.link_comprovante IS NOT NULL
              OR a.justificativa IS NOT NULL
              OR c.justificativa_lider IS NOT NULL), a.valor DESC),
  count(*)::int,
  coalesce(sum(a.valor), 0)
  INTO v_itens, v_qtd, v_total
  FROM auditoria a
  LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
  WHERE a.id_unico IN (SELECT jsonb_array_elements_text(v_row.id_unicos));

  RETURN jsonb_build_object(
    'responsavel', coalesce(v_acesso->>'nome', v_row.responsavel),
    'qtd_itens', coalesce(v_qtd, 0),
    'valor_total', coalesce(v_total, 0),
    'expira_em', NULL,
    'acessos', v_row.acessos + 1,
    'itens', coalesce(v_itens, '[]'::jsonb)
  );
END;
$function$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('resolver_fatura_via_token', 'resolver_token',
                        'salvar_justificativa_via_token', 'fatura_justificar_via_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.assinatura);
  END LOOP;
END $$;
