-- Esteira (linha de produção): a ordem em que as automações vão ser construídas.
--
-- esforco         — escala Baixo/Médio/Alto, par do impacto. Os dois somados dão
--                   a prioridade: alto impacto + baixo esforço vai para o topo.
-- esteira_ordem   — posição fixada na mão. NULL = a esteira decide sozinha, que é
--                   o padrão. Mesmo contrato de pos_x/pos_y da árvore: arrastou,
--                   fixou; "soltar" volta a null e o item reencontra o lugar dele.
-- esteira_upgrade — automação que já roda entra na fila pelo upgrade dela. É
--                   opt-in: sem isso, quem está Rodando não ocupa a linha.
alter table public.automacoes_catalogo add column if not exists esforco text;
alter table public.automacoes_catalogo add column if not exists esteira_ordem int;
alter table public.automacoes_catalogo add column if not exists esteira_upgrade boolean not null default false;
