-- A IA ganha freio, razão — e duas perguntas para responder.
--
-- Três coisas nesta migração, e a ordem não é arbitrária: sem o RAZÃO não há
-- FREIO, e sem freio não se liga trabalho novo de IA.
--
-- ---------------------------------------------------------------------------
-- 1. POR QUE `ai_usage_log` MORREU. Ele tem 7 linhas, todas de 07/05/2026, e o
-- motivo estava na própria definição: `user_id NOT NULL`. Toda IA que roda em
-- cron — triagem de anexo, leitura de nota, radar — não tem usuário nenhum, e o
-- insert falhava. O registro sobreviveu só enquanto alguém clicava na tela.
-- Ou seja: a tabela não caiu em desuso, ela foi TORNADA IMPOSSÍVEL de usar pelo
-- caminho que mais cresceu. `user_id` passa a aceitar nulo, e nulo quer dizer
-- "foi o servidor, não uma pessoa".
--
-- ---------------------------------------------------------------------------
-- 2. O FREIO É POR CHAMADAS/DIA, e não por dinheiro/mês como o do Firecrawl.
-- São riscos diferentes: no Firecrawl o perigo é o plano pré-pago acabar dia 12;
-- aqui não há plano a estourar — o perigo é VOLUME, uma rodada em laço batendo
-- no modelo até o Google devolver 503 para todo mundo, inclusive para as
-- funções que estavam bem. Teto de chamadas por dia é o que mede esse risco.
-- O teto em dólar do mês vem junto, mas como segunda linha: ele protege a conta,
-- não a disponibilidade.
--
-- ---------------------------------------------------------------------------
-- 3. AS DUAS PERGUNTAS que a IA passa a responder sobre o acervo. Medido em
-- 29/08/2026: 565 notas com vários alvos possíveis, 318 disputando o mesmo
-- título e 1.439 sem alvo nenhum.
--
--   • DESEMPATE (`sugestao_ia`) — o casador é determinístico e já fez a parte
--     difícil: reduziu milhares de títulos a dois ou três candidatos. O que ele
--     não faz é LER. Uma das notas ambíguas se chama "Stand Fispal - 2 parcela":
--     a resposta está escrita no nome do arquivo, e uma regra de valor e data
--     não a alcança.
--   • MOTIVO (`nao_casou_motivo`) — as 1.439 sem alvo são hoje uma pilha muda.
--     Não é preciso resolvê-las para ajudar; basta dizer POR QUE cada uma não
--     casou, e a pilha vira fila com dono.
--
-- A IA NÃO ESCREVE `alvo_tipo`. Ela escreve `sugestao_ia`, que é uma opinião
-- carimbada com modelo e data, e quem aponta o alvo continua sendo
-- `notas_externas_definir_alvo` — chamada por gente, na janela que já existe.
-- É o mesmo desenho de `parametrizacao-sugerir` e das recomendações do cartão:
-- sinal determinístico primeiro, IA só onde é preciso significado, pessoa
-- carimba.

/* ============================================================ 1. o razão */

alter table public.ai_usage_log alter column user_id drop not null;

comment on column public.ai_usage_log.user_id is
  'Quem pediu. NULO = foi o servidor (cron, fila, varredura), não uma pessoa. Era NOT NULL até 29/08/2026, e foi exatamente isso que matou o registro: toda IA de cron falhava ao gravar.';

comment on table public.ai_usage_log is
  'Razão de consumo de IA: uma linha por chamada. É o denominador de qualquer conversa sobre custo e a base do freio em `ia_orcamento`.';

create index if not exists ai_usage_log_feature_data
  on public.ai_usage_log (feature, created_at desc);

/* ============================================================ 2. o freio */

create table if not exists public.ia_orcamento (
  consumidor    text primary key,
  rotulo        text not null,
  para_que      text,
  /* O teto que importa: chamadas por dia. Ver o cabeçalho. */
  teto_dia      integer not null default 200,
  /* Segunda linha de defesa, para a conta e não para a disponibilidade. */
  teto_mes_usd  numeric(10,2) not null default 20.00,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

comment on table public.ia_orcamento is
  'Freio de consumo de IA, por consumidor. `teto_dia` (chamadas) protege a DISPONIBILIDADE — é o que impede uma rodada em laço de derrubar o modelo para as outras funções. `teto_mes_usd` protege a conta. Painel: /governanca/vigilancia.';

insert into public.ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd) values
  ('notas_desempate', 'Desempate de nota',
   'Lê a nota e propõe qual dos títulos candidatos é o dela. Não aponta o alvo — propõe.', 120, 8.00),
  ('notas_motivo', 'Motivo de não casar',
   'Classifica por que a nota não achou título: período anterior, fornecedor sem conta aberta, valor divergente, não é nota.', 150, 6.00),
  ('assistente', 'Assistente do Hub',
   'O chat que responde sobre os dados do Hub.', 300, 15.00)
on conflict (consumidor) do nothing;

