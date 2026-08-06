-- Níveis da pirâmide viram dado: criar um nível novo faz ele aparecer na árvore
-- e na pirâmide sem tocar em código.
create table if not exists public.automacoes_niveis (
  id uuid primary key default gen_random_uuid(),
  n integer not null unique,
  nome text not null,
  descricao text,
  bullets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automacoes_niveis enable row level security;

drop policy if exists "Auth read niveis" on public.automacoes_niveis;
drop policy if exists "Auth insert niveis" on public.automacoes_niveis;
drop policy if exists "Auth update niveis" on public.automacoes_niveis;
drop policy if exists "Auth delete niveis" on public.automacoes_niveis;
create policy "Auth read niveis"   on public.automacoes_niveis for select to authenticated using (true);
create policy "Auth insert niveis" on public.automacoes_niveis for insert to authenticated with check (true);
create policy "Auth update niveis" on public.automacoes_niveis for update to authenticated using (true);
create policy "Auth delete niveis" on public.automacoes_niveis for delete to authenticated using (true);

-- Ícone do nó na árvore (nome do ícone lucide). NULL = deduzido pelo nome.
alter table public.automacoes_catalogo add column if not exists icone text;

-- Semente: os 5 níveis que já existiam fixos no código.
insert into public.automacoes_niveis (n, nome, bullets) values
  (1, 'Fundação Operacional', '["Caixa, pagamentos e conciliação com rotinas automatizadas","Relatórios operacionais recorrentes (posição e cortes de caixa)","Consolidações automáticas no Omie (comissões, categorias, faturas)"]'::jsonb),
  (2, 'Controles & Auditoria', '["Cruzamentos automáticos (cartão × notas fiscais)","Playbooks de fluxos operacionais (n8n)","Trilhas de verificação contínuas sobre os lançamentos"]'::jsonb),
  (3, 'Relatórios, Insights & FP&A', '["DRE e DFC — real vs. orçado","Orçamento por área e métricas SaaS (MRR, CAC/LTV, NRR)","Análise de churn real","Relatório gerencial para diretoria"]'::jsonb),
  (4, 'Projeções & Cenários', '["Projeção de caixa (45 dias)","Cenários e simulações orçamentárias","Alertas preditivos de desvio"]'::jsonb),
  (5, 'Financeiro Autônomo', '["Agentes executando rotinas ponta a ponta","Decisões assistidas com aprovação humana","Fechamento contínuo (continuous close)"]'::jsonb)
on conflict (n) do nothing;
