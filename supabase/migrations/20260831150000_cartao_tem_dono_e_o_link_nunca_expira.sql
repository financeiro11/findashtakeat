-- Cartão passa a ter DONO (tabela própria), o link deixa de poder expirar, e a
-- justificativa da aba de pendências finalmente espelha na fatura.
--
-- Cinco consertos pedidos depois de a fatura entrar no ar, e dois deles eram bug vivo:
--
-- 1. O LINK NÃO PODE EXPIRAR — e o do CEO já tinha morrido. O token do Miguel era de
--    16/07 com o prazo de 7 dias da versão antiga; `resolver_token` carimbou
--    `status = 'expirado'` e o link parou. Aqui todos voltam e o prazo some de vez.
--
-- 2. A JUSTIFICATIVA ERA MÃO ÚNICA. `salvar_justificativa_via_token` (aba Pendências)
--    escrevia só em `auditoria`. O comprovante já espelhava nos dois sentidos, o texto
--    não: o líder justificava numa aba e a outra seguia mostrando a linha crua.
--
-- 3. NÃO EXISTIA "O CARTÃO DO FULANO". O cartão era só um texto repetido em cada linha de
--    `auditoria_cartao_lancamentos`, então não havia onde dizer "esse encerrou", onde
--    pendurar o link, nem onde guardar UM nome — o Luiz aparece como "Luiz PC Chacara" e
--    "Luiz P C Chácara" e virava duas pessoas em qualquer agrupamento por nome.
--
-- 4. TODO CARTÃO ATIVO TEM LINK, sempre. Antes o link nascia de uma cobrança; quem nunca
--    foi cobrado não tinha como ver a própria fatura. Agora um gatilho garante.
--
-- 5. QUEM SAI, ENCERRA COM PRAZO DE GRAÇA. O cartão fecha numa data combinada — o link
--    segue valendo até lá para a pessoa terminar de anexar o que devia, e depois recusa.
--    O histórico nunca some do Hub.
--
-- Separação que vale entender: o LINK não expira nunca (#1); o que fecha é o CARTÃO (#5).
-- São coisas diferentes, e é por isso que o prazo de graça mora no portador e não no token.

-- ---------------------------------------------------------------------------
-- 1) O link não expira — nem por acidente
-- ---------------------------------------------------------------------------
UPDATE public.magic_tokens
SET expira_em = NULL,
    -- Revive quem o prazo antigo já tinha matado (era o caso do Miguel).
    status = CASE WHEN status = 'expirado' THEN 'ativo' ELSE status END
WHERE expira_em IS NOT NULL OR status = 'expirado';

ALTER TABLE public.magic_tokens DROP CONSTRAINT IF EXISTS magic_tokens_sem_prazo;
ALTER TABLE public.magic_tokens
  ADD CONSTRAINT magic_tokens_sem_prazo CHECK (expira_em IS NULL);

COMMENT ON COLUMN public.magic_tokens.expira_em IS
  'Sempre NULL desde 31/08/2026 — o link do líder é permanente, e a restrição '
  '`magic_tokens_sem_prazo` impede que alguém volte a preencher. Quem fecha o acesso é o '
  'encerramento do CARTÃO (cartao_portadores.acesso_ate), não um prazo no token.';

-- ---------------------------------------------------------------------------
-- 2) O cartão ganha dono
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cartao_portadores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_final    text NOT NULL,
  nome          text NOT NULL,
  time          text,
  status        text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado')),
  -- Prazo de graça: até aqui o link ainda abre depois do encerramento.
  acesso_ate    timestamptz,
  encerrado_em  timestamptz,
  encerrado_por uuid,
  motivo        text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Único por cartão só enquanto ATIVO: um final de cartão pode ser reemitido para outra
-- pessoa anos depois, e o registro encerrado precisa continuar existindo ao lado.
CREATE UNIQUE INDEX IF NOT EXISTS cartao_portadores_ativo_idx
  ON public.cartao_portadores (card_final) WHERE status = 'ativo';

