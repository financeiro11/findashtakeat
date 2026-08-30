-- O briefing vira lugar de resolver, não só de ler.
--
-- Pedido do usuário em 29/08/2026: "tudo que for ação e cair no briefing eu
-- quero poder ir lendo e já ir endereçando solução por ali mesmo".
--
-- O briefing já traz os e-mails ACIONÁVEIS, curados pelo agente que o gera —
-- `briefing_diario.emails`, cada item com remetente, assunto, data e a AÇÃO:
--
--   {"remetente":"suporte@contaazul.com",
--    "assunto":"Você tem uma cobrança que vencerá AMANHÃ!",
--    "acao":"Conferir e providenciar pagamento da cobrança GETDEMO, venc. 30/08"}
--
-- A primeira versão desta tabela (migração `20260829270000`) apontava para a
-- caixa errada: `email_mensagens`, alimentada pelo `gmail-nf-sync` e portanto só
-- com e-mail de NOTA FISCAL — quase todo de `noreply@`. Na rodada real, 3 de 3
-- saíram "não precisa responder", corretamente. O corpus certo era este.
--
-- ---------------------------------------------------------------------------
-- A CHAVE MUDA, e é o miolo da reestruturação. O item do briefing NÃO carrega o
-- id da mensagem no Gmail — e sem id não há como responder dentro da conversa.
-- Então a chave passa a ser o próprio item (remetente + assunto + data), e o
-- `gmail_id` é o que a busca DESCOBRE depois, podendo não descobrir.
--
-- A BUSCA PODE ACHAR A MENSAGEM ERRADA, e a tela precisa dizer qual achou. Um
-- assunto como "Sua fatura chegou" se repete todo mês; casar por remetente e
-- assunto acha a thread mais recente, que quase sempre é a certa e às vezes não
-- é. Por isso `msg_assunto` e `msg_data` ficam guardados: quem for enviar vê a
-- mensagem que vai receber a resposta ANTES de clicar.
--
-- DUAS SAÍDAS PARA O MESMO ITEM, porque nem todo e-mail acionável pede resposta.
-- A cobrança da ContaAzul vence amanhã: o útil é PAGAR, não responder. Então o
-- item guarda `sugestao` (a resposta) e vira tarefa por
-- `email_acao_virar_tarefa`, e quem lê escolhe qual das duas usa — ou as duas.

drop table if exists public.email_resposta;

create table public.email_acao (
  -- remetente|assunto|data, normalizado. O item do briefing é a identidade.
  chave        text primary key,
  remetente    text not null,
  assunto      text,
  data_email   date,
  -- A ação como o briefing a escreveu. É ela que vira tarefa.
  acao         text,

  -- o que a IA escreveu
  -- `responder` | `so_acao` — se pede resposta ou só providência interna.
  veredito     text not null default 'responder',
  sugestao     text,
  porque       text,
  modelo       text,

  -- o que a busca no Gmail achou (pode não achar)
  gmail_id     text,
  thread_id    text,
  msg_assunto  text,
  msg_data     timestamptz,

  criada_em    timestamptz not null default now(),
  enviado_em   timestamptz,
  enviado_por  uuid,
  tarefa_id    uuid,
  erro         text
);

comment on table public.email_acao is
  'Um item acionável do briefing (briefing_diario.emails) com o que a IA preparou: a resposta ao remetente e/ou a ação interna. gmail_id é o que a busca achou — pode ser nulo, e a tela mostra qual mensagem foi encontrada antes de alguém enviar.';

comment on column public.email_acao.msg_assunto is
  'O assunto da mensagem que a busca ACHOU, que pode não ser o do item do briefing. Existe para a tela poder mostrar "vou responder ESTA" — assunto se repete todo mês.';

alter table public.email_acao enable row level security;

drop policy if exists email_acao_leitura on public.email_acao;
create policy email_acao_leitura on public.email_acao
  for select to authenticated using (true);

