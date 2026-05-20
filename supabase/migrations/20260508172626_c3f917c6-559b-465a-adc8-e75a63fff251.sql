
CREATE TABLE public.tarefas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ordem INTEGER NOT NULL DEFAULT 0,
  titulo TEXT NOT NULL,
  responsavel TEXT,
  status TEXT NOT NULL DEFAULT 'Backlog',
  prioridade TEXT NOT NULL DEFAULT 'Média',
  prazo DATE,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read tarefas" ON public.tarefas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert tarefas" ON public.tarefas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update tarefas" ON public.tarefas FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete tarefas" ON public.tarefas FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_tarefas_updated_at
BEFORE UPDATE ON public.tarefas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tarefas (ordem, titulo, responsavel, status, prioridade, prazo) VALUES
-- Backlog
(1,'Atualização Apresentação Onboarding','Henrique','Backlog','Baixa','2026-05-10'),
(2,'[JOHN | HULT] Erros de Emissão <> NFs','Henrique','Backlog','Alta','2026-04-30'),
(3,'[JOHN | HULT] Emissão de Notas via Omie','Henrique','Backlog','Alta','2026-05-31'),
(4,'Gravação Marketing','Henrique','Backlog','Baixa','2026-05-04'),
(5,'Criação de Cartões Virtuais - Líderes','Henrique','Backlog','Alta','2026-05-08'),
(6,'Cartão Administrativo - Guilherme','Henrique','Backlog','Média','2026-05-08'),
(7,'Distratos','Henrique','Backlog','Alta','2026-05-06'),
(8,'Pagamento - Quinto Dia Útil','Henrique','Backlog','Alta','2026-05-07'),
-- Em andamento
(9,'Cancelamento de Assinaturas','Henrique','Em andamento','Alta','2026-04-28'),
(10,'Cancelamento do Onfly','Henrique','Em andamento','Média',NULL),
(11,'[MIGUEL] Auditoria Gastos','Henrique','Em andamento','Alta','2026-05-04'),
(12,'Anexação NFs <> Omie','Henrique','Em andamento','Média','2026-05-15'),
(13,'NFe de Compra <> Turbo','Henrique','Em andamento','Média','2026-04-30'),
(14,'Provisão de Contas a Pagar <> Omie','Henrique','Em andamento','Alta','2026-04-30'),
(15,'Playbook Processos Omie','Henrique','Em andamento','Alta','2026-04-30'),
-- Acompanhamento
(16,'[BRITTES] Comissão <> Parceiros','Henrique','Acompanhamento','Urgente','2026-05-15'),
(17,'[TASK | RPA] Categorização com IA <> Omie (Cartão de Crédito)','Henrique','Acompanhamento','Média','2026-04-30'),
(18,'[TASK | RPA] Forma → Omie','Henrique','Acompanhamento','Alta','2026-04-30'),
(19,'[VPK] DRE e DFC: Omie → Tracker','Henrique','Acompanhamento','Alta',NULL),
(20,'[TASK | RPA] Categorização IA <> Omie (Conta Corrente)','Henrique','Acompanhamento','Alta','2026-04-30'),
-- Revisão
(21,'Revisão NFs - CA','Henrique','Revisão','Alta','2026-04-28'),
(22,'Report Q1 - ADS','Henrique','Revisão','Urgente','2026-04-30'),
(23,'Verificação Estornos - Abril','Henrique','Revisão','Alta','2026-05-15'),
-- Concluído
(24,'Atualização e Análise - Tracker','Henrique','Concluído','Média','2026-04-28'),
(25,'Revisão Painel CAC - Takeat OS','Henrique','Concluído','Alta','2026-04-30'),
(26,'DDA - DIVIPRINT (Stand Pizza Masters)','Henrique','Concluído','Alta',NULL),
(27,'Remessa de Pagamentos - Sicoob','Henrique','Concluído','Alta','2026-04-26'),
(28,'[TASK | RPA] Envio de Proporcionais','Henrique','Concluído','Alta','2026-05-05'),
(29,'Conciliação Conta Azul','Henrique','Concluído','Urgente','2026-03-31'),
(30,'Recarga Flash - Viagem','Henrique','Concluído','Alta','2026-04-25'),
(31,'Estornos (24/04)','Henrique','Concluído','Alta','2026-04-24'),
(32,'Distratos (concluído)','Henrique','Concluído','Média','2026-04-27'),
(33,'Cartão Gastos Argentina <> Pedro','Henrique','Concluído','Média','2026-05-08'),
(34,'Cartão para Hospedagem <> Bruno','Henrique','Concluído','Alta','2026-04-28'),
(35,'Emissão de NFs','Henrique','Concluído','Alta','2026-04-30'),
(36,'Verificação Erros Remessa','Henrique','Concluído','Alta','2026-04-30'),
(37,'Estornos (28/04)','Henrique','Concluído','Alta','2026-04-30'),
(38,'Reembolsos','Henrique','Concluído','Média','2026-04-30'),
-- Tasks - RPA
(39,'[TASK | RPA] Criação de Lançamentos no Omie - Comissões Times','Henrique','Tasks - RPA','Média','2026-04-30'),
(40,'[TASK | RPA] Relatório Automático <> Miguel','Henrique','Tasks - RPA','Alta','2026-05-20'),
(41,'Agente Financeiro IA','Henrique','Tasks - RPA','Alta','2026-04-30'),
(42,'[TASK] Solicitação de Estornos (Miguel, Ludmilla e Davi)','Henrique','Tasks - RPA','Média','2026-05-05');