ALTER TABLE public.cartao_portadores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "portadores autenticado" ON public.cartao_portadores;
CREATE POLICY "portadores autenticado" ON public.cartao_portadores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.cartao_portadores FROM anon;

-- Carga inicial. O nome canônico é a grafia MAIS RECENTE, não a mais frequente: o Luiz tem
-- 10 linhas como "Luiz PC Chacara" (jun) contra 3 como "Luiz P C Chácara" (ago), e é a de
-- agosto que está certa. Frequência desempata dentro do mesmo mês.
INSERT INTO public.cartao_portadores (card_final, nome, time)
SELECT card_final, nome, time
FROM (
  SELECT DISTINCT ON (card_final)
         card_final,
         gestor AS nome,
         time
  FROM (
    SELECT card_final, gestor, time,
           max(competencia) OVER (PARTITION BY card_final, gestor) AS ultimo_mes,
           count(*)         OVER (PARTITION BY card_final, gestor) AS vezes
    FROM public.auditoria_cartao_lancamentos
    WHERE card_final IS NOT NULL
      AND gestor IS NOT NULL
      AND gestor NOT IN ('(consolidado)', '(sem cartão)')
  ) x
  ORDER BY card_final, ultimo_mes DESC, vezes DESC
) y
ON CONFLICT DO NOTHING;

-- Giovanni saiu (informado em 31/08/2026). Encerrado sem graça: o cartão já não existe.
UPDATE public.cartao_portadores
SET status = 'encerrado', encerrado_em = now(), acesso_ate = now(),
    motivo = 'Colaborador desligado — cartão cancelado', atualizado_em = now()
WHERE card_final = '7494' AND status = 'ativo';

-- O cartão provisório não tem dono para receber link.
UPDATE public.cartao_portadores
SET status = 'encerrado', encerrado_em = now(), acesso_ate = now(),
    motivo = 'Cartão provisório, sem portador', atualizado_em = now()
WHERE card_final = '0754' AND status = 'ativo';

-- ---------------------------------------------------------------------------
-- 3) Todo cartão ativo tem link — sem depender de cobrança
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garantir_links_dos_cartoes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_criados int := 0;
  p record;
BEGIN
  FOR p IN
    SELECT pt.card_final, pt.nome
    FROM cartao_portadores pt
    WHERE pt.status = 'ativo'
      AND NOT EXISTS (
        SELECT 1 FROM magic_tokens t
        WHERE t.card_final = pt.card_final AND t.status <> 'revogado')
  LOOP
    INSERT INTO magic_tokens (token, responsavel, card_final, expira_em)
    VALUES (substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 16),
            p.nome, p.card_final, NULL);
    v_criados := v_criados + 1;
  END LOOP;

  -- O nome do token acompanha o do portador: é ele que aparece no "Olá, Fulano".
  UPDATE magic_tokens t
  SET responsavel = pt.nome
  FROM cartao_portadores pt
  WHERE t.card_final = pt.card_final
    AND pt.status = 'ativo'
    AND t.status <> 'revogado'
    AND t.responsavel IS DISTINCT FROM pt.nome;

  RETURN v_criados;
END;
$function$;

-- Cartão novo que aparecer na próxima fatura vira portador e ganha link sozinho.
-- FOR EACH STATEMENT porque a carga chega em lote (~600 linhas de uma vez) e o trabalho
-- é o mesmo para uma linha ou para todas.
CREATE OR REPLACE FUNCTION public.cartao_novo_ganha_dono_e_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO cartao_portadores (card_final, nome, time)
  SELECT DISTINCT ON (c.card_final) c.card_final, c.gestor, c.time
  FROM auditoria_cartao_lancamentos c
  WHERE c.card_final IS NOT NULL
    AND c.gestor IS NOT NULL
    AND c.gestor NOT IN ('(consolidado)', '(sem cartão)')
    -- Não ressuscita cartão encerrado: quem saiu, saiu, mesmo que chegue uma parcela
    -- atrasada dele na fatura do mês seguinte.
    AND NOT EXISTS (SELECT 1 FROM cartao_portadores p WHERE p.card_final = c.card_final)
  ORDER BY c.card_final, c.competencia DESC
  ON CONFLICT DO NOTHING;

  PERFORM garantir_links_dos_cartoes();
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS cartao_novo_ganha_dono_e_link_trg ON public.auditoria_cartao_lancamentos;
CREATE TRIGGER cartao_novo_ganha_dono_e_link_trg
  AFTER INSERT ON public.auditoria_cartao_lancamentos
  FOR EACH STATEMENT EXECUTE FUNCTION public.cartao_novo_ganha_dono_e_link();

