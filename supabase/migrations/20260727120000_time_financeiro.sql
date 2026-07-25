-- Time Financeiro — estrutura do time (organograma, funções, vagas) + próximos passos.
-- A página /time/visao é a fonte da verdade (a planilha da diretoria foi importada uma
-- única vez como seed e será abandonada). CRUD é feito no cliente com a sessão do usuário.

CREATE TABLE IF NOT EXISTS public.time_cargos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  pessoa        text,                          -- null = vaga/planejado
  senioridade   text,                          -- Gerência, Pleno, …
  status        text NOT NULL DEFAULT 'planejado'
                CHECK (status IN ('efetivo','vaga_aberta','entrevista','contratado','planejado')),
  acumulo       boolean NOT NULL DEFAULT false, -- pessoa acumula com outro cargo
  prioridade    text,                          -- Alta / Média / Baixa (vagas)
  custo_mensal  numeric,                       -- custo estimado da vaga (R$/mês)
  alvo          text,                          -- horizonte ("2026", "3–5 anos")
  parent_id     uuid REFERENCES public.time_cargos(id) ON DELETE SET NULL,
  atribuicoes   jsonb NOT NULL DEFAULT '[]',   -- [{titulo, itens: [..]}]
  ordem         int NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_passos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto     text NOT NULL,
  done      boolean NOT NULL DEFAULT false,
  ordem     int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.time_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_passos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_cargos_rw_auth" ON public.time_cargos;
