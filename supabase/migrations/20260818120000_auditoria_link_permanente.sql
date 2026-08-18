-- Auditoria · link público do líder: permanente e único por pessoa.
--
-- Antes: cada envio de WhatsApp criava um token novo com validade de 7 dias. Passado
-- o prazo o líder abria o link e via "Link expirado", e cada cobrança nova gerava
-- outra URL — o líder acumulava links mortos na conversa.
--
-- Agora:
--   • `expira_em` passa a aceitar NULL = link sem prazo.
--   • `criar_token_e_registrar` REAPROVEITA o token que o líder já tem (casa por
--     colaborador_id ou pelo nome) e só acrescenta as pendências novas ao mesmo link.
--     Só cria token quando o líder ainda não tem nenhum.
--   • `resolver_token` / `validar_token_para_id_unico` só cobram prazo quando existe um.
--   • As mensagens de WhatsApp deixam de prometer 7 dias.
--
-- E `registrar_comprovante_via_token` passa a fazer o MESMO que o anexo pelo Hub faz
-- (src/lib/anexarComprovante.ts): marcar o achado como "COM NF" e espelhar na Base do
-- Cartão. Sem isso o comprovante que o líder mandava chegava no Hub mas o lançamento
-- continuava aparecendo como SEM NF nos chips e KPIs das duas telas.

-- ---------------------------------------------------------------------------
-- 1) Link sem prazo
-- ---------------------------------------------------------------------------
ALTER TABLE public.magic_tokens ALTER COLUMN expira_em DROP NOT NULL;

COMMENT ON COLUMN public.magic_tokens.expira_em IS
  'NULL = link sem prazo (padrão desde 08/2026). Data preenchida ainda é respeitada.';

