-- Medidor, freio e aviso para o consumo de IA.
--
-- 03/09/2026: o crédito pré-pago do Gemini acabou no meio do dia e ninguém viu chegando.
-- A causa não foi uma função em laço — foi não haver denominador. `ai_usage_log` tinha
-- 301 chamadas e US$ 0,30 desde maio, cobrindo 4 funcionalidades de texto curto, enquanto
-- **14 funções** chamam o Gemini. As duas que gastam de verdade (`nota-ler-arquivo`, que
-- leu 953 documentos em 27/08 e 826 em 28/08, e `anexo-triagem`) não tinham medidor NEM
-- freio. O painel dizia "a IA está ociosa" e estava certo — sobre o pedaço que ele media.
--
-- Três peças, nesta ordem de importância:
--   1. os gastadores entram em `ia_orcamento` (freio por chamadas/dia e por US$/mês);
--   2. um teto GLOBAL do mês, que é o que corresponde ao saldo pré-pago;
--   3. um aviso que toca o sino ANTES de estourar.
--
-- O aviso é SQL puro, de propósito: um alerta sobre gasto de IA que gasta IA para existir
-- é a piada que se conta sozinha. Ele roda de hora em hora e não custa um token.

/* ------------------------------------------------------------------ *
 *  1. Os gastadores ganham orçamento
 * ------------------------------------------------------------------ */

INSERT INTO public.ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd, ativo)
VALUES
  ('acervo_leitura', 'Leitura de documento do acervo',
   'Abre o PDF/imagem da nota que chegou sem identidade e transcreve CNPJ, valor e data. '
   || 'É a mais cara do Hub: cada leitura é multimodal e se paga por página.',
   150, 20.00, true),
  ('anexo_triagem', 'Triagem de anexo do ERP',
   'Abre o anexo cujo nome não diz nada e responde se aquilo é a nota do título.',
   200, 15.00, true),
  ('fatura_rateio', 'Rateio da fatura do cartão',
   'Lê o PDF da fatura do Sicoob e extrai os blocos por portador. Poucas chamadas por mês, '
   || 'mas cada uma tem 30 a 40 páginas — vale mais que uma leva inteira do acervo.',
   8, 10.00, true)
ON CONFLICT (consumidor) DO UPDATE
  SET rotulo = excluded.rotulo, para_que = excluded.para_que, atualizado_em = now();

/* ------------------------------------------------------------------ *
 *  2. O teto global do mês
 * ------------------------------------------------------------------ */

