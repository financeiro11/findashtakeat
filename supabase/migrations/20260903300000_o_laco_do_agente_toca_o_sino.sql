-- O LAÇO DO AGENTE PASSA A TOCAR O SINO.
--
-- 03/09/2026, 14:15:32 → 14:19:47. A TETS recebeu no chat um "muda o vencimento destes
-- títulos para 04/09" e obedeceu — UM POR UM. Foram 102 chamadas de
-- `editar_lancamento_omie` em quatro minutos, para 102 títulos distintos, e as 102
-- devolveram `previsao_anterior` IGUAL ao `novo_vencimento` pedido: nenhuma mudou coisa
-- alguma. O trabalho realizado foi zero; a conta, não. Cada passo desses é uma ida
-- completa ao modelo carregando prompt de sistema, catálogo de ferramentas e o histórico
-- inteiro da conversa — o gasto de um laço de agente não está na ferramenta, está na
-- repetição do contexto. Às 17:47 o aviso veio por WhatsApp, de fora.
--
-- POR QUE UM AVISO E NÃO UMA TRAVA. A ferramenta que edita o título vive no n8n: ela fala
-- com o Omie e só depois escreve a trilha aqui. Uma trava neste lado barraria o REGISTRO
-- de uma edição que já aconteceu — trocaríamos gasto por trilha furada, que é pior. O
-- freio de verdade (ferramenta em lote, teto de passos por tarefa) é do lado de lá; daqui
-- o que dá para fazer é enxergar em minutos o que hoje levou três horas e meia para
-- chegar, e por um caminho que não é o nosso.
--
-- Duas formas de laço, porque são doenças diferentes:
--   RAJADA     — muita chamada da mesma tarefa em pouco tempo. Pode ser trabalho legítimo
--                (uma leva grande), então a gravidade é média e o texto pergunta em vez
--                de acusar.
--   SEM EFEITO — a edição que não mudou nada. Aqui não há dúvida: é gasto pago por zero,
--                e dez delas na mesma hora já é o padrão de hoje. Gravidade alta.

INSERT INTO public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
VALUES (
  'agente.laco', 'monitoramento', 'Agente em laço',
  'Rajada de chamadas da mesma ferramenta, ou edições que não mudaram nada, na trilha da '
  || 'TETS. Cada passo do agente é uma ida inteira ao modelo: cem passos para um trabalho '
  || 'que cabia em um custam cem vezes mais. Não é medida contra mediana — é limiar.',
  '/monitoramento/thetys', 'acima', 'alta', true
)
ON CONFLICT (serie) DO UPDATE
  SET titulo = excluded.titulo, descricao = excluded.descricao,
      rota = excluded.rota, atualizado_em = now();

-- ---------------------------------------------------------------------------
-- A edição que não mudou nada.
--
-- A trilha guarda o pedido em `entrada` e o estado ANTERIOR em `saida`. Se o anterior já
-- era o pedido, a chamada foi um passeio.
--
-- A PRIMEIRA VERSÃO DISTO ACUSAVA O MUNDO INTEIRO. Escrita com `coalesce(…, '')` dos dois
-- lados, ela dizia "sem efeito" para `consultar_fornecedor` e `listar_vencimentos`
-- também — tarefas que não têm `novo_vencimento` nem `previsao_anterior`, e onde a
-- comparação virava `'' = ''`. Um vigia que aponta 12 de 12 consultas como desperdício
-- não seria desligado por ninguém: seria ignorado, que é pior. Por isso a primeira
-- condição é que o pedido tenha PEDIDO alguma mudança.
--
-- `novo_valor` nulo quer dizer "não mexi no valor" — não conta como divergência.
-- ---------------------------------------------------------------------------

/* Data é texto ("04/09/2026") e valor é número (2400) na mesma trilha. Comparar tudo como
   texto erraria em 2400 vs 2400.0; comparar tudo como número quebraria na data. */