SELECT public.garantir_links_dos_cartoes();

-- ---------------------------------------------------------------------------
-- 4) Encerrar e reativar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encerrar_cartao(
  p_card_final text,
  p_dias_graca int DEFAULT 7,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ate timestamptz;
BEGIN
  IF p_dias_graca < 0 OR p_dias_graca > 90 THEN
    RETURN jsonb_build_object('erro', 'Prazo de graça precisa estar entre 0 e 90 dias');
  END IF;

  v_ate := now() + make_interval(days => p_dias_graca);

  UPDATE cartao_portadores
  SET status = 'encerrado', encerrado_em = now(), acesso_ate = v_ate,
      encerrado_por = auth.uid(), motivo = p_motivo, atualizado_em = now()
  WHERE card_final = p_card_final AND status = 'ativo';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Cartão não encontrado ou já encerrado');
  END IF;

  -- O token NÃO é revogado: durante a graça ele ainda precisa abrir. Quem fecha a porta
  -- é `acesso_ate`, conferido a cada leitura.
  RETURN jsonb_build_object('ok', true, 'acesso_ate', v_ate);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reativar_cartao(p_card_final text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM cartao_portadores WHERE card_final = p_card_final AND status = 'ativo') THEN
    RETURN jsonb_build_object('erro', 'Já existe um cartão ativo com este final');
  END IF;

  UPDATE cartao_portadores
  SET status = 'ativo', encerrado_em = NULL, acesso_ate = NULL,
      encerrado_por = NULL, motivo = NULL, atualizado_em = now()
  WHERE id = (SELECT id FROM cartao_portadores
              WHERE card_final = p_card_final ORDER BY encerrado_em DESC NULLS LAST LIMIT 1);

  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'Cartão não encontrado'); END IF;

  PERFORM garantir_links_dos_cartoes();
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) O portão passa a conhecer o encerramento
-- ---------------------------------------------------------------------------
-- Estado do cartão numa resposta só, para as duas abas nunca discordarem.
-- Cartão que não está na tabela é tratado como ABERTO: a tabela é cadastro, e cadastro
-- faltando não pode virar porta fechada para quem tem gasto legítimo na fatura.
CREATE OR REPLACE FUNCTION public.cartao_acesso(p_card_final text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p cartao_portadores%ROWTYPE;
BEGIN
  -- O ativo ganha do encerrado: um final reemitido tem as duas linhas.
  SELECT * INTO p FROM cartao_portadores
  WHERE card_final = p_card_final
  ORDER BY (status = 'ativo') DESC, encerrado_em DESC NULLS FIRST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('aberto', true);
  END IF;

  IF p.status = 'ativo' THEN
    RETURN jsonb_build_object('aberto', true, 'nome', p.nome);
  END IF;

  IF p.acesso_ate IS NOT NULL AND p.acesso_ate > now() THEN
    RETURN jsonb_build_object('aberto', true, 'nome', p.nome, 'encerrando', true,
                              'acesso_ate', to_char(p.acesso_ate, 'DD/MM/YYYY'));
  END IF;

  RETURN jsonb_build_object('aberto', false, 'nome', p.nome);
END;
$function$;

-- Devolve NULL quando o cartão está fechado — as três escritas do link (anexar pela edge,
-- justificar, contestar) param juntas, porque todas passam por aqui.
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
  IF v_row.card_final IS NULL THEN RETURN NULL; END IF;
  IF regexp_replace(coalesce(p_digitos, ''), '\D', '', 'g') <> v_row.card_final THEN RETURN NULL; END IF;
  IF NOT (cartao_acesso(v_row.card_final)->>'aberto')::boolean THEN RETURN NULL; END IF;
  RETURN v_row.card_final;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6) A justificativa deixa de ser mão única
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
  v_valido       boolean;
  v_evento       jsonb;
  v_id_transacao text;