-- ---------------------------------------------------------------------------
-- 2) Um token por líder, reaproveitado a cada cobrança
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_token_e_registrar(
  p_responsavel     text,
  p_id_unicos       jsonb,
  p_colaborador_id  uuid DEFAULT NULL::uuid,
  p_telefone        text DEFAULT NULL::text,
  p_criado_por      text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token   text;
  v_ids     jsonb;
  v_qtd     int;
  v_total   numeric;
BEGIN
  -- Os id_unicos pedidos precisam existir de fato na auditoria.
  SELECT count(*)::int
  INTO v_qtd
  FROM auditoria a
  WHERE a.id_unico IN (SELECT jsonb_array_elements_text(p_id_unicos));

  IF v_qtd = 0 THEN
    RAISE EXCEPTION 'Nenhum lançamento válido nos id_unicos fornecidos';
  END IF;

  -- O link é um só por líder: procura o que ele já tem. Casa pelo colaborador
  -- quando o cadastro resolveu a pessoa, senão pelo nome como veio da auditoria
  -- (é comum o mesmo líder aparecer como "Henrique Anjos" e "Henrique dos Anjos").
  SELECT t.token
  INTO v_token
  FROM magic_tokens t
  WHERE t.status <> 'revogado'
    AND (
      (p_colaborador_id IS NOT NULL AND t.colaborador_id = p_colaborador_id)
      OR lower(t.responsavel) = lower(p_responsavel)
    )
  ORDER BY t.criado_em DESC
  LIMIT 1;

  IF v_token IS NOT NULL THEN
    -- Acrescenta as pendências novas às que o link já cobria. Nunca tira: o líder
    -- pode voltar num item antigo, e o histórico dele fica no mesmo lugar.
    SELECT coalesce(jsonb_agg(DISTINCT u.id), '[]'::jsonb)
    INTO v_ids
    FROM (
      SELECT jsonb_array_elements_text(t.id_unicos) AS id FROM magic_tokens t WHERE t.token = v_token
      UNION
      SELECT jsonb_array_elements_text(p_id_unicos)
    ) u;
  ELSE
    v_ids := p_id_unicos;
  END IF;

  SELECT count(*)::int, coalesce(sum(a.valor), 0)
  INTO v_qtd, v_total
  FROM auditoria a
  WHERE a.id_unico IN (SELECT jsonb_array_elements_text(v_ids));

  IF v_token IS NULL THEN
    v_token := substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 16);

    INSERT INTO magic_tokens (
      token, responsavel, colaborador_id, id_unicos, qtd_itens, valor_total,
      expira_em, criado_por, enviado_para
    ) VALUES (
      v_token, p_responsavel, p_colaborador_id, v_ids, v_qtd, v_total,
      NULL, p_criado_por, p_telefone
    );
  ELSE
    UPDATE magic_tokens t
    SET responsavel    = p_responsavel,
        colaborador_id = coalesce(p_colaborador_id, t.colaborador_id),
        id_unicos      = v_ids,
        qtd_itens      = v_qtd,
        valor_total    = v_total,
        expira_em      = NULL,          -- reativa link antigo que tinha morrido no prazo
        status         = 'ativo',
        criado_por     = coalesce(p_criado_por, t.criado_por),
        enviado_para   = coalesce(p_telefone, t.enviado_para)
    WHERE t.token = v_token;
  END IF;

  RETURN jsonb_build_object(
    'token', v_token,
    'url', hub_base_url() || '/l/' || v_token,
    'qtd_itens', v_qtd,
    'valor_total', v_total,
    'expira_em', NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Prazo só é cobrado quando existe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validar_token_para_id_unico(p_token text, p_id_unico text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row magic_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_row.status <> 'ativo' THEN RETURN false; END IF;
  IF v_row.expira_em IS NOT NULL AND v_row.expira_em < now() THEN RETURN false; END IF;
  RETURN v_row.id_unicos ? p_id_unico;
END;
$function$;

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
BEGIN
  SELECT * INTO v_row FROM magic_tokens WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Token inválido');
  END IF;

  IF v_row.status = 'revogado' THEN
    RETURN jsonb_build_object('erro', 'Este link foi revogado');
  END IF;

  IF v_row.expira_em IS NOT NULL AND v_row.expira_em < now() THEN
    UPDATE magic_tokens SET status = 'expirado' WHERE token = p_token;
    RETURN jsonb_build_object('erro', 'Link expirado. Fale com o financeiro pra receber um novo.');
  END IF;

  UPDATE magic_tokens
  SET acessos = acessos + 1, ultimo_acesso = now(), ip_ultimo_acesso = p_ip
  WHERE token = p_token;

  -- Pendentes primeiro, resolvidas no fim: como o link é permanente e vai juntando
  -- competências, o que falta resolver precisa estar no topo da página.
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
    'justificativa', a.justificativa,
    'resolvido', (a.link_comprovante IS NOT NULL OR a.justificativa IS NOT NULL)
  ) ORDER BY (a.link_comprovante IS NOT NULL OR a.justificativa IS NOT NULL), a.valor DESC),
  count(*)::int,
  coalesce(sum(a.valor), 0)
  INTO v_itens, v_qtd, v_total
  FROM auditoria a
  LEFT JOIN auditoria_cartao_lancamentos c ON c.id_unico = a.id_transacao
  WHERE a.id_unico IN (SELECT jsonb_array_elements_text(v_row.id_unicos));

  RETURN jsonb_build_object(
    'responsavel', v_row.responsavel,
    -- Contadores vêm dos itens que existem hoje, não do que ficou congelado na linha:
    -- o link é permanente e o conjunto muda a cada cobrança nova.
    'qtd_itens', coalesce(v_qtd, 0),
    'valor_total', coalesce(v_total, 0),
    'expira_em', CASE WHEN v_row.expira_em IS NULL THEN NULL
                      ELSE to_char(v_row.expira_em, 'DD/MM/YYYY') END,
    'acessos', v_row.acessos + 1,
    'itens', coalesce(v_itens, '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Comprovante do líder cai no Hub igual ao anexo feito pelo Hub
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_comprovante_via_token(
  p_token text, p_id_unico text, p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_valido    boolean;
  v_evento    jsonb;
  v_arquivo   text;
  v_id_transacao text;
BEGIN
  v_valido := validar_token_para_id_unico(p_token, p_id_unico);
  IF NOT v_valido THEN
    RETURN jsonb_build_object('erro', 'Token inválido, expirado ou não cobre este lançamento');
  END IF;

  -- O path é "{token}/{id_unico}/{timestamp}_{nome}" — o nome original é o que
  -- interessa mostrar na Base do Cartão.
  v_arquivo := regexp_replace(split_part(p_storage_path, '/', -1), '^\d+_', '');

  v_evento := jsonb_build_object(
    'evento', 'comprovante_anexado',
    'canal', 'link_publico',
    'token', p_token,
    'storage_path', p_storage_path,
    'arquivo', v_arquivo,
    'timestamp', now()
  );

  UPDATE auditoria
  SET link_comprovante = p_storage_path,
      categoria = 'COM NF',
      status = 'Em análise',
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(v_evento),
      updated_at = now()
  WHERE id_unico = p_id_unico
  RETURNING id_transacao INTO v_id_transacao;

  -- Espelha na Base do Cartão: é o mesmo gasto visto do outro lado, e deixar só um
  -- atualizado faz a outra tela seguir cobrando uma NF que já chegou.
  IF v_id_transacao IS NOT NULL THEN
    UPDATE auditoria_cartao_lancamentos
    SET status_nf = 'OK',
        link_comprovante = p_storage_path,
        arquivo_comprovante = v_arquivo,
        updated_at = now()
    WHERE id_unico = v_id_transacao;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'Em análise', 'path', p_storage_path);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) As mensagens não prometem mais 7 dias
--    (as duas sobrecargas de preview_msg_consolidada seguem existindo — o front em
--     produção chama a de 2 argumentos, mas a de 1 continua em uso)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_msg_consolidada(p_responsavel text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN preview_msg_consolidada(p_responsavel, NULL::date);
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
    'Este link é seu e não expira — pode salvar e voltar nele sempre que precisar. Só não compartilhe.' || E'\n' ||
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

-- preview_msg_ajuste: mesma troca de frase, resto intacto.
CREATE OR REPLACE FUNCTION public.preview_msg_ajuste(p_id_unico text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row          auditoria%ROWTYPE;
  v_cartao       auditoria_cartao_lancamentos%ROWTYPE;
  v_gestor_id    uuid;
  v_gestor_nome  text;
  v_gestor_tel   text;
  v_tel_fallback text;
  v_telefone     text;
  v_primeiro     text;
  v_primeiro_gestor text;
  v_primeiro_resp text;
  v_dig          text;
  v_cta          text;
  v_exige_nf     boolean;
  v_bloco_parc   text := '';
  v_bloco_obs    text := '';
  v_bloco_nf     text := '';
  v_linha_resp   text := '';
  v_mensagem     text;
  v_comp_str     text;
  v_data_str     text;
  v_estab        text;
  v_categoria    text;
  v_time         text;
  v_observacao   text;
  v_cartao_fin   text;
  v_parcela      text;
  v_meses        text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho',
                                 'julho','agosto','setembro','outubro','novembro','dezembro'];
BEGIN
  SELECT * INTO v_row FROM auditoria WHERE id_unico = p_id_unico;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento % não encontrado', p_id_unico;
  END IF;

  IF v_row.id_transacao IS NOT NULL THEN
    SELECT * INTO v_cartao
    FROM auditoria_cartao_lancamentos
    WHERE id_unico = v_row.id_transacao
       OR referencia = v_row.id_transacao
    LIMIT 1;
  END IF;

  SELECT d.gestor_id, d.telefone_whatsapp
  INTO v_gestor_id, v_tel_fallback
  FROM lib_departamentos d
  WHERE lower(d.nome) = lower(coalesce(v_row.area, ''))
  LIMIT 1;

  IF v_gestor_id IS NOT NULL THEN
    SELECT nome, telefone
    INTO v_gestor_nome, v_gestor_tel
    FROM lib_colaboradores
    WHERE id = v_gestor_id;
  END IF;

  v_telefone := coalesce(v_gestor_tel, v_tel_fallback);

  v_primeiro_gestor := nullif(split_part(coalesce(v_gestor_nome, ''), ' ', 1), '');
  v_primeiro_resp   := nullif(split_part(coalesce(v_row.responsavel, ''), ' ', 1), '');
  v_primeiro        := coalesce(v_primeiro_gestor, v_primeiro_resp);

  v_dig := regexp_replace(coalesce(v_telefone, ''), '\D', '', 'g');

  v_estab := CASE
    WHEN v_cartao.estabelecimento IS NULL OR v_cartao.estabelecimento = '' THEN
      coalesce(nullif(v_cartao.descricao_original, ''), split_part(coalesce(v_row.titulo, ''), ' R$', 1), '—')
    WHEN v_cartao.estabelecimento ILIKE '%outros%não identificado%'
      OR v_cartao.estabelecimento ILIKE '%não identificado%' THEN
      coalesce(nullif(v_cartao.descricao_original, ''), v_cartao.estabelecimento)
    ELSE v_cartao.estabelecimento
  END;

  v_categoria  := coalesce(nullif(v_cartao.categoria, ''), nullif(v_row.categoria, ''), '—');
  v_time       := nullif(v_cartao.time, '');
  v_cartao_fin := nullif(v_cartao.card_final, '');
  v_parcela    := nullif(v_cartao.parcela, '');

  v_observacao := nullif(v_cartao.observacao, '');
  IF v_observacao IS NOT NULL AND
     v_observacao ~* '^(cobrar |pendente de |verificar com |aguardando |solicitar |acompanhar )'
  THEN
    v_observacao := NULL;
  END IF;

  v_comp_str := v_meses[EXTRACT(MONTH FROM v_row.competencia)::int] || '/'
                || EXTRACT(YEAR FROM v_row.competencia)::text;

  v_data_str := CASE
    WHEN v_cartao.data IS NOT NULL THEN to_char(v_cartao.data, 'DD/MM/YYYY')
    WHEN v_row.data_lancamento IS NOT NULL THEN to_char(v_row.data_lancamento, 'DD/MM/YYYY')
    ELSE '—'
  END;

  v_cta := CASE v_row.regra
    WHEN 'SEM NF' THEN 'Este gasto está sem NF/comprovante fiscal anexado. Precisamos da nota para fechar a auditoria.'
    WHEN 'NF ILEGÍVEL' THEN 'O comprovante anexado está ilegível/incompleto. Poderia reenviar uma versão nítida?'
    WHEN 'NF DIVERGENTE' THEN 'O valor da NF anexada não bate com o valor do cartão. Poderia conferir e reenviar a NF correta?'
    WHEN 'FORA ESCOPO' THEN 'Este gasto ficou fora do escopo do time ' || coalesce(v_time, v_row.area) || '. Poderia justificar a necessidade e informar quem aprovou?'
    WHEN 'CONFERIR (passagem/hosp.)' THEN 'Temos comprovante, mas o valor cheio não bate com o parcelamento. Poderia confirmar se é a 1ª de ' || coalesce(v_parcela, '?') || ' e o valor total contratado?'
    WHEN 'CATEGORIA SUSPEITA' THEN 'A categoria automática ficou como "' || coalesce(v_categoria, '?') || '". Poderia confirmar se está correta ou indicar a certa?'
    WHEN 'VALOR ACIMA DO LIMITE' THEN 'Valor acima do teto padrão do time. Poderia justificar e informar se houve pré-aprovação?'
    ELSE 'Poderia justificar/complementar esta pendência?'
  END;

  v_exige_nf := v_row.regra IN ('SEM NF', 'NF ILEGÍVEL', 'NF DIVERGENTE');

  IF v_parcela IS NOT NULL THEN
    v_bloco_parc := ' — parcela ' || v_parcela;
  END IF;

  IF v_observacao IS NOT NULL THEN
    v_bloco_obs := E'\n- Observação: ' || v_observacao;
  END IF;

  IF v_exige_nf THEN
    v_bloco_nf := E'\n\n📎 Como enviar a NF:\n1. Anexe a NF/comprovante fiscal no hub (botão "Enviar comprovante")\n2. Formatos aceitos: PDF, JPG, PNG\n3. Se não houver NF possível (ex: reembolso, taxa, adiantamento), justifique por escrito no campo de observação e envie algum tipo de comprovação (invoice, recibo ou print)';
  END IF;

  IF v_primeiro_resp IS NOT NULL AND NOT (
     v_gestor_id IS NOT NULL
     AND v_primeiro_gestor IS NOT NULL
     AND lower(v_primeiro_gestor) = lower(v_primeiro_resp)
  ) THEN
    v_linha_resp := E'\n- Responsável: ' || v_row.responsavel ||
      CASE WHEN v_time IS NOT NULL THEN ' (' || v_time || ')' ELSE '' END;
  END IF;

  v_mensagem :=
    'Oi, ' || coalesce(v_primeiro, 'líder') || '! 👋' || E'\n\n' ||
    'Auditoria do cartão corporativo (' || v_comp_str || ') identificou uma pendência sob sua alçada:' || E'\n\n' ||
    '- Estabelecimento: ' || v_estab || E'\n' ||
    '- Valor: R$ ' || fmt_brl(coalesce(v_row.valor, 0)) || v_bloco_parc || E'\n' ||
    '- Data: ' || v_data_str ||
      CASE WHEN v_cartao_fin IS NOT NULL THEN ' — cartão final ' || v_cartao_fin ELSE '' END ||
    v_linha_resp || E'\n' ||
    '- Categoria: ' || v_categoria || E'\n' ||
    '- Motivo: ' || coalesce(v_row.regra, '—') ||
    v_bloco_obs || E'\n\n' ||
    v_cta || v_bloco_nf || E'\n\n' ||
    '🔗 Acesse pra anexar comprovante e justificar:' || E'\n' ||
    hub_base_url() || '/l/{{TOKEN}}' || E'\n\n' ||
    'Este link é seu e não expira — pode salvar e voltar nele sempre que precisar. Só não compartilhe.' || E'\n' ||
    'Prazo: ' || to_char(CURRENT_DATE + INTERVAL '3 days', 'DD/MM/YYYY') || E'\n\n' ||
    'Obrigado!';

  RETURN jsonb_build_object(
    'id_unico', v_row.id_unico,
    'id_unicos', jsonb_build_array(v_row.id_unico),
    'colaborador_id', v_gestor_id,
    'telefone', v_telefone,
    'gestor_nome', coalesce(v_gestor_nome, v_row.responsavel, ''),
    'primeiro_nome', coalesce(v_primeiro, ''),
    'area', v_row.area,
    'mensagem', v_mensagem,
    'exige_nf', v_exige_nf,
    'telefone_ok', (length(v_dig) >= 10)
  );
END;
$function$;
