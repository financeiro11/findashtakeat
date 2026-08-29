-- Radar: a quarentena passa a contar TENTATIVA, não relógio.
--
-- O DESCARTE ESTAVA AFIRMANDO UMA COISA QUE NÃO SABIA. Todo alerta com mais de
-- 48h em `a_confirmar` virava `descartado` com o texto "não consegui abrir o
-- anúncio em 48h de tentativas" — e não havia tentativa nenhuma sendo contada.
-- A frase era uma dedução a partir do relógio, não um fato apurado.
--
-- Por que isso não é preciosismo: a conferência processa DOIS anúncios por
-- rodada. Não é o `limite: 8` do cron que manda — é o laço, que para em 55s de
-- orçamento, e um anúncio pode custar 75s (com o CEP digitado) mais 45s de
-- releitura. Medido em 28/08/2026: as quatro rodadas do dia devolveram
-- `{"confirmado":1,"segue de pé":1}`, sempre. São oito conferências por dia,
-- metade delas gastas na reconferência de 24h do que já está na tela.
--
-- Com um alvo e fila de um, isso não morde. Com quatro ou cinco alvos, a fila
-- passa a crescer mais rápido do que drena, e o descarte por idade começa a
-- matar achado que NUNCA foi aberto — escrevendo, na cara de quem lê, que foram
-- 48 horas de tentativa. Um radar pode falhar em conferir; o que ele não pode é
-- relatar como apurado aquilo que não apurou. É a mesma regra do "ausência de
-- evidência não é evidência de ausência", aplicada agora ao nosso próprio lado.
--
-- Daqui em diante quem desiste é a CONTAGEM: três leituras que falharam. O
-- alerta velho e nunca tentado continua na fila, que é ordenada pelo mais
-- antigo — ele está na cabeça dela, e é onde deve estar. Se a fila crescer sem
-- parar, isso vira um número visível em vez de uma limpeza silenciosa, que é a
-- diferença entre saber e não saber que a vazão não dá conta.

alter table public.facilities_radar_alertas
  add column if not exists tentativas integer not null default 0;

comment on column public.facilities_radar_alertas.tentativas is
  'Quantas vezes a conferência ABRIU (ou tentou abrir) o anúncio deste alerta e falhou. É o que autoriza o descarte por desistência — o relógio sozinho não prova tentativa.';