-- Uma linha só. O `id` fixo em true com CHECK é o jeito de o Postgres garantir isso.
CREATE TABLE IF NOT EXISTS public.ia_teto_global (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  teto_mes_usd  numeric NOT NULL DEFAULT 60.00,
  -- Em que percentuais avisar. Cada faixa toca uma vez por mês.
  avisar_em     int[]   NOT NULL DEFAULT '{70,90,100}',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ia_teto_global (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ia_teto_global ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hub le o teto de ia" ON public.ia_teto_global;
CREATE POLICY "hub le o teto de ia" ON public.ia_teto_global
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "hub ajusta o teto de ia" ON public.ia_teto_global;
CREATE POLICY "hub ajusta o teto de ia" ON public.ia_teto_global
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.ia_teto_global FROM anon;
GRANT SELECT, UPDATE ON public.ia_teto_global TO authenticated;

/* ------------------------------------------------------------------ *
 *  3. O painel: uma leitura só, que a tela e o aviso compartilham
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.ia_consumo_mes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH inicio AS (SELECT date_trunc('month', now()) AS m),
  gasto AS (
    SELECT coalesce(feature, 'nao_identificado') AS consumidor,
           count(*)                AS chamadas,
           sum(total_tokens)       AS tokens,
           round(sum(cost_usd)::numeric, 4) AS usd
    FROM ai_usage_log, inicio
    WHERE created_at >= inicio.m
    GROUP BY 1
  ),
  hoje AS (
    SELECT coalesce(feature, 'nao_identificado') AS consumidor, count(*) AS chamadas
    FROM ai_usage_log
    WHERE created_at >= date_trunc('day', now())
    GROUP BY 1
  ),
  linhas AS (
    SELECT
      coalesce(o.consumidor, g.consumidor)                         AS consumidor,
      coalesce(o.rotulo, g.consumidor)                             AS rotulo,
      o.teto_dia, o.teto_mes_usd, coalesce(o.ativo, true)          AS ativo,
      coalesce(g.chamadas, 0)                                      AS chamadas_mes,
      coalesce(g.tokens, 0)                                        AS tokens_mes,
      coalesce(g.usd, 0)                                           AS usd_mes,
      coalesce(h.chamadas, 0)                                      AS chamadas_hoje,
      -- Sem teto (consumidor que ainda não entrou em ia_orcamento) o percentual é NULL,
      -- e NULL aqui quer dizer "não vigiado", que é diferente de "dentro do limite".
      CASE WHEN o.teto_mes_usd > 0
           THEN round((coalesce(g.usd, 0) / o.teto_mes_usd * 100)::numeric, 1) END AS pct_mes
    FROM ia_orcamento o
    FULL JOIN gasto g ON g.consumidor = o.consumidor
    LEFT JOIN hoje h  ON h.consumidor = coalesce(o.consumidor, g.consumidor)
  )
  SELECT jsonb_build_object(
    'mes', to_char(date_trunc('month', now()), 'YYYY-MM'),
    'teto_global_usd', (SELECT teto_mes_usd FROM ia_teto_global),
    'gasto_mes_usd', (SELECT round(coalesce(sum(usd_mes), 0)::numeric, 4) FROM linhas),
    'pct_global', CASE WHEN (SELECT teto_mes_usd FROM ia_teto_global) > 0
      THEN round(((SELECT coalesce(sum(usd_mes), 0) FROM linhas)
                  / (SELECT teto_mes_usd FROM ia_teto_global) * 100)::numeric, 1) END,
    'consumidores', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.usd_mes DESC), '[]'::jsonb) FROM linhas l)
  );
$function$;

REVOKE ALL ON FUNCTION public.ia_consumo_mes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ia_consumo_mes() TO authenticated;

/* ------------------------------------------------------------------ *
 *  4. O aviso — SQL puro, sem um token gasto
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.ia_orcamento_alerta()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v         jsonb := ia_consumo_mes();
  v_mes     text  := v->>'mes';
  v_teto    numeric := (v->>'teto_global_usd')::numeric;
  v_gasto   numeric := (v->>'gasto_mes_usd')::numeric;
  v_faixas  int[]  := (SELECT avisar_em FROM ia_teto_global);
  v_faixa   int;
  v_abertos int := 0;
  c         jsonb;
BEGIN
  /* GLOBAL. Toca uma vez por faixa por mês: a assinatura carrega mês e faixa, e o índice
     único de `sinais` (serie, chave, assinatura) entre os não resolvidos faz o resto.
     Cruzar 70 e depois 90 abre DOIS sinais de propósito — "piorou" é notícia nova. */
  IF v_teto > 0 THEN
    FOREACH v_faixa IN ARRAY v_faixas LOOP
      CONTINUE WHEN v_gasto < v_teto * v_faixa / 100.0;
      BEGIN
        INSERT INTO sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
        VALUES (
          'ia.orcamento', 'global', format('ia.orcamento:global:%s:%s', v_mes, v_faixa),
          format('IA já consumiu %s%% do teto do mês (US$ %s de US$ %s)',
                 v_faixa, round(v_gasto, 2), round(v_teto, 2)),
          'O teto é o que nós declaramos em Configurações › Uso de IA — a API do Gemini não '
          || 'informa saldo, então este número é o nosso, somado do razão de chamadas.',
          CASE WHEN v_faixa >= 100
               THEN 'Repor o crédito no AI Studio ou baixar os tetos por consumidor. Sem isso, as leituras começam a falhar.'
               ELSE 'Abrir Configurações › Uso de IA e ver qual consumidor cresceu.' END,
          round(v_gasto, 2),
          CASE WHEN v_faixa >= 90 THEN 'alta' ELSE 'media' END,
          v
        );
        v_abertos := v_abertos + 1;
      EXCEPTION WHEN unique_violation THEN NULL; -- já avisado nesta faixa
      END;
    END LOOP;
  END IF;

  /* POR CONSUMIDOR, só na faixa mais alta: o global já dá o susto, e um sino por
     consumidor em cada faixa viraria ruído — o oposto de ser avisado. */
  FOR c IN SELECT * FROM jsonb_array_elements(v->'consumidores') LOOP
    CONTINUE WHEN (c->>'pct_mes') IS NULL OR (c->>'pct_mes')::numeric < 90;
    BEGIN
      INSERT INTO sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
      VALUES (
        'ia.orcamento', c->>'consumidor',
        format('ia.orcamento:%s:%s:90', c->>'consumidor', v_mes),
        format('%s já usou %s%% do orçamento do mês (US$ %s de US$ %s)',
               c->>'rotulo', c->>'pct_mes', round((c->>'usd_mes')::numeric, 2),
               round((c->>'teto_mes_usd')::numeric, 2)),
        format('%s chamadas no mês, %s hoje.', c->>'chamadas_mes', c->>'chamadas_hoje'),
        'Se o trabalho é legítimo, suba o teto deste consumidor. Se não, desligue-o em ia_orcamento.',
        round((c->>'usd_mes')::numeric, 2), 'alta', c
      );
      v_abertos := v_abertos + 1;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('avisos_abertos', v_abertos, 'consumo', v);
END;
$function$;

REVOKE ALL ON FUNCTION public.ia_orcamento_alerta() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ia_orcamento_alerta() TO authenticated;

/* ------------------------------------------------------------------ *
 *  5. O cron do aviso, e a cadência honesta dos gastadores
 * ------------------------------------------------------------------ */

SELECT cron.unschedule('ia-orcamento-alerta') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ia-orcamento-alerta');
SELECT cron.schedule('ia-orcamento-alerta', '20 * * * *', $$SELECT public.ia_orcamento_alerta();$$);

/* A cadência de 5 minutos era herança do dia em que a fila tinha 1.439 documentos. Medido
   em 03/09: `anexo-triagem` rodou 278 vezes em 24h com a fila ZERADA, e `nota-ler-arquivo`
   279 vezes para ler 2 documentos. Uma fila que ficou vazia o dia inteiro não precisa ser
   perguntada a cada 5 minutos — e quando ela encher, o freio é que decide o ritmo, não o
   cron. Ficam 15 e 30 minutos, e ambos voltam LIGADOS porque agora existe teto. */
SELECT cron.alter_job(jobid, schedule := '*/15 * * * *', active := true)
FROM cron.job WHERE jobname = 'nota-ler-arquivo';

SELECT cron.alter_job(jobid, schedule := '3,33 * * * *', active := true)
FROM cron.job WHERE jobname = 'anexo-triagem-ia';
