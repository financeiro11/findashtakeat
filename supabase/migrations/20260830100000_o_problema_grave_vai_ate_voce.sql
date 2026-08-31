-- O problema grave vai até você, em vez de esperar você achar.
--
-- Pedido do usuário em 30/08/2026: "quando algo der errado, seja integração ou
-- automação, preciso que surja um pop-up na tela me avisando, já trazendo a
-- causa e possível solução".
--
-- As decisões dele, e cada uma tem consequência de projeto:
--
--   1. MODAL SÓ PARA O GRAVE. O resto continua na faixa do topo, que já existe.
--      Interromper por tudo é o caminho conhecido para virar clique automático
--      em "Entendi" — e aí o aviso grave também deixa de ser lido.
--   2. FECHOU, NÃO VOLTA — a não ser que o problema mude ou volte depois de
--      resolvido. É o que separa aviso de ruído.
--   3. SÓ AO CARREGAR OU NAVEGAR. Sem consulta em segundo plano.
--
-- ---------------------------------------------------------------------------
-- COMO "VOLTAR DEPOIS DE RESOLVIDO" FUNCIONA, e por que é simples:
-- RESOLVER APAGA A DISPENSA. Quando um problema some da lista de abertos, as
-- dispensas dele são apagadas. Se ele voltar amanhã — mesmo com a MESMA
-- assinatura de erro — não há dispensa guardada, e o aviso aparece de novo.
--
-- A alternativa seria comparar datas de dispensa com datas de reincidência, e
-- isso erra nas bordas (o cron que roda entre a dispensa e a releitura). Apagar
-- na resolução é uma regra que se explica numa frase e não tem borda.
--
-- A DISPENSA É POR PESSOA. Duas pessoas olhando o Hub têm o direito de ver o
-- mesmo aviso; quem dispensou foi uma delas, não a empresa.

/* ============================================ o estado das integrações */

-- A tela `/configuracoes/integracoes` checa sob demanda e não guarda nada — o
-- que serve para quem foi olhar, e não serve para avisar quem não foi. Agora o
-- cron checa e GRAVA, e é desta tabela que o modal lê.
create table if not exists public.integracao_estado (
  chave        text primary key,
  nome         text not null,
  para_que     text,
  conectado    boolean,
  detalhe      text,
  causa        text,
  o_que_fazer  text,
  gravidade    text not null default 'media' check (gravidade in ('alta','media','baixa')),
  /* Muda quando o MODO de falhar muda. É o que faz o aviso voltar sem precisar
     de data: dispensa é guardada contra a assinatura. */
  assinatura   text,
  primeira_em  timestamptz not null default now(),
  ultima_em    timestamptz not null default now(),
  verificado_em timestamptz not null default now()
);

comment on table public.integracao_estado is
  'O último veredito de cada integração, gravado pelo cron. A tela de Integrações checa ao vivo; esta tabela existe para AVISAR quem não foi olhar.';

alter table public.integracao_estado enable row level security;

drop policy if exists integracao_estado_leitura on public.integracao_estado;
create policy integracao_estado_leitura on public.integracao_estado
  for select to authenticated using (true);