-- O que a tela do briefing mostra: itens recentes ainda não resolvidos.
create or replace function public.email_acoes_pendentes(p_limite int default 10)
returns table (
  chave text, remetente text, assunto text, data_email date, acao text,
  veredito text, sugestao text, porque text,
  gmail_id text, msg_assunto text, msg_data timestamptz,
  tarefa_id uuid, enviado_em timestamptz
)
language sql
stable
set search_path to 'public'
as $fn$
  select a.chave, a.remetente, a.assunto, a.data_email, a.acao,
         a.veredito, a.sugestao, a.porque,
         a.gmail_id, a.msg_assunto, a.msg_data,
         a.tarefa_id, a.enviado_em
    from public.email_acao a
   where a.criada_em > now() - interval '7 days'
     -- Some quando as duas saídas cabíveis já foram usadas. Item resolvido
     -- sumindo é o que faz a lista continuar sendo lida amanhã.
     and not (a.enviado_em is not null and a.tarefa_id is not null)
     and not (a.veredito = 'so_acao' and a.tarefa_id is not null)
   order by a.criada_em desc, a.data_email desc nulls last
   limit greatest(1, least(coalesce(p_limite, 10), 30));
$fn$;

revoke all on function public.email_acoes_pendentes(int) from public;
revoke all on function public.email_acoes_pendentes(int) from anon;
grant execute on function public.email_acoes_pendentes(int) to authenticated, service_role;

create or replace function public.email_acao_marcar_enviada(p_chave text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  update public.email_acao
     set enviado_em = now(), enviado_por = auth.uid(), erro = null
   where chave = p_chave and enviado_em is null;
end;
$fn$;

revoke all on function public.email_acao_marcar_enviada(text) from public;
revoke all on function public.email_acao_marcar_enviada(text) from anon;
grant execute on function public.email_acao_marcar_enviada(text) to authenticated, service_role;

-- O item do briefing vira tarefa em /tarefas.
--
-- Espelha `cartao_recomendacao_tarefa`: mesma forma, mesmo log, mesma
-- idempotência (chamar duas vezes devolve a mesma tarefa). Não é coincidência —
-- é o caminho que o Hub já usa para "isto virou trabalho de alguém", e inventar
-- um segundo seria ter dois lugares onde tarefa nasce.
create or replace function public.email_acao_virar_tarefa(
  p_chave text,
  p_responsavel text default null,
  p_prazo date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  a        public.email_acao;
  v_titulo text;
  v_obs    text;
  v_ordem  int;
  v_tarefa uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;

  select * into a from public.email_acao where chave = p_chave;
  if not found then raise exception 'Item não encontrado.'; end if;
  if a.tarefa_id is not null then return a.tarefa_id; end if;

  v_titulo := coalesce(nullif(btrim(a.acao), ''), 'Responder ' || a.remetente);
  if length(v_titulo) > 160 then v_titulo := left(v_titulo, 157) || '...'; end if;

  v_obs := 'E-mail de ' || a.remetente
           || coalesce(chr(10) || 'Assunto: ' || a.assunto, '')
           || coalesce(chr(10) || 'Recebido em ' || to_char(a.data_email, 'DD/MM/YYYY'), '')
           || coalesce(chr(10) || chr(10) || a.acao, '')
           || chr(10) || chr(10) || 'Aberta do briefing diário.';

  select coalesce(max(ordem), 0) + 1 into v_ordem from public.tarefas;

  insert into public.tarefas (
    ordem, titulo, responsavel, status, prioridade, prazo, observacao,
    subtarefas, cat_natureza, cat_area, cat_origem
  ) values (
    v_ordem, v_titulo,
    nullif(btrim(coalesce(p_responsavel, '')), ''),
    'Backlog', 'Média',
    coalesce(p_prazo, (now() at time zone 'America/Sao_Paulo')::date + 2),
    v_obs, '[]'::jsonb, 'Operacional', 'Briefing', 'auto'
  ) returning id into v_tarefa;

  insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario_id)
  values (v_tarefa, v_titulo, 'criada', 'Criada do briefing: e-mail de ' || a.remetente, auth.uid());

  update public.email_acao set tarefa_id = v_tarefa where chave = p_chave;
  return v_tarefa;
end;
$fn$;

revoke all on function public.email_acao_virar_tarefa(text, text, date) from public;
revoke all on function public.email_acao_virar_tarefa(text, text, date) from anon;
grant execute on function public.email_acao_virar_tarefa(text, text, date) to authenticated, service_role;

update public.ia_orcamento
   set rotulo = 'Ação de e-mail do briefing',
       para_que = 'Lê o e-mail acionável do briefing e prepara a resposta ao remetente e/ou a ação interna.'
 where consumidor = 'email_resposta';
