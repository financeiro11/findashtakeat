-- A falha chega com a causa junto.
--
-- Hoje o painel de automações diz o QUE quebrou — `HTTP 401 {"error":"Não
-- autenticado."}` — e quem lê precisa ser quem escreveu a função para saber o
-- que fazer com isso. Foi literalmente o caso de 29/08/2026: treze crons sem
-- token, a faixa vermelha no lugar certo, e ainda assim ninguém sabia que a
-- causa era um `WHERE` maiúsculo numa regex de dois dias antes.
--
-- A IA passa a ler a falha e escrever três coisas: o que aconteceu em português,
-- a causa mais provável e o que fazer. Ela NÃO conserta nada — o Hub inteiro é
-- construído como sinal determinístico primeiro, IA redigindo, pessoa agindo, e
-- uma IA que mexe em cron sozinha seria a primeira exceção a essa regra. Não é
-- hoje que se abre essa porta.
--
-- ---------------------------------------------------------------------------
-- UM DIAGNÓSTICO POR ASSINATURA DE ERRO, NÃO POR OCORRÊNCIA. É o freio mais
-- importante deste módulo, e é o mesmo princípio do acervo: reperguntar é a
-- forma mais fácil de gastar teto sem aprender nada.
--
-- Um cron diário que falha do mesmo jeito por uma semana produz SETE falhas e
-- UM diagnóstico. O `asaas-sync-diario` respondeu "Não autenticado." dezenas de
-- vezes seguidas — diagnosticar cada uma seria pagar dezenas de vezes pela mesma
-- frase. A assinatura normaliza o que varia (números, ids, datas, horas) e mantém
-- o que identifica, então "timeout de 90000ms" e "timeout de 90001ms" são o
-- mesmo problema, como devem ser.
--
-- Quando a mesma assinatura reaparece, `ocorrencias` sobe e `ultima_em` anda. O
-- diagnóstico continua valendo — e o contador vira informação nova: "isto já
-- aconteceu 14 vezes" diz algo que a primeira ocorrência não dizia.

create table if not exists public.automacao_diagnostico (
  id           bigserial primary key,
  jobname      text not null,
  /* O erro normalizado. É a chave de deduplicação — ver o cabeçalho. */
  assinatura   text not null,
  /* O erro cru da primeira vez, para quem quiser conferir a normalização. */
  amostra      text,
  resumo       text not null,
  causa        text,
  o_que_fazer  text,
  gravidade    text check (gravidade in ('alta', 'media', 'baixa')),
  ocorrencias  integer not null default 1,
  primeira_em  timestamptz not null default now(),
  ultima_em    timestamptz not null default now(),
  resolvido_em timestamptz,
  modelo       text,
  unique (jobname, assinatura)
);

comment on table public.automacao_diagnostico is
  'O que a IA entendeu de cada falha de automação. Uma linha por (cron, assinatura de erro) — não por ocorrência: um cron que falha igual por uma semana dá sete falhas e um diagnóstico.';

comment on column public.automacao_diagnostico.assinatura is
  'O erro com o que varia apagado (números, ids, datas, horas). É o que faz "timeout de 90000ms" e "timeout de 90001ms" serem o mesmo problema.';

alter table public.automacao_diagnostico enable row level security;

drop policy if exists automacao_diagnostico_leitura on public.automacao_diagnostico;
create policy automacao_diagnostico_leitura on public.automacao_diagnostico
  for select to authenticated using (true);

/**
 * A assinatura. Deliberadamente agressiva no que apaga: o objetivo é COLAPSAR
 * variações do mesmo problema, e errar para o lado de colapsar demais custa um
 * diagnóstico genérico; errar para o lado de colapsar de menos custa uma chamada
 * de IA por ocorrência, que é o que se quer evitar.
 */
create or replace function public.automacao_assinatura_erro(p_status int, p_resposta text)
returns text
language sql
immutable
as $$
  select coalesce(p_status::text, 'sem-status') || '|' ||
         left(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_resposta, ''), '\d{4}-\d{2}-\d{2}[T ][\d:.+-]*', '<data>', 'g'),
             '\m\d+\M', '<n>', 'g'),
           '\s+', ' ', 'g'), 300);
$$;

/**
 * As falhas que ainda não têm diagnóstico.
 *
 * O CRITÉRIO DE FALHA É O MESMO DA TELA, e isso importa: `falhou()` em
 * `src/lib/automacoes.ts` passou a ler o CORPO da resposta em 29/08/2026, porque
 * metade das funções devolve erro com HTTP 200. Se aqui olhasse só o status, a
 * IA diagnosticaria um subconjunto do que o painel pinta de vermelho — e as duas
 * telas discordariam sobre o que está quebrado.
 */
