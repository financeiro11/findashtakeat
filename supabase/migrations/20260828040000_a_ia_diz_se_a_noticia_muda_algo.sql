-- A IA passa a responder se a notícia muda alguma coisa — e o painel usa isso.
--
-- O QUE A ESTREIA MOSTROU (28/08/2026). A régua determinística aprovou quatro
-- notícias e a IA, ao escrever a legenda de cada uma, disse a mesma frase nas
-- quatro: "não muda nada de concreto para a Takeat". O painel do dia seria
-- quatro cards explicando por que não importam — que é o pior resultado
-- possível, porque gasta a atenção da manhã e ensina a pessoa a ignorar a seção.
--
-- POR QUE A RÉGUA NÃO RESOLVE ISSO SOZINHA. Ela lê palavras: "Anthropic" mais
-- "launched" no resumo é indistinguível, para um casador de termos, entre o
-- anúncio do produto e a análise de mercado que MENCIONA o anúncio. Apertá-la
-- até separar os dois casos exigiria entender o texto — que é precisamente o que
-- a régua não faz e não deve fazer.
--
-- O ARRANJO, E POR QUE ELE NÃO É "DEIXAR A IA DECIDIR". A ordem continua a
-- mesma: o código escolhe as pautas, dispara as buscas e PONTUA; só o que
-- sobrevive à régua chega à IA. O que muda é que, junto da frase, ela responde
-- uma pergunta binária sobre aquele item — "isto muda algo concreto para a
-- Takeat?" — e a resposta fica GRAVADA aqui, ao lado do texto que a produziu.
-- Auditável, portanto: dá para abrir a tabela e conferir se ela está engolindo
-- notícia boa. Um filtro de IA sem esse rastro seria fé.
--
-- NULL É "NÃO SEI", E NÃO SEI NÃO ESCONDE. Quando a chamada de IA falha — e ela
-- falha: soluço do Gemini, relógio do worker —, a coluna fica nula e o item
-- APARECE no painel. Esconder por falha de leitura transformaria intermitência
-- em censura, e do jeito mais silencioso: ninguém descobre a notícia que não
-- viu. Mesma regra do "ausência de evidência não é evidência de ausência" do
-- radar de preços.

alter table public.briefing_noticias
  add column if not exists muda_algo boolean;

comment on column public.briefing_noticias.muda_algo is
  'Veredito da IA sobre o item JÁ APROVADO pela régua: muda algo concreto para a Takeat? null = a IA não respondeu, e o item aparece assim mesmo.';

-- A fila da tela é "não lidas que mudam algo, mais recentes primeiro". O `is not
-- false` (e não `is true`) é o que mantém o null visível.
create index if not exists briefing_noticias_acionaveis
  on public.briefing_noticias (colhido_em desc)
  where lido_em is null and muda_algo is not false;
