-- Layout "trilha": o futuro se divide em 1–2 anos (curto) e 3–5 anos (longo).
-- horizonte só é usado quando status='futuro'; hoje/construindo ignoram.
alter table public.time_escopos add column if not exists horizonte text; -- 'curto' | 'longo'

-- Horizonte das competências futuras (folhas).
update public.time_escopos set horizonte = 'curto'
where status = 'futuro' and parent_id is not null and titulo in (
  'Cobrança e inadimplência (régua)',
  'Obrigações acessórias (SPED, ECD/EFD)',
  'Projeção de caixa (45 dias)',
  'Venture debt e captação com investidores',
  'Modelo de precificação',
  'Data room e governança',
  'Cenários e alertas preditivos'
);
update public.time_escopos set horizonte = 'longo'
where status = 'futuro' and parent_id is not null and titulo in (
  'Empréstimos, linhas e garantias',
  'Imobilizado e depreciação',
  'Livros societários, atas e junta comercial',
  'Valuation e due diligence',
  'Integração pós-aquisição'
);

-- Responsáveis sugeridos nas competências ativas (Henrique = controladoria/relatórios/
-- estratégico-financeiro; Júlia = tesouraria/contábil-ops/auditoria). Futuras ficam sem
-- dono de propósito (o painel lateral cutuca a nomear antes de virar meta). Usuário reatribui.
update public.time_escopos set responsavel = 'Henrique' where parent_id is not null and titulo in (
  'DRE gerencial (real vs. orçado)','DFC — fluxo de caixa','Relatório à diretoria / Briefing',
  'Orçamento anual por área','Realizado × orçado (Omie)','Rolling forecast',
  'MRR e assinaturas (Asaas)','Churn e retenção (NRR)','CAC / LTV','Rateios e centros de custo',
  'Editais e fomento (BNDES/FINEP)','Investimentos Takeat LTD/LLC',
  'Análise de margem por produto/cliente','Cap table e reporte a conselho'
);
update public.time_escopos set responsavel = 'Júlia' where parent_id is not null and titulo in (
  'Conciliação diária e posição de caixa','Meios de pagamento (PIX, boletos, cartões)',
  'Aplicações de curto prazo e liquidez','Conferência fiscal e agendamento',
  'Compras / procurement (Facilities)','Faturamento e baixa de títulos',
  'Contas, cartões e conta corrente','Cruzamento cartão × NF','Balanço e Balancete',
  'Conciliações, provisões e reconciliações','Apurações de impostos','Folha, encargos e benefícios'
);
