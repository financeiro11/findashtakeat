-- A fatura do líder mostrava só de agosto/26 pra frente.
--
-- O corte (`competencia >= '2026-08-01'`) nasceu em 31/08 junto com a aba, e a razão
-- escrita na época era outra: NÃO dava para deduzir o dono do gasto pelo estabelecimento
-- (só 51,8% dos lançamentos têm dono único), então não se queria inventar histórico.
-- Só que o corte não separa "deduzido" de "atribuído": ele apagava também junho/26, que
-- a analista rateou à mão, cartão por cartão — 500 linhas com `card_final` preenchido.
--
-- O efeito na tela: o Luiz (final 1020) abria o link e via 3 lançamentos / R$ 380,99,
-- embaixo da frase "aqui está tudo o que passou no seu cartão". Tinha mais 10 linhas de
-- junho guardadas, com dono, escondidas por uma data fixa. Vale para todos: a Thais ia de
-- 27 para 81 linhas, o Miguel de 79 para 435.
--
-- Agora a fatura mostra TODA competência que o extrato atribui ao cartão. O que continua
-- de fora é o que ninguém atribuiu — e isso passa a ser dito na cara em vez de virar um
-- buraco silencioso entre junho e agosto: `meses_sem_rateio` lista as competências que
-- existem no extrato (`cartao_lancamentos`) e ainda não têm uma única linha com dono.
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
    GROUP BY c.competencia
  ) meses;

  SELECT jsonb_build_object(
    'lancamentos', count(*),
    'total', coalesce(sum(c.valor), 0),
    'pendentes', count(*) FILTER (
      WHERE coalesce(c.link_comprovante, '') = ''
        AND c.status_nf NOT IN ('OK', 'ENCARGO', 'DISPENSADO (<piso)', 'SEM NF-ESPERADO', 'PARCELA (origem)')),
    'com_comprovante', count(*) FILTER (WHERE coalesce(c.link_comprovante, '') <> ''),
    'meses', count(DISTINCT c.competencia)
  )
  INTO v_resumo
  FROM auditoria_cartao_lancamentos c
  WHERE c.card_final = v_row.card_final;

  -- Competências que a fatura consolidada tem e o rateio por cartão ainda não alcançou.
  -- Não é sobre ESTE cartão: nenhum líder vê esses meses, porque nenhuma linha deles tem
  -- dono. Dizer isso é mais honesto do que deixar um vão entre dois meses na página.
  SELECT jsonb_agg(to_char(f.competencia, 'MM/YYYY') ORDER BY f.competencia)
  INTO v_sem_rate
  FROM (SELECT DISTINCT competencia FROM cartao_lancamentos) f
  WHERE NOT EXISTS (
    SELECT 1 FROM auditoria_cartao_lancamentos c
    WHERE c.competencia = f.competencia AND c.card_final IS NOT NULL
  );

  RETURN jsonb_build_object(
    'responsavel', v_nome,
    'card_final', v_row.card_final,
    'encerrando', coalesce((v_acesso->>'encerrando')::boolean, false),
    'acesso_ate', v_acesso->>'acesso_ate',
    'resumo', v_resumo,
    'meses', coalesce(v_meses, '[]'::jsonb),
    'meses_sem_rateio', coalesce(v_sem_rate, '[]'::jsonb)
  );
END;
$function$;

-- Sem isto o `anon` perde o EXECUTE no `CREATE OR REPLACE` — [[supabase-grant-anon-automatico]].
REVOKE ALL ON FUNCTION public.resolver_fatura_via_token(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolver_fatura_via_token(text, text, text) TO anon, authenticated;
