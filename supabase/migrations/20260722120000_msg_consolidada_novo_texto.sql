-- Atualiza o texto da mensagem consolidada da auditoria (botão "Solicitar Justificativas").
-- Novo formato: saudação "Eiei", lista limpa "• Estabelecimento — R$ valor" (sem regra/motivo),
-- header "📋 Pendências", link, expiração e prazo.
--
-- Existem DUAS sobrecargas da função e ambas precisam ser mantidas:
--   preview_msg_consolidada(text)        -> chamada com {p_responsavel}
--   preview_msg_consolidada(text, date)  -> chamada com {p_responsavel, p_competencia}  (usada pelo frontend em produção)
-- O PostgREST resolve cada request pelo conjunto exato de nomes de argumentos, então manter as
-- duas não gera ambiguidade para o app. NÃO remover nenhuma delas.

CREATE OR REPLACE FUNCTION public.preview_msg_consolidada(p_responsavel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pendencias jsonb;
  v_qtd        int;
  v_total      numeric;
  v_id_unicos  jsonb;
  v_col_id     uuid;
  v_col_nome   text;
  v_col_tel    text;
  v_col_match  text;
  v_primeiro   text;
  v_dig        text;
  v_mensagem   text;
  v_body       text := '';
  v_formato    text;
  v_meses      text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho',
                               'julho','agosto','setembro','outubro','novembro','dezembro'];
  v_comp_str   text;
  v_prazo_str  text;
  v_limite     int := 25;