create or replace function public.automacoes_para_diagnosticar(p_limite int default 8)
returns table (
  jobname text, status_code int, resposta text, disparado_em timestamptz,
  assinatura text, schedule text, falhas_7d bigint
)
language sql
stable
set search_path to 'public'
as $$
  with ultima as (
    select distinct on (e.jobname)
           e.jobname, e.status_code, e.resposta, e.disparado_em
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '3 days'
       and e.colhido_em is not null
     order by e.jobname, e.disparado_em desc
  ),
  ruins as (
    select u.*, public.automacao_assinatura_erro(u.status_code, u.resposta) as assinatura
      from ultima u
     where u.status_code is not null
       and (
         u.status_code >= 300
         /* O 2xx que se desmente no corpo — as três formas que as funções daqui
            usam para dizer "não deu". */
         or u.resposta ilike '{%"ok":false%'
         or u.resposta ~ '"error"\s*:\s*"[^"]+'
         or u.resposta ilike '%"status":"erro"%'
       )
  )
  select r.jobname, r.status_code, r.resposta, r.disparado_em, r.assinatura,
         j.schedule,
         (select count(*) from public.automacao_execucao e2
           where e2.jobname = r.jobname and e2.disparado_em > now() - interval '7 days'
             and (e2.status_code >= 300 or e2.resposta ~ '"error"\s*:\s*"[^"]+')) as falhas_7d
    from ruins r
    left join cron.job j on j.jobname = r.jobname
   where not exists (
           select 1 from public.automacao_diagnostico d
            where d.jobname = r.jobname and d.assinatura = r.assinatura
         )
   order by r.disparado_em desc
   limit greatest(1, least(coalesce(p_limite, 8), 20));
$$;

comment on function public.automacoes_para_diagnosticar(int) is
  'Falhas de automação que ainda não têm diagnóstico para aquela assinatura de erro. Usa o MESMO critério de falha da tela (status >= 300 OU o corpo se desmentindo), senão as duas discordariam sobre o que está quebrado.';

revoke all on function public.automacoes_para_diagnosticar(int) from public;
revoke all on function public.automacoes_para_diagnosticar(int) from anon;
grant execute on function public.automacoes_para_diagnosticar(int) to authenticated, service_role;

/** Grava o diagnóstico, ou soma mais uma ocorrência se a assinatura já existe. */
create or replace function public.automacao_diagnostico_gravar(
  p_jobname text, p_assinatura text, p_amostra text,
  p_resumo text, p_causa text, p_o_que_fazer text, p_gravidade text, p_modelo text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.automacao_diagnostico
    (jobname, assinatura, amostra, resumo, causa, o_que_fazer, gravidade, modelo)
  values
    (p_jobname, p_assinatura, left(coalesce(p_amostra, ''), 1000),
     p_resumo, p_causa, p_o_que_fazer,
     case when p_gravidade in ('alta','media','baixa') then p_gravidade else 'media' end,
     p_modelo)
  on conflict (jobname, assinatura) do update
     set ocorrencias = public.automacao_diagnostico.ocorrencias + 1,
         ultima_em   = now(),
         resolvido_em = null;   -- voltou a acontecer: não está resolvido
end;
$$;

revoke all on function public.automacao_diagnostico_gravar(text,text,text,text,text,text,text,text) from public;
revoke all on function public.automacao_diagnostico_gravar(text,text,text,text,text,text,text,text) from anon;
grant execute on function public.automacao_diagnostico_gravar(text,text,text,text,text,text,text,text) to service_role;

/**
 * Os diagnósticos que a tela mostra: só de crons que AINDA estão falhando.
 *
 * Um diagnóstico de um cron que voltou a funcionar não é notícia — é histórico,
 * e histórico no lugar do aviso é como um painel deixa de ser lido.
 */
create or replace function public.automacao_diagnosticos_abertos()
returns table (
  jobname text, resumo text, causa text, o_que_fazer text, gravidade text,
  ocorrencias integer, primeira_em timestamptz, ultima_em timestamptz
)
language sql
stable
set search_path to 'public'
as $$
  with ultima as (
    select distinct on (e.jobname) e.jobname, e.status_code, e.resposta
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '3 days' and e.colhido_em is not null
     order by e.jobname, e.disparado_em desc
  )
  select d.jobname, d.resumo, d.causa, d.o_que_fazer, d.gravidade,
         d.ocorrencias, d.primeira_em, d.ultima_em
    from public.automacao_diagnostico d
    join ultima u on u.jobname = d.jobname
                 and public.automacao_assinatura_erro(u.status_code, u.resposta) = d.assinatura
   where d.resolvido_em is null
   order by case d.gravidade when 'alta' then 0 when 'media' then 1 else 2 end, d.ultima_em desc;
$$;

revoke all on function public.automacao_diagnosticos_abertos() from public;
revoke all on function public.automacao_diagnosticos_abertos() from anon;
grant execute on function public.automacao_diagnosticos_abertos() to authenticated, service_role;

/* O consumidor no freio. Teto baixo de propósito: são no máximo algumas falhas
   novas por dia, e assinatura repetida não gasta nada. */
insert into public.ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd) values
  ('automacao_diagnostico', 'Diagnóstico de automação',
   'Lê a falha do cron e escreve o que aconteceu, a causa provável e o que fazer.', 40, 3.00)
on conflict (consumidor) do nothing;
