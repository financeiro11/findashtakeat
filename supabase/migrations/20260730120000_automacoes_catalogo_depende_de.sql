-- Pré-requisito entre automações (roadmap): "esta automação depende de outra".
-- Usado na visão Roadmap (IA & Automação) para acender a corrente de dependências.
alter table public.automacoes_catalogo
  add column if not exists depende_de uuid references public.automacoes_catalogo(id) on delete set null;