BEGIN
  SELECT
    jsonb_agg(jsonb_build_object(
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
      'competencia', a.competencia
    ) ORDER BY a.valor DESC),
    count(*)::int,
    coalesce(sum(a.valor), 0),
    jsonb_agg(a.id_unico ORDER BY a.valor DESC)
  INTO v_pendencias, v_qtd, v_total, v_id_unicos
  FROM auditoria a
  LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
  WHERE a.responsavel = p_responsavel AND a.status = 'Pendente';

  IF v_qtd IS NULL OR v_qtd = 0 THEN
    RETURN jsonb_build_object('erro', 'Nenhuma pendência encontrada para ' || p_responsavel, 'qtd_itens', 0);
  END IF;

  SELECT id, nome, telefone, match_type
  INTO v_col_id, v_col_nome, v_col_tel, v_col_match
  FROM resolve_colaborador_por_nome(p_responsavel);

  v_primeiro := coalesce(
    nullif(split_part(coalesce(v_col_nome, ''), ' ', 1), ''),
    nullif(split_part(coalesce(p_responsavel, ''), ' ', 1), '')
  );

  v_dig := regexp_replace(coalesce(v_col_tel, ''), '\D', '', 'g');

  SELECT v_meses[EXTRACT(MONTH FROM competencia)::int] || '/' || EXTRACT(YEAR FROM competencia)::text
  INTO v_comp_str
  FROM auditoria
  WHERE responsavel = p_responsavel AND status = 'Pendente'
  GROUP BY competencia ORDER BY count(*) DESC LIMIT 1;

  v_prazo_str := to_char(CURRENT_DATE + INTERVAL '7 days', 'DD/MM/YYYY');

  -- Lista limpa: "• Estabelecimento — R$ valor" (maiores primeiro), 1 por linha, sem regra/motivo.
  SELECT string_agg('• ' || estab || ' — R$ ' || fmt_brl(valor), E'\n' ORDER BY valor DESC)
  INTO v_body
  FROM (
    SELECT
      CASE
        WHEN c.estabelecimento IS NULL OR c.estabelecimento = '' THEN
          coalesce(nullif(c.descricao_original, ''), split_part(a.titulo, ' R$', 1))
        WHEN c.estabelecimento ILIKE '%não identificado%' THEN
          coalesce(nullif(c.descricao_original, ''), c.estabelecimento)
        ELSE c.estabelecimento
      END AS estab, a.valor
    FROM auditoria a
    LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
    WHERE a.responsavel = p_responsavel AND a.status = 'Pendente'
    ORDER BY a.valor DESC
    LIMIT v_limite
  ) x;

  IF v_qtd > v_limite THEN
    v_formato := 'hibrido';
    v_body := v_body || E'\n' || '• …e mais ' || (v_qtd - v_limite) || ' pendências';
  ELSE
    v_formato := 'lista';
  END IF;

  v_mensagem :=
    'Eiei, ' || coalesce(v_primeiro, 'líder') || '! 👋👋' || E'\n\n' ||
    'A auditoria do cartão corporativo identificou ' || v_qtd ||
    ' pendências no total de R$ ' || fmt_brl(v_total) || ':' || E'\n\n' ||
    '📋 Pendências' || E'\n' ||
    v_body || E'\n\n' ||
    '🔗 Acesse para anexar comprovantes e justificar:' || E'\n' ||
    hub_base_url() || '/l/{{TOKEN}}' || E'\n\n' ||
    'O link é individual e não deve ser compartilhado. Expira em 7 dias.' || E'\n' ||
    'Prazo para resposta: ' || v_prazo_str || E'\n\n' ||
    'Obrigada!';

  RETURN jsonb_build_object(
    'responsavel', p_responsavel,
    'colaborador_id', v_col_id,
    'colaborador_nome', v_col_nome,
    'match_type', v_col_match,
    'telefone', v_col_tel,
    'telefone_ok', (length(v_dig) >= 10),
    'qtd_itens', v_qtd,
    'valor_total', v_total,
    'formato', v_formato,
    'competencia', v_comp_str,
    'id_unicos', v_id_unicos,
    'itens', v_pendencias,
    'mensagem', v_mensagem,
    'prazo', v_prazo_str
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_msg_consolidada(p_responsavel text, p_competencia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pendencias jsonb;
  v_qtd        int;
  v_total      numeric;
  v_id_unicos  jsonb;
  v_col_id     uuid;
  v_col_nome   text;
  v_col_tel    text;
  v_col_match  text;
  v_primeiro   text;
  v_dig        text;
  v_mensagem   text;
  v_body       text := '';
  v_formato    text;
  v_meses      text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho',
                               'julho','agosto','setembro','outubro','novembro','dezembro'];
  v_comp_str   text;
  v_prazo_str  text;
  v_limite     int := 25;
BEGIN
  SELECT
    jsonb_agg(jsonb_build_object(
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
      'competencia', a.competencia
    ) ORDER BY a.valor DESC),
    count(*)::int,
    coalesce(sum(a.valor), 0),
    jsonb_agg(a.id_unico ORDER BY a.valor DESC)
  INTO v_pendencias, v_qtd, v_total, v_id_unicos
  FROM auditoria a
  LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
  WHERE a.responsavel = p_responsavel
    AND a.status = 'Pendente'
    AND (p_competencia IS NULL OR a.competencia = p_competencia);

  IF v_qtd IS NULL OR v_qtd = 0 THEN
    RETURN jsonb_build_object('erro', 'Nenhuma pendência encontrada para ' || p_responsavel, 'qtd_itens', 0);
  END IF;

  SELECT id, nome, telefone, match_type
  INTO v_col_id, v_col_nome, v_col_tel, v_col_match
  FROM resolve_colaborador_por_nome(p_responsavel);

  v_primeiro := coalesce(
    nullif(split_part(coalesce(v_col_nome, ''), ' ', 1), ''),
    nullif(split_part(coalesce(p_responsavel, ''), ' ', 1), '')
  );

  v_dig := regexp_replace(coalesce(v_col_tel, ''), '\D', '', 'g');

  IF p_competencia IS NOT NULL THEN
    v_comp_str := v_meses[EXTRACT(MONTH FROM p_competencia)::int] || '/' || EXTRACT(YEAR FROM p_competencia)::text;
  ELSE
    SELECT v_meses[EXTRACT(MONTH FROM competencia)::int] || '/' || EXTRACT(YEAR FROM competencia)::text
    INTO v_comp_str
    FROM auditoria
    WHERE responsavel = p_responsavel AND status = 'Pendente'
    GROUP BY competencia ORDER BY count(*) DESC LIMIT 1;
  END IF;

  v_prazo_str := to_char(CURRENT_DATE + INTERVAL '7 days', 'DD/MM/YYYY');

  -- Lista limpa: "• Estabelecimento — R$ valor" (maiores primeiro), 1 por linha, sem regra/motivo.
  SELECT string_agg('• ' || estab || ' — R$ ' || fmt_brl(valor), E'\n' ORDER BY valor DESC)
  INTO v_body
  FROM (
    SELECT
      CASE
        WHEN c.estabelecimento IS NULL OR c.estabelecimento = '' THEN
          coalesce(nullif(c.descricao_original, ''), split_part(a.titulo, ' R$', 1))
        WHEN c.estabelecimento ILIKE '%não identificado%' THEN
          coalesce(nullif(c.descricao_original, ''), c.estabelecimento)
        ELSE c.estabelecimento
      END AS estab, a.valor
    FROM auditoria a
    LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
    WHERE a.responsavel = p_responsavel
      AND a.status = 'Pendente'
      AND (p_competencia IS NULL OR a.competencia = p_competencia)
    ORDER BY a.valor DESC
    LIMIT v_limite
  ) x;

  IF v_qtd > v_limite THEN
    v_formato := 'hibrido';
    v_body := v_body || E'\n' || '• …e mais ' || (v_qtd - v_limite) || ' pendências';
  ELSE
    v_formato := 'lista';
  END IF;

  v_mensagem :=
    'Eiei, ' || coalesce(v_primeiro, 'líder') || '! 👋👋' || E'\n\n' ||
    'A auditoria do cartão corporativo identificou ' || v_qtd ||
    ' pendências no total de R$ ' || fmt_brl(v_total) || ':' || E'\n\n' ||
    '📋 Pendências' || E'\n' ||
    v_body || E'\n\n' ||
    '🔗 Acesse para anexar comprovantes e justificar:' || E'\n' ||
    hub_base_url() || '/l/{{TOKEN}}' || E'\n\n' ||
    'O link é individual e não deve ser compartilhado. Expira em 7 dias.' || E'\n' ||
    'Prazo para resposta: ' || v_prazo_str || E'\n\n' ||
    'Obrigada!';

  RETURN jsonb_build_object(
    'responsavel', p_responsavel,
    'colaborador_id', v_col_id,
    'colaborador_nome', v_col_nome,
    'match_type', v_col_match,
    'telefone', v_col_tel,
    'telefone_ok', (length(v_dig) >= 10),
    'qtd_itens', v_qtd,
    'valor_total', v_total,
    'formato', v_formato,
    'competencia', v_comp_str,
    'id_unicos', v_id_unicos,
    'itens', v_pendencias,
    'mensagem', v_mensagem,
    'prazo', v_prazo_str
  );
END;
$function$;
