-- "Minha fatura" passa a ser a fatura, e não o recorte da auditoria.
--
-- Duas coisas, e a ORDEM entre elas importa:
--
-- 1. `A CLASSIFICAR` — o status das linhas que vêm do PDF da fatura e que o financeiro
--    ainda não analisou. A aba "Precisam de resposta" é o que a auditoria decidiu cobrar;
--    "Minha fatura" é tudo o que passou no cartão da pessoa. São recortes diferentes de
--    propósito: nem todo gasto vai precisar de comprovante, e essa decisão continua sendo
--    da análise. Sem este status, as 345 linhas de agosto cairiam no `ELSE` do CASE e
--    nasceriam todas como "Falta a nota fiscal" — uma cobrança em massa que ninguém pediu.
--    Por isso esta migration vem ANTES da carga.
--
-- 2. A comparação com o mês anterior, por categoria. O "anterior" é a competência
--    anterior QUE ESTE CARTÃO TEM, não a do calendário: quem só tem junho e agosto compara
--    agosto com junho, e a resposta diz com quem comparou para ninguém ler "mês passado"
--    achando que é julho.
CREATE OR REPLACE FUNCTION public.resolver_fatura_via_token(
  p_token text, p_digitos text, p_ip text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row      magic_tokens%ROWTYPE;
  v_digitos  text;
  v_acesso   jsonb;
  v_nome     text;
  v_meses    jsonb;
  v_resumo   jsonb;
  v_sem_rate jsonb;
  v_cartao   text;
  v_cmp      jsonb;
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

  v_cartao := v_row.card_final;

  /* ---------------------------------------------------------------- *
   *  Comparação por categoria: o mês contra a competência anterior
   *  DESTE cartão. Só entra categoria que tem valor num dos dois lados.
   * ---------------------------------------------------------------- */
  WITH porcat AS (
    SELECT c.competencia,
           coalesce(nullif(btrim(c.categoria), ''), 'Sem categoria') AS cat,
           sum(c.valor) AS tot
    FROM auditoria_cartao_lancamentos c
    WHERE c.card_final = v_cartao
    GROUP BY 1, 2
  ),
  -- A competência anterior é a anterior QUE EXISTE, não a do calendário.
  liga AS (
    SELECT competencia, lag(competencia) OVER (ORDER BY competencia) AS anterior
    FROM (SELECT DISTINCT competencia FROM porcat) m
  ),
  -- A grade tem toda categoria que aparece no mês OU no anterior: sem isso, o que sumiu
  -- de um mês para o outro não teria linha e a queda ficaria invisível.
  grade AS (
    SELECT l.competencia, l.anterior, p.cat
    FROM liga l
    JOIN porcat p ON p.competencia = l.competencia OR p.competencia = l.anterior
    GROUP BY 1, 2, 3
  ),
  cheia AS (
    SELECT g.competencia, g.anterior, g.cat,
           coalesce(cur.tot, 0) AS tot,
           coalesce(ant.tot, 0) AS ant
    FROM grade g
    LEFT JOIN porcat cur ON cur.competencia = g.competencia AND cur.cat = g.cat
    LEFT JOIN porcat ant ON ant.competencia = g.anterior     AND ant.cat = g.cat
  )
  SELECT jsonb_object_agg(chave, bloco)
  INTO v_cmp
  FROM (
    SELECT to_char(f.competencia, 'YYYY-MM-DD') AS chave,
           jsonb_build_object(
             'anterior', to_char(max(f.anterior), 'YYYY-MM-DD'),
             'total', sum(f.tot),
             'total_anterior', sum(f.ant),
             'categorias', jsonb_agg(
               jsonb_build_object('categoria', f.cat, 'total', f.tot, 'anterior', f.ant)
               ORDER BY abs(f.tot - f.ant) DESC)
           ) AS bloco
    FROM cheia f
    WHERE f.tot <> 0 OR f.ant <> 0
    GROUP BY f.competencia
  ) q;

  SELECT jsonb_agg(m ORDER BY (m->>'competencia') DESC)
  INTO v_meses
  FROM (
    SELECT jsonb_build_object(
      'competencia', to_char(c.competencia, 'YYYY-MM-DD'),
      'label', to_char(c.competencia, 'MM/YYYY'),
      'total', sum(c.valor),
      'comparacao', v_cmp -> to_char(c.competencia, 'YYYY-MM-DD'),
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
        'justificativa', coalesce(c.justificativa_lider, a.justificativa),
        'nota_interna', CASE
          WHEN c.observacao ~* '^(cobrar |pendente de |verificar com |aguardando |solicitar |acompanhar )'
            THEN NULL
          ELSE nullif(btrim(coalesce(c.observacao, '')), '')
        END,
        'situacao', CASE
          WHEN coalesce(c.link_comprovante, '') <> '' OR c.status_nf = 'OK' THEN 'ok'
          -- Veio da fatura e a auditoria ainda não olhou: aparece, dá para anexar, e não cobra.
          WHEN c.status_nf = 'A CLASSIFICAR' THEN 'aberto'
          WHEN c.status_nf IN ('ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO', 'PARCELA (origem)')
            THEN 'dispensado'
          ELSE 'pendente'
        END,
        'motivo', CASE c.status_nf
          WHEN 'OK'                        THEN NULL
          WHEN 'A CLASSIFICAR'             THEN NULL
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
    WHERE c.card_final = v_cartao
    GROUP BY c.competencia
  ) meses;

  SELECT jsonb_build_object(
    'lancamentos', count(*),
    'total', coalesce(sum(c.valor), 0),
    -- `A CLASSIFICAR` fora da conta: "Falta você" é o que a auditoria cobrou.
    'pendentes', count(*) FILTER (
      WHERE coalesce(c.link_comprovante, '') = ''
        AND c.status_nf NOT IN ('OK', 'ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO',
                                'PARCELA (origem)', 'A CLASSIFICAR')),
    'com_comprovante', count(*) FILTER (WHERE coalesce(c.link_comprovante, '') <> ''),
    'meses', count(DISTINCT c.competencia)
  )
  INTO v_resumo
  FROM auditoria_cartao_lancamentos c
  WHERE c.card_final = v_cartao;

  SELECT jsonb_agg(to_char(f.competencia, 'MM/YYYY') ORDER BY f.competencia)
  INTO v_sem_rate
  FROM (SELECT DISTINCT competencia FROM cartao_lancamentos) f
  WHERE NOT EXISTS (
    SELECT 1 FROM auditoria_cartao_lancamentos c
    WHERE c.competencia = f.competencia AND c.card_final IS NOT NULL
  );

  RETURN jsonb_build_object(
    'responsavel', v_nome,
    'card_final', v_cartao,
    'encerrando', coalesce((v_acesso->>'encerrando')::boolean, false),
    'acesso_ate', v_acesso->>'acesso_ate',
    'resumo', v_resumo,
    'meses', coalesce(v_meses, '[]'::jsonb),
    'meses_sem_rateio', coalesce(v_sem_rate, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolver_fatura_via_token(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolver_fatura_via_token(text, text, text) TO anon, authenticated;