CREATE POLICY "time_cargos_rw_auth" ON public.time_cargos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "time_passos_rw_auth" ON public.time_passos;
CREATE POLICY "time_passos_rw_auth" ON public.time_passos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------- seed (planilha)
INSERT INTO public.time_cargos (id, titulo, pessoa, senioridade, status, acumulo, prioridade, custo_mensal, alvo, parent_id, ordem, atribuicoes) VALUES
('11111111-1111-1111-1111-111111111111', 'Gerente Financeiro', 'Henrique', 'Gerência', 'efetivo', false, NULL, NULL, NULL, NULL, 0, '[
  {"titulo":"Planejamento e gestão do setor","itens":["Acompanhar execução orçamentária","Controlar movimentações da tesouraria","Gerir contratos de fornecedores","Autorizações bancárias de despesas","Interface com instituições financeiras","Acompanhar indicadores de desempenho (KPIs)","Analisar relatórios gerenciais","Conduzir implantação de políticas e melhorias","Verificar regularidades fiscais da empresa","Apoiar mecanismos de controladoria de outros setores (TI, comercial, RH)","Analisar ocorrências de perdas e impacto de riscos"]},
  {"titulo":"Captação de recursos","itens":["Fluxo de financiamentos","Gestão de editais e fomentos governamentais"]},
  {"titulo":"Gestão de pessoas","itens":["Identificar necessidade de novas funções","Participar de admissões e demissões","Canais de comunicação entre líderes e liderados","Promover desenvolvimento do colaborador","Determinação de tarefas","Avaliar desempenho de colaboradores","Proporcionar condições para o desempenho da função"]},
  {"titulo":"Projetos com a diretoria","itens":["Administrar projetos de curto, médio e longo prazo para máxima eficiência financeira"]},
  {"titulo":"Ativos e passivos","itens":["Gestão dos ativos/passivos totais da empresa"]},
  {"titulo":"Reports","itens":["Reports periódicos a diretores e investidores sobre a saúde financeira","Responder demandas específicas da diretoria"]},
  {"titulo":"Escritórios administrativos","itens":["Administrar os escritórios, junto ao RH"]},
  {"titulo":"Jurídico","itens":["Interface com o Jurídico na ausência de equipe específica"]},
  {"titulo":"Processos contábeis","itens":["Acompanhamento da confecção das DFs","Auditoria de balanço","Demais obrigações contábeis"]},
  {"titulo":"Análise e execução de estornos","itens":[]}
]'::jsonb),
('22222222-2222-2222-2222-222222222222', 'Controladoria', 'Henrique', 'acumula com Gerência', 'efetivo', true, NULL, NULL, NULL, '11111111-1111-1111-1111-111111111111', 1, '[
  {"titulo":"Manutenção de DRE/DFC e apresentações","itens":["Atualizar bases gerenciais e revisar despesas e custos","Verificar coerências na estrutura das planilhas","Controles para fechamento gerencial e contábil 100% fidedigno"]},
  {"titulo":"Processos internos","itens":["Elaborar processos que tragam eficiência para a área"]},
  {"titulo":"Relatórios orçamentários","itens":["Despesas por área de negócio / centro de custo","Acompanhamentos periódicos com o gestor de cada área","Suporte às áreas de negócio em controladoria"]},
  {"titulo":"Acompanhamento de resultados","itens":["Real × Orçado/Meta (macro e micro)","Apresentação mensal, trimestral e anual aos stakeholders","Acompanhar rotina de Vendas e a organização dos dados"]},
  {"titulo":"Controles gerais","itens":["Ativos imobilizados e controles de SaaS"]},
  {"titulo":"Estratégia","itens":["Suporte na implementação de estratégias por área"]}
]'::jsonb),
('33333333-3333-3333-3333-333333333333', 'CAP', 'Júlia', 'Pleno', 'efetivo', false, NULL, NULL, NULL, '11111111-1111-1111-1111-111111111111', 2, '[
  {"titulo":"Gestão de Caixa","itens":["Contas a Pagar e Contas a Receber","Agendamento de pagamentos e controle de saldos","Políticas de reembolso e viagens"]},
  {"titulo":"ERP Financeiro","itens":["Conciliação diária (Sicoob e Asaas Disponível)","Anexação de documentos fiscais","Adequações de acordo com a Contabilidade"]},
  {"titulo":"Tesouraria","itens":["Mantenedora da política de contas a pagar"]},
  {"titulo":"Tracker","itens":["Atualização periódica e checagem","Apoio em análises de métricas e KPIs","Apoio na construção de relatórios e apresentações"]},
  {"titulo":"Editais","itens":["Controle de prazos e atividades","Prestação de contas"]},
  {"titulo":"Auditoria","itens":["Apoio em auditorias internas e due diligence"]},
  {"titulo":"Automação","itens":["Soluções inteligentes e automáticas para processos financeiros","Revisão sistemática dos processos para otimização"]}
]'::jsonb),
('44444444-4444-4444-4444-444444444444', 'CAR e Clientes', NULL, 'Pleno', 'vaga_aberta', false, 'Alta', 8000, '2026', '11111111-1111-1111-1111-111111111111', 3, '[
  {"titulo":"Apoio na controladoria","itens":["Curadoria e fornecimento de dados","Mapeamento de processos para prevenir gargalos","Gestão de contratos de vendas e vida financeira do cliente"]},
  {"titulo":"Suporte operacional","itens":["Identificar e contatar clientes inadimplentes","Suportes operacionais: e-mails, cancelamentos, devoluções, fiscal"]},
  {"titulo":"Desenvolvimento de processos de proteção","itens":["Minimizar ocorrência de perdas","Prevenir fraudes junto a todos os stakeholders","Metas de recuperação de inadimplência","Viabilizar melhorias de controladoria por outros setores"]},
  {"titulo":"Gestão de contratos de clientes","itens":["Acompanhar fechamento comercial e confecção de contrato","Controle dos contratos de vendas"]},
  {"titulo":"Fiscal","itens":["Acompanhamento do faturamento","Emissão e apuração de notas fiscais","Processos que otimizem a eficiência da área"]}
]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.time_passos (id, texto, done, ordem) VALUES
('aaaaaaa1-0000-0000-0000-000000000001', 'Contratar CAR e Clientes (vaga aberta, prioridade alta)', false, 0),
('aaaaaaa1-0000-0000-0000-000000000002', 'Consolidar Tarefas, Projetos e Automações dentro do menu Time Financeiro', false, 1),
('aaaaaaa1-0000-0000-0000-000000000003', 'Mapear o organograma-alvo para 3–5 anos', false, 2)
ON CONFLICT (id) DO NOTHING;
