-- Oportunidade de melhoria de uma automação que já roda. Preenchido = o nó
-- ganha a seta verde na árvore e o bloco "Upgrade" na ficha.
alter table public.automacoes_catalogo add column if not exists upgrade text;
