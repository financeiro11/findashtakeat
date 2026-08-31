-- As duas abas do /l/<token> passam a falar da MESMA linha.
--
-- O pedido era "anexar numa aba já confirma na outra, instantaneamente". Ao conferir,
-- descobri que o problema é mais fundo que a tela: **a ligação entre o achado e a linha da
-- fatura quase não existe**. `auditoria.id_transacao` — a chave que todo o espelhamento
-- usa — está preenchida em **79 de 336 achados de cartão (23%)**. Nos outros 77% o
-- `UPDATE ... WHERE id_transacao = ...` não encontra linha nenhuma e falha em silêncio:
-- ninguém vê erro, e a outra aba segue cobrando o que já foi respondido.
--
-- Dos 257 órfãos:
--   • 127 têm **exatamente um** lançamento com a mesma data e o mesmo valor → religáveis;
--     126 deles são de ago/26, justamente o mês que a fatura mostra.
--   •  11 são ambíguos de verdade (mesmo dia, mesmo valor, dois lançamentos) → não toco.
--   • 119 são de **julho**, mês que tem achado em `auditoria` mas não existe em
--     `auditoria_cartao_lancamentos`. Não há linha para ligar, e nem deveria haver: a
--     fatura começa em agosto de propósito.
--
-- A chave data + valor em centavos é a mesma que `auditoria_lojistas` (20260819120000) já
-- usa e mediu. Aqui ela só religa quando o candidato é ÚNICO — chave que casa com dois
-- lançamentos não vira palpite.

-- ---------------------------------------------------------------------------
-- 1) Religar o que dá para religar
-- ---------------------------------------------------------------------------
WITH um_so AS (
  SELECT a.id_unico, min(c.id_unico) AS alvo
  FROM auditoria a
  JOIN auditoria_cartao_lancamentos c
    ON c.data = a.data_lancamento
   AND round(abs(c.valor) * 100) = round(abs(a.valor) * 100)
  WHERE a.id_transacao IS NULL
    AND a.origem = 'Cartão'
  GROUP BY a.id_unico
  HAVING count(*) = 1
)
UPDATE auditoria a
SET id_transacao = u.alvo
FROM um_so u
WHERE a.id_unico = u.id_unico;

CREATE INDEX IF NOT EXISTS auditoria_id_transacao_idx ON public.auditoria (id_transacao);
CREATE INDEX IF NOT EXISTS acl_data_valor_idx
  ON public.auditoria_cartao_lancamentos (data, valor);

-- ---------------------------------------------------------------------------
-- 2) Daqui pra frente o espelhamento não depende de a esteira preencher a chave
-- ---------------------------------------------------------------------------
-- Achado → linha da fatura. Usa `id_transacao` quando existe; senão tenta data+valor, e só
-- aceita candidato único. Devolve NULL quando não dá para afirmar — melhor não espelhar do
-- que espelhar na linha errada.
CREATE OR REPLACE FUNCTION public.lancamento_do_achado(p_id_unico text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alvo   text;
  v_quantos int;
BEGIN
  SELECT a.id_transacao INTO v_alvo FROM auditoria a WHERE a.id_unico = p_id_unico;
  IF v_alvo IS NOT NULL THEN RETURN v_alvo; END IF;

  SELECT count(*), min(c.id_unico) INTO v_quantos, v_alvo
  FROM auditoria a
  JOIN auditoria_cartao_lancamentos c
    ON c.data = a.data_lancamento
   AND round(abs(c.valor) * 100) = round(abs(a.valor) * 100)
  WHERE a.id_unico = p_id_unico;

  IF v_quantos = 1 THEN RETURN v_alvo; END IF;
  RETURN NULL;
END;
$function$;

-- Linha da fatura → achado. Mesmo critério, no sentido inverso.
CREATE OR REPLACE FUNCTION public.achado_do_lancamento(p_id_unico text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alvo    text;
  v_quantos int;
BEGIN
  SELECT a.id_unico INTO v_alvo FROM auditoria a WHERE a.id_transacao = p_id_unico LIMIT 1;
  IF v_alvo IS NOT NULL THEN RETURN v_alvo; END IF;

  SELECT count(*), min(a.id_unico) INTO v_quantos, v_alvo
  FROM auditoria_cartao_lancamentos c
  JOIN auditoria a
    ON a.data_lancamento = c.data
   AND round(abs(a.valor) * 100) = round(abs(c.valor) * 100)
   AND a.id_transacao IS NULL
  WHERE c.id_unico = p_id_unico;

  IF v_quantos = 1 THEN RETURN v_alvo; END IF;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) As quatro escritas passam a usar os dois localizadores
-- ---------------------------------------------------------------------------
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
    SET observacao = p_texto, updated_at = now()
    WHERE id_unico = v_alvo;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'Em análise');
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_comprovante_via_token(
  p_token text, p_id_unico text, p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_evento  jsonb;
  v_arquivo text;
  v_alvo    text;
BEGIN
  IF NOT validar_token_para_id_unico(p_token, p_id_unico) THEN
    RETURN jsonb_build_object('erro', 'Token inválido ou não cobre este lançamento');
  END IF;

  v_arquivo := regexp_replace(split_part(p_storage_path, '/', -1), '^\d+_', '');

  v_evento := jsonb_build_object(
    'evento', 'comprovante_anexado', 'canal', 'link_publico', 'token', p_token,
    'storage_path', p_storage_path, 'arquivo', v_arquivo, 'timestamp', now());

  UPDATE auditoria
  SET link_comprovante = p_storage_path,
      categoria = 'COM NF',
      status = 'Em análise',
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(v_evento),
      updated_at = now()
  WHERE id_unico = p_id_unico;

  -- Era `WHERE id_unico = v_id_transacao` com o valor vindo do RETURNING. Nos 77% de
  -- achados sem `id_transacao` isso era um UPDATE em zero linhas, e a fatura seguia
  -- mostrando "falta a nota fiscal" numa linha cuja nota já estava no bucket.
  v_alvo := lancamento_do_achado(p_id_unico);
  IF v_alvo IS NOT NULL THEN
    UPDATE auditoria_cartao_lancamentos
    SET status_nf = 'OK', link_comprovante = p_storage_path,
        arquivo_comprovante = v_arquivo, updated_at = now()
    WHERE id_unico = v_alvo;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'Em análise', 'path', p_storage_path);
END;
$function$;

-- Da fatura para o achado: mesma correção no sentido inverso.
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
  SET observacao = v_texto, updated_at = now()
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

-- ---------------------------------------------------------------------------
-- 4) Portas
-- ---------------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('lancamento_do_achado', 'achado_do_lancamento',
                        'salvar_justificativa_via_token', 'registrar_comprovante_via_token',
                        'fatura_justificar_via_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f.assinatura);
    -- Os dois localizadores são internos: expostos, viram sonda de "existe lançamento de
    -- R$ X no dia Y?" para quem tiver a anon key.
    IF f.proname IN ('salvar_justificativa_via_token', 'registrar_comprovante_via_token',
                     'fatura_justificar_via_token') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.assinatura);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
    END IF;
  END LOOP;
END $$;
