-- Radar: a foto do produto, a nota e quantas pessoas avaliaram.
--
-- POR QUE ISSO NÃO É ENFEITE. Quem decide a compra olha três coisas antes do
-- preço: se é o produto certo (foto), se presta (nota) e se a nota vale alguma
-- coisa (quantas avaliações). Uma nota 5,0 com duas avaliações não diz nada; a
-- mesma 4,6 com 1.800 diz muito. Sem a contagem ao lado, a nota engana mais do
-- que informa — e é justamente o número que faz alguém clicar em comprar.
--
-- `imagem_url` já existia na tabela desde o começo, mas nunca era preenchida:
-- vinha da API do Mercado Livre, que fechou. Agora sai da própria extração da
-- página, como o resto.

alter table public.facilities_radar_ofertas
  -- 0 a 5, como as lojas brasileiras exibem.
  add column if not exists avaliacao  numeric,
  add column if not exists avaliacoes integer;

comment on column public.facilities_radar_ofertas.avaliacao is
  'Nota de 0 a 5. Só faz sentido lida junto de `avaliacoes`: 5,0 com duas avaliações não é melhor que 4,6 com mil.';
comment on column public.facilities_radar_ofertas.avaliacoes is
  'Quantas pessoas avaliaram. É o que dá peso à nota — e é o que a tela mostra colado nela, de propósito.';
