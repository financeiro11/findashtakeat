
CREATE OR REPLACE FUNCTION public.preview_msg_consolidada(p_responsavel text, p_competencia date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pendencias    jsonb;
  v_qtd           int;
  v_total         numeric;
  v_id_unicos     jsonb;
  v_col_id        uuid;
  v_col_nome      text;
  v_col_tel       text;
  v_col_match     text;
  v_primeiro      text;
  v_dig           text;
  v_mensagem      text;
  v_body          text := '';
  v_breakdown     text := '';
  v_top3          text := '';
  v_formato       text;
  v_meses         text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho',
                                  'julho','agosto','setembro','outubro','novembro','dezembro'];
  v_comp_str      text;
  v_prazo_str     text;
  r               record;
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

  SELECT string_agg(
           '• ' || contagem || ' ' || regra || ' — R$ ' || fmt_brl(soma),
           E'\n' ORDER BY soma DESC
         )
  INTO v_breakdown
  FROM (
    SELECT a.regra, count(*)::int AS contagem, sum(a.valor) AS soma
    FROM auditoria a
    WHERE a.responsavel = p_responsavel
      AND a.status = 'Pendente'
      AND (p_competencia IS NULL OR a.competencia = p_competencia)
    GROUP BY a.regra
  ) x;

  IF v_qtd <= 20 THEN
    v_formato := 'lista';
    FOR r IN
      SELECT
        CASE
          WHEN c.estabelecimento IS NULL OR c.estabelecimento = '' THEN
            coalesce(nullif(c.descricao_original, ''), split_part(a.titulo, ' R$', 1))
          WHEN c.estabelecimento ILIKE '%não identificado%' THEN
            coalesce(nullif(c.descricao_original, ''), c.estabelecimento)
          ELSE c.estabelecimento
        END AS estab, a.valor, a.regra
      FROM auditoria a
      LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
      WHERE a.responsavel = p_responsavel
        AND a.status = 'Pendente'
        AND (p_competencia IS NULL OR a.competencia = p_competencia)
      ORDER BY a.valor DESC
    LOOP
      v_body := v_body || '- ' || r.estab || ' R$ ' || fmt_brl(r.valor) || ' (' || r.regra || ')' || E'\n';
    END LOOP;
  ELSE
    v_formato := 'hibrido';
    SELECT string_agg(
             '- ' || estab || ' R$ ' || fmt_brl(valor) || ' (' || regra || ')',
             E'\n' ORDER BY valor DESC
           )
    INTO v_top3
    FROM (
      SELECT
        CASE
          WHEN c.estabelecimento IS NULL OR c.estabelecimento = '' THEN
            coalesce(nullif(c.descricao_original, ''), split_part(a.titulo, ' R$', 1))
          WHEN c.estabelecimento ILIKE '%não identificado%' THEN
            coalesce(nullif(c.descricao_original, ''), c.estabelecimento)
          ELSE c.estabelecimento
        END AS estab, a.valor, a.regra
      FROM auditoria a
      LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
      WHERE a.responsavel = p_responsavel
        AND a.status = 'Pendente'
        AND (p_competencia IS NULL OR a.competencia = p_competencia)
      ORDER BY a.valor DESC LIMIT 3
    ) top;
    v_body := v_breakdown || E'\n\nOs 3 maiores valores:\n' || v_top3;
  END IF;

  v_mensagem :=
    'Oi, ' || coalesce(v_primeiro, 'líder') || '! 👋' || E'\n\n' ||
    'A auditoria do cartão corporativo (' || v_comp_str || ') identificou ' ||
    v_qtd || ' pendências suas, totalizando R$ ' || fmt_brl(v_total) || ':' || E'\n\n' ||
    CASE WHEN v_formato = 'lista' THEN v_breakdown || E'\n\n' ELSE '' END ||
    v_body || E'\n\n' ||
    '🔗 Acesse pra anexar comprovantes e justificar:' || E'\n' ||
    hub_base_url() || '/l/{{TOKEN}}' || E'\n\n' ||
    'O link é seu — não compartilhe. Expira em 7 dias.' || E'\n' ||
    'Prazo pra resposta: ' || v_prazo_str || E'\n\n' ||
    'Obrigado!';

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
