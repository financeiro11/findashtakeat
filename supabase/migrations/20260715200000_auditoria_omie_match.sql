-- Cruzamento do Omie direto no achado.
--
-- Achados sem vínculo com a base do cartão (id_transacao nulo — ex.: faturas
-- importadas direto na tabela `auditoria`, como a de Julho/2026) não conseguiam
-- herdar a categoria contábil do Omie, que só existia em
-- `auditoria_cartao_lancamentos` e era lida via id_transacao. Sem base de cartão e
-- sem id_transacao, o "Cruzar com Omie" nunca preenchia a categoria.
--
-- Estas colunas permitem casar o achado DIRETO com o Omie (por valor + data, mesma
-- lógica de _shared/match-cartao.ts) e guardar a categoria no próprio achado.
alter table public.auditoria
  add column if not exists omie_categoria_codigo   text,
  add column if not exists omie_categoria_descricao text,
  add column if not exists omie_match_confianca     text,
  add column if not exists omie_matched_em          timestamptz;