CREATE OR REPLACE FUNCTION public.agente_mesmo_valor(a text, b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL THEN false
    WHEN a ~ '^-?[0-9]+(\.[0-9]+)?$' AND b ~ '^-?[0-9]+(\.[0-9]+)?$' THEN a::numeric = b::numeric
    ELSE a = b
  END;
$$;

CREATE OR REPLACE FUNCTION public.agente_edicao_sem_efeito(p_entrada jsonb, p_saida jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_saida IS NOT NULL
     -- pediu alguma mudança? sem isto, toda consulta vira "desperdício"
     AND (p_entrada->>'novo_vencimento' IS NOT NULL OR p_entrada->>'novo_valor' IS NOT NULL)
     -- e TUDO o que pediu já era o que estava lá
     AND (p_entrada->>'novo_vencimento' IS NULL
          OR agente_mesmo_valor(p_saida->>'previsao_anterior', p_entrada->>'novo_vencimento'))
     AND (p_entrada->>'novo_valor' IS NULL
          OR agente_mesmo_valor(p_saida->>'valor_anterior', p_entrada->>'novo_valor'));
$$;

COMMENT ON FUNCTION public.agente_edicao_sem_efeito(jsonb, jsonb) IS
  'A edição pediu exatamente o que já estava lá? Custou uma ida ao modelo e não mudou nada.';

-- ---------------------------------------------------------------------------
-- O vigia. SQL puro, pela mesma razão que a `ia_orcamento_alerta()`: um alarme sobre
-- gasto de IA que gasta IA para existir é a piada que se conta sozinha.
--
-- A janela é de 60 minutos e a assinatura carrega a HORA, não o minuto: rodando de dez em
-- dez minutos, um mesmo laço seria denunciado seis vezes se a assinatura mudasse junto.
-- Toca uma vez por tarefa por hora, e o índice único de `sinais` faz o resto.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agente_laco_alerta(
  p_rajada     int DEFAULT 30,   -- chamadas da mesma tarefa em 60 min
  p_sem_efeito int DEFAULT 10    -- edições que não mudaram nada em 60 min
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hora    text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24');
  v_abertos int  := 0;
  r         record;
BEGIN
  FOR r IN
    SELECT
      e.agente_id,
      e.tarefa,
      count(*)                                                              AS chamadas,
      count(*) FILTER (WHERE agente_edicao_sem_efeito(e.entrada, e.saida))  AS sem_efeito,
      count(DISTINCT e.entidade_id)                                         AS entidades,
      min(e.executado_em at time zone 'America/Sao_Paulo')                  AS comecou,
      max(e.executado_em at time zone 'America/Sao_Paulo')                  AS terminou
    FROM agente_execucoes e
    WHERE e.executado_em >= now() - interval '60 minutes'
    GROUP BY e.agente_id, e.tarefa
    HAVING count(*) >= p_rajada
        OR count(*) FILTER (WHERE agente_edicao_sem_efeito(e.entrada, e.saida)) >= p_sem_efeito
  LOOP
    BEGIN
      INSERT INTO sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade, medida)
      VALUES (
        'agente.laco',
        format('%s:%s', r.agente_id, r.tarefa),
        format('agente.laco:%s:%s:%s', r.agente_id, r.tarefa, v_hora),
        CASE WHEN r.sem_efeito >= p_sem_efeito
             THEN format('%s repetiu "%s" %s vezes e %s não mudaram nada',
                         upper(r.agente_id), r.tarefa, r.chamadas, r.sem_efeito)
             ELSE format('%s chamou "%s" %s vezes na última hora',
                         upper(r.agente_id), r.tarefa, r.chamadas) END,
        format('%s chamadas sobre %s registros, das %s às %s. Cada passo do agente é uma '
               || 'ida inteira ao modelo — prompt de sistema, catálogo de ferramentas e o '
               || 'histórico da conversa vão junto em TODAS elas.',
               r.chamadas, r.entidades,
               to_char(r.comecou, 'HH24:MI'), to_char(r.terminou, 'HH24:MI')),
        CASE WHEN r.sem_efeito >= p_sem_efeito
             THEN 'Edição que não muda nada é conta paga por zero. Ver no n8n o que pediu a '
                  || 'leva e fazer a ferramenta comparar antes de gravar — e responder em lote.'
             ELSE 'Se a leva é legítima, vale uma ferramenta que receba a lista de uma vez: '
                  || 'cem passos viram um, e o contexto é enviado uma vez só.' END,
        r.chamadas,
        CASE WHEN r.sem_efeito >= p_sem_efeito THEN 'alta' ELSE 'media' END,
        jsonb_build_object(
          'agente', r.agente_id, 'tarefa', r.tarefa, 'chamadas', r.chamadas,
          'sem_efeito', r.sem_efeito, 'entidades', r.entidades,
          'comecou', r.comecou, 'terminou', r.terminou)
      );
      v_abertos := v_abertos + 1;
    EXCEPTION WHEN unique_violation THEN NULL; -- já avisado nesta hora
    END;
  END LOOP;

  RETURN jsonb_build_object('avisos_abertos', v_abertos, 'hora', v_hora);
END;
$$;

COMMENT ON FUNCTION public.agente_laco_alerta(int, int) IS
  'Denuncia rajada de ferramenta e edição sem efeito na trilha dos agentes. Cron de 10 em 10 min.';

REVOKE ALL ON FUNCTION public.agente_laco_alerta(int, int) FROM anon;
REVOKE ALL ON FUNCTION public.agente_edicao_sem_efeito(jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.agente_mesmo_valor(text, text) FROM anon;

-- De dez em dez minutos. A rajada de hoje durou quatro; de hora em hora, o sino tocaria
-- depois de o estrago inteiro estar feito — que foi exatamente o que aconteceu.
-- (Desagenda antes: o arquivo roda inteiro numa transação e precisa poder ser repetido.)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'agente-laco-vigiar';
SELECT cron.schedule('agente-laco-vigiar', '*/10 * * * *', $cron$ SELECT public.agente_laco_alerta(); $cron$);
