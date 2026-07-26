-- Rituais & reuniões do time financeiro (cadência mensal + reuniões táticas/estratégicas).
-- Editável no Hub (/time/visao → aba Rituais). pauta = lista de tópicos (string[]).

CREATE TABLE IF NOT EXISTS public.time_rituais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  tipo          text,            -- "Cadência mensal" | "Tática" | "Estratégica" | …
  periodicidade text,            -- "Semanal" | "Mensal" | "Semana 1" | …
  descricao     text,
  pauta         jsonb NOT NULL DEFAULT '[]',   -- string[]
  ordem         int NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.time_rituais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_rituais_rw_auth" ON public.time_rituais;
CREATE POLICY "time_rituais_rw_auth" ON public.time_rituais
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.time_rituais (id, titulo, tipo, periodicidade, descricao, pauta, ordem) VALUES
('bbbbbbb1-0000-0000-0000-000000000001', 'Fechamento do mês anterior', 'Cadência mensal', 'Semana 1', 'Conciliação bancária, DRE e DFC do mês que fechou.', '[]', 0),
('bbbbbbb1-0000-0000-0000-000000000002', 'Revisão de processos', 'Cadência mensal', 'Semana 2', 'Revisão profunda de processos internos, despesas e ERP.', '[]', 1),
('bbbbbbb1-0000-0000-0000-000000000003', 'Revisão orçamentária', 'Cadência mensal', 'Semana 3', 'Real vs. orçado completo e atualização de projeções.', '[]', 2),
('bbbbbbb1-0000-0000-0000-000000000004', 'Preparação do fechamento', 'Cadência mensal', 'Semana 4', 'Provisões, pagamentos e acertos para virar o mês.', '[]', 3),
('bbbbbbb1-0000-0000-0000-000000000005', 'Reunião Tática', 'Tática', 'Semanal', 'Alinhamento operacional do time financeiro.',
  '["Status de contas a pagar e a receber","Pendências de conciliação (Sicoob / Asaas)","Bloqueios da semana e prioridades","Follow-up de tarefas do tracker"]', 4),
('bbbbbbb1-0000-0000-0000-000000000006', 'Reunião Estratégica', 'Estratégica', 'Mensal', 'Resultado e direção com a diretoria.',
  '["Real vs. orçado (DRE / DFC)","Métricas SaaS (MRR, churn, CAC/LTV)","Fluxo de caixa e capital de giro","Decisões de investimento e captação"]', 5)
ON CONFLICT (id) DO NOTHING;