create or replace function public.ia_orcamento_status()
returns table (
  consumidor text, rotulo text, para_que text, ativo boolean,
  teto_dia integer, usadas_hoje integer, resta_hoje integer,
  teto_mes_usd numeric, gasto_mes_usd numeric
)
language sql
stable
set search_path to 'public'
as $$
  /* O DIA É O DE BRASÍLIA, não o UTC. Um teto diário que vira às 21h da noite
     local seria um teto que ninguém consegue prever — e o pg_cron agenda em UTC
     justamente para confundir quem não presta atenção. */
  with corte as (
    select (date_trunc('day', now() at time zone 'America/Sao_Paulo')
              at time zone 'America/Sao_Paulo') as dia,
           (date_trunc('month', now() at time zone 'America/Sao_Paulo')
              at time zone 'America/Sao_Paulo') as mes
  )
  select
    o.consumidor, o.rotulo, o.para_que, o.ativo, o.teto_dia,
    coalesce((select count(*)::int from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.dia), 0),
    greatest(0, o.teto_dia - coalesce((select count(*)::int from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.dia), 0)),
    o.teto_mes_usd,
    coalesce((select sum(l.cost_usd) from ai_usage_log l, corte
               where l.feature = o.consumidor and l.created_at >= corte.mes), 0)
  from ia_orcamento o
  order by o.consumidor;
$$;

comment on function public.ia_orcamento_status() is
  'Quanto cada consumidor de IA já usou hoje (chamadas) e no mês (dólares). O dia é o de Brasília — teto diário que vira em horário UTC é teto que ninguém consegue prever.';

revoke all on function public.ia_orcamento_status() from public;
revoke all on function public.ia_orcamento_status() from anon;
grant execute on function public.ia_orcamento_status() to authenticated, service_role;

alter table public.ia_orcamento enable row level security;

drop policy if exists ia_orcamento_leitura on public.ia_orcamento;
create policy ia_orcamento_leitura on public.ia_orcamento
  for select to authenticated using (true);

/* ================================================= 3. as duas perguntas */

alter table public.notas_externas
  add column if not exists sugestao_ia       jsonb,
  add column if not exists sugestao_em       timestamptz,
  add column if not exists nao_casou_motivo  text,
  add column if not exists nao_casou_em      timestamptz;

comment on column public.notas_externas.sugestao_ia is
  'OPINIÃO da IA sobre qual candidato é o certo: {alvo_tipo, alvo_id_unico, porque, confianca, modelo}. Nunca é alvo — quem aponta é `notas_externas_definir_alvo`, chamada por gente. Fica nulo enquanto ninguém perguntou.';

comment on column public.notas_externas.nao_casou_motivo is
  'Por que esta nota não achou título, em uma etiqueta curta: periodo_anterior | fornecedor_sem_titulo | valor_divergente | nao_e_nota | indefinido. Serve para triar a pilha, não para resolvê-la.';

/* A fila das duas perguntas.
   IDEMPOTÊNCIA É O FREIO MAIS BARATO: só entra quem ainda não foi perguntado
   (`sugestao_em`/`nao_casou_em` nulos). Sem isso, a mesma nota voltaria em toda
   rodada e o teto diário se gastaria relendo o que já se sabe. */
create or replace function public.notas_externas_fila_explicar(
  p_modo text,
  p_limite int default 20
)
returns table (
  id bigint, nome text, o_que_e text, detalhe text, valor numeric,
  vencimento date, enviado_em date, cnpj text, fonte text, competencia text,
  candidatos jsonb
)
language sql
stable
set search_path to 'public'
as $$
  select n.id, n.nome, n.o_que_e, n.detalhe, n.valor,
         n.vencimento, n.enviado_em, n.cnpj, n.fonte, n.competencia,
         n.candidatos
    from public.notas_externas n
   where n.ignorado_em is null
     and n.copia_de is null
     and n.enviado_erp_em is null
     and not n.alvo_manual
     and case
           when p_modo = 'desempatar' then
             n.alvo_tipo is null and n.candidatos is not null and n.sugestao_em is null
           when p_modo = 'motivo' then
             n.alvo_tipo is null and n.candidatos is null and n.nao_casou_em is null
           else false
         end
   /* Maior valor primeiro: se o teto do dia acabar, que tenha acabado no que
      mais pesa em dinheiro. */
   order by n.valor desc nulls last, n.id
   limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;

comment on function public.notas_externas_fila_explicar(text, int) is
  'As notas que ainda esperam uma das duas perguntas da IA. Só entra quem nunca foi perguntado — reperguntar é a forma mais fácil de gastar o teto diário sem aprender nada. Ordena por valor: se o teto acabar, que acabe no que pesa.';

revoke all on function public.notas_externas_fila_explicar(text, int) from public;
revoke all on function public.notas_externas_fila_explicar(text, int) from anon;
grant execute on function public.notas_externas_fila_explicar(text, int) to authenticated, service_role;

/* Quanto ainda falta perguntar — para a tela dizer o tamanho sem ler a fila. */
create or replace function public.notas_externas_explicar_resumo()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'desempatar_fila', (select count(*) from public.notas_externas
                         where ignorado_em is null and copia_de is null and enviado_erp_em is null
                           and not alvo_manual and alvo_tipo is null
                           and candidatos is not null and sugestao_em is null),
    'desempatar_feitas', (select count(*) from public.notas_externas where sugestao_ia is not null),
    'motivo_fila', (select count(*) from public.notas_externas
                     where ignorado_em is null and copia_de is null and enviado_erp_em is null
                       and not alvo_manual and alvo_tipo is null
                       and candidatos is null and nao_casou_em is null),
    'motivo_feitas', (select count(*) from public.notas_externas where nao_casou_motivo is not null),
    'por_motivo', (select jsonb_object_agg(m, n) from (
                     select nao_casou_motivo as m, count(*) as n
                       from public.notas_externas
                      where nao_casou_motivo is not null group by 1) t)
  );
$$;

revoke all on function public.notas_externas_explicar_resumo() from public;
revoke all on function public.notas_externas_explicar_resumo() from anon;
grant execute on function public.notas_externas_explicar_resumo() to authenticated, service_role;
