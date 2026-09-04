-- O RAZÃO DE IA PASSA A ENXERGAR A OPENAI.
--
-- O medidor de 03/09/2026 (`…270000_a_ia_passa_a_ter_medidor_freio_e_aviso`) nasceu
-- olhando só para o Gemini, porque era lá que estava o gasto grande de leitura. Mas o
-- motor PADRÃO do Hub é a OpenAI desde 11/08 — dezesseis funções chamam
-- `_shared/openai.ts` — e nenhuma delas deixava uma linha no razão: o `usage` que a API
-- devolve em toda resposta era descartado dentro do próprio motor. O painel Uso de IA
-- dizia a verdade sobre o pedaço que media e não sabia da existência do resto.
--
-- Isto custou uma tarde: perguntaram de fora "no que você gastou tanto token da OpenAI?"
-- e a única resposta possível de dentro do Hub era contagem de invocação de função — que
-- não sabe o tamanho do prompt e, portanto, não sabe o preço. Agora o motor grava (ver o
-- bloco "o medidor" em `_shared/openai.ts`) e aqui ficam os tetos.
--
-- SEIS NOMES PARA DEZESSEIS FUNÇÕES. O teto é a unidade de decisão, não a função: uma
-- linha por função vira dezesseis linhas que ninguém revisa, e um teto que ninguém revisa
-- é decoração. Agrupa-se pelo que a IA está FAZENDO, que é como se decide se vale a pena
-- continuar pagando.
--
-- `openai_sem_rotulo` NÃO ENTRA AQUI, de propósito. É o nome que o motor dá a quem chamou
-- sem se identificar, e o painel mostra consumidor sem teto como "não vigiado" — em
-- destaque. Dar um teto a ele seria arrumar a aparência do problema em vez de resolvê-lo;
-- do jeito que está, a linha aparece cobrando um nome até alguém dá-lo.

INSERT INTO public.ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd, ativo)
VALUES
  ('dre_dfc', 'Comentários e perguntas da DRE/DFC',
   'Justificativa de rubrica, pergunta na célula, texto da Revisão do Mês, apresentação e '
   || 'projeção de cenário. É o grupo mais usado por gente — cada pergunta são DUAS '
   || 'chamadas (triagem e redação), e o contexto organizacional inteiro vai nas duas.',
   200, 10.00, true),

  ('painel_insights', 'Insights do painel inicial',
   'Os quatro cartões analíticos do painel. Guardados em cache por pessoa e por dia — o '
   || 'número de chamadas é o número de pessoas que abriram o Hub, não o de visitas.',
   30, 3.00, true),

  ('cartao_recomendar', 'Recomendação do cartão',
   'Redige a recomendação sobre a fatura. O sinal é determinístico e calculado em código; '
   || 'a IA só escreve o texto em cima dele.',
   20, 2.00, true),

  ('rotina_diaria', 'Rotinas diárias que escrevem texto',
   'Diagnóstico das notas, novidades do Hub e o vigia dos sinais. Três crons por dia, um '
   || 'texto cada. Se este número passar de trinta, alguma rodada está repetindo.',
   30, 2.00, true),

  ('classificacao', 'Classificação automática',
   'Eixos de tarefa, categoria de transação e sugestão de apelido na Parametrização. '
   || 'Trabalha em lote e é o grupo com mais chance de virar laço — daí o teto folgado no '
   || 'dia e apertado no mês.',
   120, 5.00, true),

  ('texto_apoio', 'Textos de apoio do Hub',
   'Comentário do cap table, insight do sync de assinaturas e leitura de PDF da '
   || 'Biblioteca. Poucas chamadas, sob demanda.',
   40, 3.00, true)
ON CONFLICT (consumidor) DO UPDATE
  SET rotulo = excluded.rotulo, para_que = excluded.para_que,
      teto_dia = excluded.teto_dia, teto_mes_usd = excluded.teto_mes_usd,
      atualizado_em = now();
