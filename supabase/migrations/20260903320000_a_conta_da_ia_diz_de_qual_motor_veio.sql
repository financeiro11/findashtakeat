-- A conta da IA passa a dizer de qual motor veio.
--
-- 03/09/2026, algumas horas depois do medidor nascer. A pergunta na tela foi:
-- "quanto é Gemini e quanto é OpenAI?" — e a resposta que o banco tinha para dar era
-- constrangedora: das 303 linhas que `ai_usage_log` acumulou desde 07/05/2026, **zero**
-- são da OpenAI. Não porque a OpenAI não rode: ela é o motor PADRÃO do Hub desde
-- 11/08/2026 e dezessete funções a chamam por `_shared/openai.ts` (justificativa e
-- pergunta da DRE, apresentação, revisão, recomendação do cartão, insights do dashboard,
-- classificação de transação, cenários, assistente, novidades, tarefas…). É que o
-- `openai.ts` não tem `onUso` — o `gemini.ts` tem —, então nenhuma dessas chamadas chega
-- ao razão.
--
-- POR QUE ISSO É UMA MIGRATION E NÃO UMA COLUNA NOVA. O motor já está escrito em cada
-- linha: está no nome do modelo (`gemini-3.5-flash-lite`, `gpt-4.1-mini`). Derivar é
-- retroativo — vale para as 303 linhas que já existem — enquanto uma coluna só valeria
-- para o futuro e ainda precisaria ser preenchida por quem grava. Menos peça, mesma
-- resposta.
--
-- E O ZERO DA OPENAI NÃO É ERRO A ESCONDER: é a medida da cobertura, e é ele que explica
-- por que o painel mostrava US$ 0,0082 no mesmo dia em que o crédito acabou. Por isso os
-- dois motores vêm SEMPRE na lista, mesmo zerados — um provedor ausente da resposta seria
-- lido como "não usamos", que é o oposto do que está acontecendo.

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
  ),
  /* O motor sai do nome do modelo. A lista de provedores vem de um VALUES e o LEFT JOIN
     é dela para o razão, não o contrário — é isso que faz um motor sem nenhuma chamada
     aparecer com zero em vez de sumir. `outro` só aparece se tiver movimento: modelo com
     nome que não reconhecemos é notícia, mas uma linha vazia chamada "outro" é ruído. */
  provedores AS (
    SELECT p.provedor,
           count(a.id)                                  AS chamadas,
           coalesce(sum(a.total_tokens), 0)             AS tokens,
           round(coalesce(sum(a.cost_usd), 0)::numeric, 4) AS usd
    FROM (VALUES ('gemini'), ('openai'), ('outro')) AS p(provedor)
    LEFT JOIN ai_usage_log a
      ON a.created_at >= (SELECT m FROM inicio)
     AND p.provedor = CASE
           WHEN a.model ILIKE '%gemini%'                        THEN 'gemini'
           WHEN a.model ILIKE '%gpt%' OR a.model ~* '^(o[0-9])' THEN 'openai'
           ELSE 'outro' END
    GROUP BY p.provedor
  )
  SELECT jsonb_build_object(
    'mes', to_char(date_trunc('month', now()), 'YYYY-MM'),
    'teto_global_usd', (SELECT teto_mes_usd FROM ia_teto_global),
    'gasto_mes_usd', (SELECT round(coalesce(sum(usd_mes), 0)::numeric, 4) FROM linhas),
    'pct_global', CASE WHEN (SELECT teto_mes_usd FROM ia_teto_global) > 0
      THEN round(((SELECT coalesce(sum(usd_mes), 0) FROM linhas)
                  / (SELECT teto_mes_usd FROM ia_teto_global) * 100)::numeric, 1) END,
    'provedores', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.usd DESC, p.provedor), '[]'::jsonb)
                   FROM provedores p WHERE p.provedor <> 'outro' OR p.chamadas > 0),
    'consumidores', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.usd_mes DESC), '[]'::jsonb) FROM linhas l)
  );
$function$;

REVOKE ALL ON FUNCTION public.ia_consumo_mes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ia_consumo_mes() TO authenticated;