create or replace function public.integracao_estado_gravar(
  p_chave text, p_nome text, p_para_que text, p_conectado boolean,
  p_detalhe text, p_causa text, p_o_que_fazer text, p_gravidade text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_assin text;
begin
  /* A assinatura é o MODO de falhar, não a mensagem inteira: números e datas
     saem, senão "não respondeu em 12s" e "em 13s" seriam problemas diferentes e
     o aviso voltaria por conta própria. */
  v_assin := coalesce(p_conectado::text, 'null') || '|' ||
             regexp_replace(regexp_replace(coalesce(p_detalhe, ''), '\d+', '<n>', 'g'), '\s+', ' ', 'g');

  insert into public.integracao_estado
    (chave, nome, para_que, conectado, detalhe, causa, o_que_fazer, gravidade, assinatura)
  values
    (p_chave, p_nome, p_para_que, p_conectado, p_detalhe, p_causa, p_o_que_fazer,
     case when p_gravidade in ('alta','media','baixa') then p_gravidade else 'media' end,
     v_assin)
  on conflict (chave) do update set
    nome = excluded.nome, para_que = excluded.para_que,
    conectado = excluded.conectado, detalhe = excluded.detalhe,
    causa = excluded.causa, o_que_fazer = excluded.o_que_fazer,
    gravidade = excluded.gravidade,
    assinatura = excluded.assinatura,
    ultima_em = case when public.integracao_estado.assinatura is distinct from excluded.assinatura
                     then now() else public.integracao_estado.ultima_em end,
    verificado_em = now();

  /* VOLTOU A FUNCIONAR: apaga as dispensas. Se quebrar de novo amanhã, o aviso
     aparece — mesmo com a mesma assinatura. Ver o cabeçalho. */
  if coalesce(p_conectado, false) then
    delete from public.aviso_dispensado where fonte = 'integracao' and chave = p_chave;
  end if;
end;
$fn$;

/* ================================================ a dispensa, por pessoa */

create table if not exists public.aviso_dispensado (
  user_id     uuid not null,
  /* `automacao` | `integracao` */
  fonte       text not null,
  chave       text not null,
  assinatura  text not null,
  dispensado_em timestamptz not null default now(),
  primary key (user_id, fonte, chave, assinatura)
);

comment on table public.aviso_dispensado is
  'Quem já fechou qual aviso. Por PESSOA: duas pessoas olhando o Hub têm o direito de ver o mesmo aviso. A linha é apagada quando o problema é resolvido, e é isso que faz o aviso voltar se ele voltar.';

alter table public.aviso_dispensado enable row level security;

drop policy if exists aviso_dispensado_propria on public.aviso_dispensado;
create policy aviso_dispensado_propria on public.aviso_dispensado
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A função acima referencia esta tabela; recriada agora que ela existe.
create or replace function public.integracao_estado_gravar(
  p_chave text, p_nome text, p_para_que text, p_conectado boolean,
  p_detalhe text, p_causa text, p_o_que_fazer text, p_gravidade text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_assin text;
begin
  v_assin := coalesce(p_conectado::text, 'null') || '|' ||
             regexp_replace(regexp_replace(coalesce(p_detalhe, ''), '\d+', '<n>', 'g'), '\s+', ' ', 'g');

  insert into public.integracao_estado
    (chave, nome, para_que, conectado, detalhe, causa, o_que_fazer, gravidade, assinatura)
  values
    (p_chave, p_nome, p_para_que, p_conectado, p_detalhe, p_causa, p_o_que_fazer,
     case when p_gravidade in ('alta','media','baixa') then p_gravidade else 'media' end,
     v_assin)
  on conflict (chave) do update set
    nome = excluded.nome, para_que = excluded.para_que,
    conectado = excluded.conectado, detalhe = excluded.detalhe,
    causa = excluded.causa, o_que_fazer = excluded.o_que_fazer,
    gravidade = excluded.gravidade,
    assinatura = excluded.assinatura,
    ultima_em = case when public.integracao_estado.assinatura is distinct from excluded.assinatura
                     then now() else public.integracao_estado.ultima_em end,
    verificado_em = now();

  if coalesce(p_conectado, false) then
    delete from public.aviso_dispensado where fonte = 'integracao' and chave = p_chave;
  end if;
end;
$fn$;

revoke all on function public.integracao_estado_gravar(text,text,text,boolean,text,text,text,text) from public;
revoke all on function public.integracao_estado_gravar(text,text,text,boolean,text,text,text,text) from anon;
grant execute on function public.integracao_estado_gravar(text,text,text,boolean,text,text,text,text) to service_role;

/* ============================================== o que o modal pergunta */

/**
 * Os avisos GRAVES que esta pessoa ainda não dispensou.
 *
 * Junta as duas fontes numa forma só, porque para quem lê tanto faz se o que
 * quebrou foi um cron ou uma credencial — o que importa é o que aconteceu, por
 * quê, e o que fazer.
 *
 * SÓ `gravidade = 'alta'`: foi a decisão do usuário. O resto continua na faixa
 * do topo, que já mostra tudo.
 */
create or replace function public.avisos_graves_abertos()
returns table (
  fonte text, chave text, assinatura text, titulo text,
  resumo text, causa text, o_que_fazer text, ocorrencias integer, desde timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  -- automações que estão falhando agora e já têm diagnóstico
  select 'automacao'::text, d.jobname, d.assinatura, d.jobname,
         d.resumo, d.causa, d.o_que_fazer, d.ocorrencias, d.primeira_em
    from public.automacao_diagnostico d
   where auth.uid() is not null
     and d.resolvido_em is null
     and d.gravidade = 'alta'
     and exists (
       select 1 from public.automacao_execucao e
        where e.jobname = d.jobname
          and e.disparado_em > now() - interval '3 days'
          and e.colhido_em is not null
          and (e.status_code >= 300 or public.corpo_desmente(e.resposta))
          and public.automacao_assinatura_erro(e.status_code, e.resposta) = d.assinatura
     )
     and not exists (
       select 1 from public.aviso_dispensado a
        where a.user_id = auth.uid() and a.fonte = 'automacao'
          and a.chave = d.jobname and a.assinatura = d.assinatura
     )

  union all

  -- integrações quebradas
  select 'integracao'::text, i.chave, coalesce(i.assinatura, ''), i.nome,
         i.detalhe, i.causa, i.o_que_fazer, 1, i.ultima_em
    from public.integracao_estado i
   where auth.uid() is not null
     and i.conectado is false
     and i.gravidade = 'alta'
     and not exists (
       select 1 from public.aviso_dispensado a
        where a.user_id = auth.uid() and a.fonte = 'integracao'
          and a.chave = i.chave and a.assinatura = coalesce(i.assinatura, '')
     )
  order by 9;
$fn$;

comment on function public.avisos_graves_abertos() is
  'O que o modal mostra: problemas GRAVES em aberto que esta pessoa ainda não dispensou. Junta automação e integração numa forma só — para quem lê, tanto faz o que quebrou.';

revoke all on function public.avisos_graves_abertos() from public;
revoke all on function public.avisos_graves_abertos() from anon;
grant execute on function public.avisos_graves_abertos() to authenticated;

create or replace function public.aviso_dispensar(p_fonte text, p_chave text, p_assinatura text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  if p_fonte not in ('automacao','integracao') then raise exception 'fonte inválida'; end if;
  insert into public.aviso_dispensado (user_id, fonte, chave, assinatura)
  values (auth.uid(), p_fonte, p_chave, coalesce(p_assinatura, ''))
  on conflict do nothing;
end;
$fn$;

revoke all on function public.aviso_dispensar(text,text,text) from public;
revoke all on function public.aviso_dispensar(text,text,text) from anon;
grant execute on function public.aviso_dispensar(text,text,text) to authenticated;

/* A mesma regra do outro lado: automação que volta a funcionar perde as
   dispensas dela, para que uma reincidência volte a avisar. Roda junto da
   colheita, que já passa de 5 em 5 minutos. */
create or replace function public.avisos_limpar_resolvidos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n int;
begin
  delete from public.aviso_dispensado a
   where a.fonte = 'automacao'
     and not exists (
       select 1 from public.automacao_execucao e
        where e.jobname = a.chave
          and e.disparado_em > now() - interval '3 days'
          and e.colhido_em is not null
          and (e.status_code >= 300 or public.corpo_desmente(e.resposta))
          and public.automacao_assinatura_erro(e.status_code, e.resposta) = a.assinatura
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.avisos_limpar_resolvidos() from public;
revoke all on function public.avisos_limpar_resolvidos() from anon;
grant execute on function public.avisos_limpar_resolvidos() to authenticated, service_role;
