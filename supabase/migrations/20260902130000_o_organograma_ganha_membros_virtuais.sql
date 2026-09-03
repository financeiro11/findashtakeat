-- O organograma passa a ter membros virtuais.
--
-- Um agente de IA é um cargo como qualquer outro: mesma árvore, mesmo ano, mesma
-- linhagem, mesmas atribuições. O que muda é `tipo='agente'` — em vez de uma pessoa,
-- o card mostra o canal por onde se fala com ele, as automações do catálogo que ele
-- executa e o registro em `public.agentes` (alçada, execuções, fila de exceções).
-- A hierarquia continua respondendo à pergunta que faltava: QUEM responde por esse bot.
--
-- Modelar como cargo (e não como "automação com foto") é de propósito: um agente que
-- faz o papel de um estagiário tem descrição de função, supervisor e ano de estreia —
-- e é isso que o organograma já sabe guardar. Agente ≠ automação: um agente EXECUTA
-- N automações do catálogo, e é dessa lista que sai o "o que ele faz" e as horas/mês.

alter table public.time_cargos
  add column if not exists tipo text not null default 'humano'
    check (tipo in ('humano', 'agente')),
  add column if not exists agente_ref text references public.agentes(id),
  add column if not exists agente_canal text,
  add column if not exists agente_automacoes uuid[] not null default '{}';

comment on column public.time_cargos.tipo is
  'humano = pessoa ou vaga (entra na folha); agente = membro virtual (não entra).';
comment on column public.time_cargos.agente_ref is
  'Liga o card ao registro do agente em public.agentes: alçada, execuções e exceções.';
comment on column public.time_cargos.agente_canal is
  'Por onde se fala com ele: Telegram, Hub, E-mail, WhatsApp…';
comment on column public.time_cargos.agente_automacoes is
  'Automações do catálogo que este agente executa. Fonte do "o que ele faz" e das horas/mês devolvidas.';

-- ---------------------------------------------------------------------------
-- Resumo por agente. O front precisa de contagem por resultado, e PostgREST não
-- agrupa — sem esta view a página baixaria as 300+ linhas de execução só para contar.
-- security_invoker: as policies de agentes/agente_execucoes já liberam leitura para
-- `authenticated`, então a view não precisa (nem deve) enxergar mais que quem a chama.
create or replace view public.agentes_resumo
with (security_invoker = true) as
select
  a.id,
  a.nome,
  a.descricao,
  a.alcada_maxima,
  a.ativo,
  count(e.id) filter (where e.resultado = 'executado') as execucoes,
  count(e.id) filter (where e.resultado = 'falhou')    as falhas,
  count(e.id) filter (where e.resultado = 'escalado')  as escaladas,
  max(e.executado_em)                                  as ultima_execucao,
  (select count(*) from public.agente_excecoes x
    where x.agente_id = a.id and x.status = 'aberta')  as excecoes_abertas
from public.agentes a
left join public.agente_execucoes e on e.agente_id = a.id
group by a.id, a.nome, a.descricao, a.alcada_maxima, a.ativo;

-- O grant para `anon` sai automático em objeto novo; aqui ninguém lê deslogado.
revoke all on public.agentes_resumo from anon;
grant select on public.agentes_resumo to authenticated;

-- ---------------------------------------------------------------------------
-- Thétys, a primeira membro virtual: faz o papel do estagiário, na nuvem, 24/7.
-- O nome estava abreviado e com typo no catálogo desde a importação — como agora ele
-- vira o rótulo de um membro do time, passa a ser escrito por extenso.
update public.automacoes_catalogo
   set automacao = 'Thétys — Tesouraria e CAP'
 where id = 'fa12c41e-d6ab-4d6d-8425-fbb1a77accf8'
   and automacao = 'Tets - Tesouria e CAP';

update public.agentes
   set nome = 'Thétys — Tesouraria e CAP',
       automacao_id = 'fa12c41e-d6ab-4d6d-8425-fbb1a77accf8',
       atualizado_em = now()
 where id = 'thetys';

-- As atribuições vêm do card "Estagiário" (é literalmente o papel que ela assumiu),
-- com o bloco de alçada reescrito para a realidade do agente: teto amarelo, o que
-- passa disso vira exceção com SLA na fila do humano.
insert into public.time_cargos
  (id, titulo, pessoa, senioridade, status, acumulo, prioridade, custo_mensal, alvo,
   parent_id, atribuicoes, ordem, ano, chave, desacoplado,
   tipo, agente_ref, agente_canal, agente_automacoes)
select
  v.id, 'Thétys', null, 'Agente autônomo · nível 5', 'efetivo', false, null, null, null,
  v.parent_id,
  '[
    {"titulo":"Contas a Pagar","itens":[
      "Triagem de NF, boletos e cobranças, e cobrança do documento faltante ao fornecedor",
      "Lançamento no Omie: fornecedor, categoria, centro de custo e vencimento",
      "Montagem do lote e cadastro do pagamento no banco (não autoriza)",
      "Conferência de reembolsos e prestação de contas de viagem",
      "Recargas corporativas (viagem, cartão Flash e linhas comerciais), com conferência do comprovante"
    ]},
    {"titulo":"Conciliação e ERP","itens":[
      "Conciliação diária (Sicoob e Asaas Disponível)",
      "Anexação de documentos fiscais e amarração comprovante × título",
      "Organização do Drive por competência para a Contabilidade",
      "Cadastro e manutenção de fornecedores e clientes no Omie, incluindo a amarração Asaas × Omie"
    ]},
    {"titulo":"Tracker e apoio ao fechamento","itens":[
      "Atualização periódica das bases e checagem de consistência",
      "Preparação de insumos para o fechamento (extratos e exportações)",
      "Coleta de notas para a auditoria cartão × NF"
    ]},
    {"titulo":"Faturamento e NF a clientes","itens":[
      "Emissão de NF a clientes no Omie e acompanhamento até o faturamento do mês fechar",
      "Tratamento de erros de emissão e de notas com retenção"
    ]},
    {"titulo":"Alçada e controles","itens":[
      "Alçada máxima amarela: o que passa do teto vira exceção com SLA na fila do humano",
      "Prepara e agenda pagamentos; a autorização continua sendo de gente",
      "Cada decisão fica registrada em agente_execucoes — entrada, saída, confiança e resultado",
      "A correção humana na fila é o que ela usa para aprender"
    ]}
  ]'::jsonb,
  3, v.ano, 'a9e70000-0000-4000-8000-000000000001', false,
  'agente', 'thetys', 'Telegram', array['fa12c41e-d6ab-4d6d-8425-fbb1a77accf8']::uuid[]
from (values
  ('a9e72026-0000-4000-8000-000000000001'::uuid, 2026, '33333333-3333-3333-3333-333333333333'::uuid),
  ('a9e72027-0000-4000-8000-000000000001'::uuid, 2027, '82ff0242-192e-489d-8b64-fe3f3382f00c'::uuid),
  ('a9e72028-0000-4000-8000-000000000001'::uuid, 2028, '78a2a5b4-48de-4e15-acaa-5c53bad47b62'::uuid)
) as v(id, ano, parent_id)
on conflict (id) do nothing;
