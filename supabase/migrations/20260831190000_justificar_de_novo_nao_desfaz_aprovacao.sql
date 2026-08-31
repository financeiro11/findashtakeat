-- Justificar um gasto já aprovado não pode desfazer a aprovação.
--
-- `salvar_justificativa_via_token` gravava `status = 'Em análise'` sem olhar o status
-- anterior. Isso era inofensivo enquanto o líder só via as pendências cobradas — o que
-- estava no link dele era, por construção, coisa em aberto.
--
-- Deixou de ser: com a aba da fatura, ele alcança QUALQUER linha do cartão, inclusive as
-- já aprovadas pelo financeiro. Um líder que resolvesse complementar a explicação de um
-- gasto aprovado jogava a linha de volta para "Em análise", e o trabalho de conferência
-- teria de ser refeito — sem erro, sem aviso, e sem ninguém entender por quê.
-- Apareceu num teste: dois achados 'Aprovado' voltaram para 'Em análise' só de eu
-- exercitar a função.
--
-- Agora vale a mesma regra que `fatura_justificar_via_token` já usava: só quem está
-- 'Pendente' anda para 'Em análise'. Aprovado, Reprovado e Ajuste solicitado ficam onde
-- estão — a justificativa entra e a trilha registra, mas quem move o status é gente.

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
  v_status text;
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
      status = CASE WHEN status = 'Pendente' THEN 'Em análise' ELSE status END,
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(v_evento),
      updated_at = now()
  WHERE id_unico = p_id_unico
  RETURNING status INTO v_status;

  v_alvo := lancamento_do_achado(p_id_unico);
  IF v_alvo IS NOT NULL THEN
    UPDATE auditoria_cartao_lancamentos
    SET justificativa_lider = p_texto, justificativa_lider_em = now(), updated_at = now()
    WHERE id_unico = v_alvo;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', coalesce(v_status, 'Em análise'));
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_justificativa_via_token(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_justificativa_via_token(text, text, text) TO anon, authenticated;
