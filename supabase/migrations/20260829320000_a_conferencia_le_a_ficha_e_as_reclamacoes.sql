-- Radar: a conferência passa a trazer o que já estava na página e ia para o lixo.
--
-- O NÚMERO QUE MOTIVOU. Medido em 29/08/2026, nas ofertas dentro do teto:
--
--     24 de 24 com pendência      média de 3,2 itens      score médio 46/100
--
--     avaliações do produto ... 23      valor do frete ......... 20
--     se está em estoque ...... 22      reputação do vendedor .. 11
--
-- Cada pendência tira 4 pontos do score. Ou seja: ~13 dos 54 pontos que faltam
-- não são "este anúncio é ruim" — são "eu não sei". O radar estava punindo a
-- própria ignorância e chamando isso de nota.
--
-- E a informação estava ALI. A conferência abre a página do produto, paga o
-- crédito de raspagem, manda 14 000 caracteres para a IA — e pede nove campos,
-- descartando a ficha técnica e o que os compradores escreveram. É o mesmo
-- desperdício do XML que se jogava fora por não ter extensão conhecida.
--
-- AS TRÊS COLUNAS, e por que são texto e não números:
--
--   `ficha` guarda a ficha técnica COMO A PÁGINA ESCREVEU. Não é a IA
--   preenchendo `ram_gb`: é a IA transcrevendo, e o `lerSpecs` — a mesma função
--   testada que já lê o título — passando por cima desse texto para extrair os
--   números. A decisão continua sendo da regra em TypeScript, que é a linha que
--   este módulo não cruza. Se a IA transcrever errado, o erro é de cópia e
--   aparece na tela ao lado do que ela copiou.
--
--   `reclamacoes` é a única coisa aqui que regra nenhuma produz. "4,6 ★ (1.842)"
--   é um número que já se tem; "os compradores dizem que a fonte esquenta" é
--   informação, e é o tipo de coisa que decide uma compra de R$ 4.000.
--
--   `porque_barato` só é preenchida quando o anúncio está materialmente abaixo
--   dos irmãos — a diferença é calculada em TypeScript e ENTREGUE à IA, que só
--   procura na página o que a explica. Perguntar "por que está barato?" sobre um
--   preço normal é pedir para o modelo inventar uma resposta.

alter table public.facilities_radar_ofertas
  add column if not exists ficha         text,
  add column if not exists reclamacoes   text,
  add column if not exists porque_barato text;

comment on column public.facilities_radar_ofertas.ficha is
  'Ficha técnica como a página do anúncio a escreveu, transcrita na conferência. É INSUMO do lerSpecs, não veredito: quem decide continua sendo a regra em TypeScript.';
comment on column public.facilities_radar_ofertas.reclamacoes is
  'Uma linha sobre o que os compradores reclamam, lida das avaliações da própria página. A nota é número; isto é o que o número não conta.';
comment on column public.facilities_radar_ofertas.porque_barato is
  'O que a PÁGINA diz que explica um preço abaixo dos irmãos. Só é pedida quando a diferença é material — do contrário seria convidar o modelo a inventar motivo.';
