-- Árvore de competências / escopo do financeiro (skill tree). Mapeia o que o
-- financeiro faz HOJE e o que queremos puxar no FUTURO, agrupado nos 3 pilares do
-- Padrão de Mercado (Contabilidade, Controladoria, Tesouraria) + Estratégico.
-- Status por nó: hoje (dominado) / construindo (desbloqueando) / futuro (a desbloquear).
-- Estrutura em árvore via parent_id (tronco = branch, folhas = competências).
create table if not exists public.time_escopos (
  id uuid primary key default gen_random_uuid(),
  pilar text not null,
  titulo text not null,
  descricao text,
  status text not null default 'futuro' check (status in ('hoje','construindo','futuro')),
  parent_id uuid references public.time_escopos(id) on delete cascade,
  responsavel text,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.time_escopos enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_escopos' and policyname = 'time_escopos_all_auth'
  ) then
    create policy time_escopos_all_auth on public.time_escopos for all to authenticated using (true) with check (true);
  end if;
end $$;

create index if not exists time_escopos_parent_idx on public.time_escopos(parent_id);

-- Seed inicial (só se a tabela estiver vazia). Statuses refletem o que já vi rodando
-- no Hub da Takeat; a Júlia ajusta pela tela.
do $$
begin
  if exists (select 1 from public.time_escopos) then return; end if;

  -- Troncos (nível 1)
  insert into public.time_escopos (pilar, titulo, status, ordem) values
    ('Tesouraria','Gestão de Caixa','hoje',0),
    ('Tesouraria','Contas a Pagar','hoje',1),
    ('Tesouraria','Contas a Receber','construindo',2),
    ('Tesouraria','Relacionamento Bancário','hoje',3),
    ('Contabilidade','Contábil','construindo',0),
    ('Contabilidade','Fiscal / Tributário','construindo',1),
    ('Contabilidade','Departamento Pessoal','construindo',2),
    ('Contabilidade','Governança Societária','futuro',3),
    ('Controladoria','Relatórios Gerenciais','hoje',0),
    ('Controladoria','Orçamento','hoje',1),
    ('Controladoria','Métricas SaaS & FP&A','hoje',2),
    ('Controladoria','Controles Internos & Auditoria','hoje',3),
    ('Estratégico','Captação de Recursos','construindo',0),
    ('Estratégico','Pricing','futuro',1),
    ('Estratégico','M&A / Fusões e Aquisições','futuro',2),
    ('Estratégico','Relação com Investidores','futuro',3);

  -- Competências (nível 2), penduradas no tronco por (pilar, título)
  insert into public.time_escopos (pilar, titulo, status, ordem, parent_id) values
    ('Tesouraria','Conciliação diária e posição de caixa','hoje',0,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Gestão de Caixa')),
    ('Tesouraria','Meios de pagamento (PIX, boletos, cartões)','hoje',1,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Gestão de Caixa')),
    ('Tesouraria','Aplicações de curto prazo e liquidez','construindo',2,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Gestão de Caixa')),
    ('Tesouraria','Conferência fiscal e agendamento','hoje',0,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Contas a Pagar')),
    ('Tesouraria','Compras / procurement (Facilities)','hoje',1,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Contas a Pagar')),
    ('Tesouraria','Alçadas e compliance de aprovação','construindo',2,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Contas a Pagar')),
    ('Tesouraria','Faturamento e baixa de títulos','construindo',0,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Contas a Receber')),
    ('Tesouraria','Cobrança e inadimplência (régua)','futuro',1,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Contas a Receber')),
    ('Tesouraria','Contas, cartões e conta corrente','hoje',0,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Relacionamento Bancário')),
    ('Tesouraria','Empréstimos, linhas e garantias','futuro',1,(select id from public.time_escopos where pilar='Tesouraria' and titulo='Relacionamento Bancário')),

    ('Contabilidade','Conciliações, provisões e reconciliações','construindo',0,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Contábil')),
    ('Contabilidade','Balanço e Balancete','hoje',1,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Contábil')),
    ('Contabilidade','Imobilizado e depreciação','futuro',2,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Contábil')),
    ('Contabilidade','Apurações de impostos','construindo',0,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Fiscal / Tributário')),
    ('Contabilidade','Obrigações acessórias (SPED, ECD/EFD)','futuro',1,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Fiscal / Tributário')),
    ('Contabilidade','Folha, encargos e benefícios','construindo',0,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Departamento Pessoal')),
    ('Contabilidade','Livros societários, atas e junta comercial','futuro',0,(select id from public.time_escopos where pilar='Contabilidade' and titulo='Governança Societária')),

    ('Controladoria','DRE gerencial (real vs. orçado)','hoje',0,(select id from public.time_escopos where pilar='Controladoria' and titulo='Relatórios Gerenciais')),
    ('Controladoria','DFC — fluxo de caixa','hoje',1,(select id from public.time_escopos where pilar='Controladoria' and titulo='Relatórios Gerenciais')),
    ('Controladoria','Relatório à diretoria / Briefing','hoje',2,(select id from public.time_escopos where pilar='Controladoria' and titulo='Relatórios Gerenciais')),
    ('Controladoria','Orçamento anual por área','hoje',0,(select id from public.time_escopos where pilar='Controladoria' and titulo='Orçamento')),
    ('Controladoria','Realizado × orçado (Omie)','hoje',1,(select id from public.time_escopos where pilar='Controladoria' and titulo='Orçamento')),
    ('Controladoria','Rolling forecast','construindo',2,(select id from public.time_escopos where pilar='Controladoria' and titulo='Orçamento')),
    ('Controladoria','MRR e assinaturas (Asaas)','hoje',0,(select id from public.time_escopos where pilar='Controladoria' and titulo='Métricas SaaS & FP&A')),
    ('Controladoria','Churn e retenção (NRR)','construindo',1,(select id from public.time_escopos where pilar='Controladoria' and titulo='Métricas SaaS & FP&A')),
    ('Controladoria','CAC / LTV','construindo',2,(select id from public.time_escopos where pilar='Controladoria' and titulo='Métricas SaaS & FP&A')),
    ('Controladoria','Projeção de caixa (45 dias)','futuro',3,(select id from public.time_escopos where pilar='Controladoria' and titulo='Métricas SaaS & FP&A')),
    ('Controladoria','Cruzamento cartão × NF','hoje',0,(select id from public.time_escopos where pilar='Controladoria' and titulo='Controles Internos & Auditoria')),
    ('Controladoria','Rateios e centros de custo','hoje',1,(select id from public.time_escopos where pilar='Controladoria' and titulo='Controles Internos & Auditoria')),
    ('Controladoria','Cenários e alertas preditivos','futuro',2,(select id from public.time_escopos where pilar='Controladoria' and titulo='Controles Internos & Auditoria')),

    ('Estratégico','Editais e fomento (BNDES/FINEP)','hoje',0,(select id from public.time_escopos where pilar='Estratégico' and titulo='Captação de Recursos')),
    ('Estratégico','Investimentos Takeat LTD/LLC','hoje',1,(select id from public.time_escopos where pilar='Estratégico' and titulo='Captação de Recursos')),
    ('Estratégico','Venture debt e captação com investidores','futuro',2,(select id from public.time_escopos where pilar='Estratégico' and titulo='Captação de Recursos')),
    ('Estratégico','Análise de margem por produto/cliente','construindo',0,(select id from public.time_escopos where pilar='Estratégico' and titulo='Pricing')),
    ('Estratégico','Modelo de precificação','futuro',1,(select id from public.time_escopos where pilar='Estratégico' and titulo='Pricing')),
    ('Estratégico','Valuation e due diligence','futuro',0,(select id from public.time_escopos where pilar='Estratégico' and titulo='M&A / Fusões e Aquisições')),
    ('Estratégico','Integração pós-aquisição','futuro',1,(select id from public.time_escopos where pilar='Estratégico' and titulo='M&A / Fusões e Aquisições')),
    ('Estratégico','Cap table e reporte a conselho','construindo',0,(select id from public.time_escopos where pilar='Estratégico' and titulo='Relação com Investidores')),
    ('Estratégico','Data room e governança','futuro',1,(select id from public.time_escopos where pilar='Estratégico' and titulo='Relação com Investidores'));
end $$;
