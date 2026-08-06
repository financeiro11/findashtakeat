-- Posição livre do nó na Árvore de Automações (aba IA & Automação).
-- NULL = ainda não foi arrastado; a árvore calcula a posição automática.
alter table public.automacoes_catalogo
  add column if not exists pos_x double precision,
  add column if not exists pos_y double precision;