BEGIN
  v_valido := validar_token_para_id_unico(p_token, p_id_unico);
  IF NOT v_valido THEN
    RETURN jsonb_build_object('erro', 'Token inválido, expirado ou não cobre este lançamento');
  END IF;

  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RETURN jsonb_build_object('erro', 'Justificativa vazia');
  END IF;

  v_evento := jsonb_build_object(
    'evento', 'justificativa_recebida',
    'canal', 'link_publico',
    'token', p_token,
    'texto', p_texto,
    'timestamp', now()
  );

  UPDATE auditoria
  SET justificativa = p_texto,
      status = 'Em análise',
      trilha = coalesce(trilha, '[]'::jsonb) || jsonb_build_array(v_evento),
      updated_at = now()
  WHERE id_unico = p_id_unico
  RETURNING id_transacao INTO v_id_transacao;

  -- O que faltava: espelhar na base do cartão. Sem isto o líder justificava na aba de
  -- pendências e a aba da fatura seguia mostrando a linha como se nada tivesse chegado —
  -- o mesmo motivo pelo qual `registrar_comprovante_via_token` já espelhava desde 08/2026.
  IF v_id_transacao IS NOT NULL THEN
    UPDATE auditoria_cartao_lancamentos
    SET observacao = p_texto, updated_at = now()
    WHERE id_unico = v_id_transacao;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'Em análise');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7) A fatura respeita o encerramento e usa o nome canônico
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
        'observacao', nullif(c.observacao, ''),
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
    'responsavel', v_nome,
    'card_final', v_row.card_final,
    -- Avisa na tela que o acesso tem data para acabar, em vez de o link simplesmente
    -- parar de funcionar um dia sem explicação.
    'encerrando', coalesce((v_acesso->>'encerrando')::boolean, false),
    'acesso_ate', v_acesso->>'acesso_ate',
    'resumo', v_resumo,
    'meses', coalesce(v_meses, '[]'::jsonb)
  );
END;
$function$;

-- A aba de pendências fecha junto: o cartão encerrado não responde por nenhuma das duas.
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

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Token inválido');
  END IF;

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
    -- A justificativa pode ter chegado pela aba da FATURA, que grava em
    -- `auditoria_cartao_lancamentos.observacao`. Ler só `a.justificativa` fazia esta aba
    -- seguir pedindo o que o líder já tinha respondido do outro lado.
    'justificativa', coalesce(a.justificativa, c.observacao),
    'resolvido', (a.link_comprovante IS NOT NULL
                  OR a.justificativa IS NOT NULL
                  OR nullif(btrim(coalesce(c.observacao, '')), '') IS NOT NULL)
  ) ORDER BY (a.link_comprovante IS NOT NULL
              OR a.justificativa IS NOT NULL
              OR nullif(btrim(coalesce(c.observacao, '')), '') IS NOT NULL), a.valor DESC),
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

-- ---------------------------------------------------------------------------
-- 8) Portas
-- ---------------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('cartao_acesso', 'garantir_links_dos_cartoes', 'encerrar_cartao',
                        'reativar_cartao', 'cartao_novo_ganha_dono_e_link',
                        'resolver_fatura_via_token', 'resolver_token',
                        'salvar_justificativa_via_token', 'fatura_cartao_do_token')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f.assinatura);
    -- Só as três que o link público chama continuam abertas ao anônimo.
    IF f.proname IN ('resolver_fatura_via_token', 'resolver_token', 'salvar_justificativa_via_token') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.assinatura);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
    END IF;
  END LOOP;
END $$;
