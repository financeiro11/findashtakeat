-- O "Panorama do dia" acaba, e o painel de notícias passa a cobrir quatro frentes.
--
-- O QUE HAVIA. O card de notícias do briefing tinha duas metades que não se
-- conversavam. Em cima, os itens com link que a função `briefing-noticias` colhe
-- desde 28/08/2026 — com data, veículo, dedup de três semanas e o ✓ de "já li".
-- Embaixo, o "Panorama do dia": três parágrafos que a skill de briefing escrevia
-- todo dia sobre macro Brasil, tech/SaaS e foodservice.
--
-- A QUEIXA, DE 29/08/2026: "essa parte de panorama do dia tá muito repetitiva".
-- E estava, por construção. "Selic em 14% a.a. desde 05/08/2026" é verdade todo
-- santo dia e novidade em exatamente um deles; "Focus projeta IPCA entre 4,22% e
-- 5,02%" muda na terceira casa decimal por semana. A prosa não tinha como se
-- corrigir sozinha porque não tinha as três coisas que fazem um painel diário
-- parar de repetir: data por item, chave de deduplicação e memória do que já foi
-- mostrado. Um parágrafo não deduplica.
--
-- O QUE MUDA. O panorama vira item, como o resto — e as pautas da função passam
-- a cobrir as quatro frentes que interessam:
--
--     IA e inovação  →  ia_ferramentas + ia_backoffice   (dois slots, todo dia)
--     Foodservice    →  foodservice                       (um slot, todo dia)
--     Finanças       →  financas                          ┐ dividem o quarto
--     Startups       →  startups                          ┘ slot, dias alternados
--
-- SEM GASTAR UM CRÉDITO A MAIS. Continuam quatro buscas por dia (~240 créditos
-- por mês contra um teto de 300); o que se reveza é a pauta, não o dinheiro. Uma
-- busca dedicada por frente, todo dia, custaria ~400 e comeria 150 dos 200
-- créditos de reserva do plano — que são o que segura o mês em que uma loja
-- passar a exigir proxy stealth e uma varredura do radar custar cinco vezes
-- mais. A grade está em `SLOTS` no módulo compartilhado, e a escala do dia é
-- função da DATA, não de um contador: rodada repetida não faz a grade andar.
--
-- `concorrentes` VIRA `foodservice`, e não é só nome. A pauta antiga exigia nome
-- de rival no texto — o que a deixava vazia na maioria dos dias, de propósito.
-- A frente nova aceita também o DADO do setor ("foodservice bateu recorde no
-- 2T26: R$ 62,9 bi"), que é justamente o que a prosa do panorama trazia e serve
-- de munição comercial. Para não abrir a porta para a coluna de gastronomia, o
-- dado precisa de dois sinais de mercado — ver `DADO_DE_MERCADO` na régua.

/* ================================================= a pauta que mudou de nome */

update public.briefing_noticias set pauta = 'foodservice' where pauta = 'concorrentes';

/* ============================================================== o que eu acho */

-- 👍 = +1 (quero mais), 👎 = -1 (evite), null = ninguém votou.
--
-- O VOTO FICA NO ITEM, e o que ele ensinou fica em `briefing_noticias_preferencias`.
-- São duas coisas diferentes e guardar as duas é o que torna o aprendizado
-- auditável: a preferência diz "você pediu menos sobre rodada de investimento
-- americana", e o voto diz de qual manchete, exatamente, aquilo saiu. Sem o
-- segundo, a tela de preferências seria uma lista de afirmações sobre o gosto de
-- alguém, sem prova.
alter table public.briefing_noticias
  add column if not exists voto        smallint,
  add column if not exists voto_em     timestamptz,
  add column if not exists voto_por    text,
  -- Quando o voto virou vocabulário. `null` com voto preenchido = está na fila.
  -- A fila existe porque o clique não pode depender de a IA responder: a tela
  -- grava o voto na hora e chama o aprendizado sem esperar, e o que falhar ali
  -- é recolhido pela rodada das 07:55 do dia seguinte.
  add column if not exists aprendido_em timestamptz,
  -- Veredito da IA sobre repetição: "isto é a mesma história que você já viu?".
  -- Não é o mesmo que `mesmaNoticia`, que compara palavras do título e pega o
  -- mesmo lançamento contado por dois veículos. Este pega "Copom mantém juros"
  -- contra "Selic segue em 14%" — mesma história, zero palavras em comum. Item
  -- repetido não some: desce para o rodapé, junto com o "sem novidade".
  add column if not exists repete      boolean;

comment on column public.briefing_noticias.voto is
  '+1 quero mais deste assunto, -1 evite. Vira peso em briefing_noticias_preferencias.';
comment on column public.briefing_noticias.repete is
  'A IA achou que este item conta a mesma história de um já mostrado nas últimas semanas. Vai para o rodapé, não para o lixo.';

-- A fila do aprendizado: votado e ainda não aprendido. Parcial porque é sempre
-- um punhado de linhas contra uma tabela que só cresce.
create index if not exists briefing_noticias_a_aprender
  on public.briefing_noticias (voto_em)
  where voto is not null and aprendido_em is null;
