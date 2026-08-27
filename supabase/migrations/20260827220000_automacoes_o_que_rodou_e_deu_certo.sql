-- "Está rodando?" passou a ter onde ser conferido.
--
-- O Hub tem 35 automações e nenhuma tela dizia se elas rodaram. Quando eu digo
-- "a fila está drenando", não havia onde checar — e "confiar em quem diz" é
-- exatamente o que um painel existe para dispensar.
--
-- ---------------------------------------------------------------------------
-- POR QUE `cron.job_run_details` NÃO RESPONDE A PERGUNTA
--
-- Ele diz `succeeded` quando o **SQL do cron** rodou. E o SQL de todo cron aqui
-- é um `net.http_post`, que só ENFILEIRA a requisição: ele "sucede" mesmo que a
-- função devolva 401, 500 ou nunca responda.
--
-- Medido em 27/08/2026: `omie-cartao-nome` aparecia `succeeded` a cada :17 e
-- :47 enquanto respondia **500 "Não autenticado."** havia dias. Um painel
-- montado sobre `job_run_details` mostraria verde e mentiria.
--
-- ---------------------------------------------------------------------------
-- E POR QUE NÃO DÁ PARA LIGAR A RESPOSTA AO CRON DEPOIS
--
-- `net._http_response` guarda o status, mas a URL fica em
-- `net.http_request_queue` — que o `pg_net` **esvazia** ao processar. Conferido:
-- 179 respostas guardadas, 0 casando com a fila, e o histórico de resposta dura
-- só ~6 horas. Não há como reconstruir o vínculo olhando para trás.
--
-- Então o vínculo é gravado NO DISPARO. `disparar_automacao` guarda o
-- `request_id` que o `net.http_post` devolve, e `automacao_colher` volta depois
-- para escrever o que a função respondeu. Duas etapas porque a resposta não
-- existe no instante do disparo — é assíncrona por construção.

create table if not exists public.automacao_execucao (
  id           bigserial primary key,
  jobname      text not null,
  request_id   bigint,
  disparado_em timestamptz not null default now(),
  status_code  integer,
  resposta     text,
  colhido_em   timestamptz
);

create index if not exists automacao_execucao_idx
  on public.automacao_execucao (jobname, disparado_em desc);
create index if not exists automacao_execucao_colher_idx
  on public.automacao_execucao (request_id)
  where colhido_em is null and request_id is not null;

comment on table public.automacao_execucao is
  'Uma linha por disparo de automação, com o `request_id` do pg_net guardado NO MOMENTO do disparo. É o único jeito de saber depois o que a função respondeu: `net.http_request_queue` é esvaziada ao processar e `net._http_response` dura ~6h sem a URL.';

alter table public.automacao_execucao enable row level security;
drop policy if exists automacao_execucao_leitura on public.automacao_execucao;
create policy automacao_execucao_leitura on public.automacao_execucao
  for select to authenticated using (true);

/* ============================================================================
 *  Disparar, guardando o rastro
 * ========================================================================== */

create or replace function public.disparar_automacao(
  p_jobname     text,
  p_url         text,
  p_body        jsonb default '{}'::jsonb,
  p_token_nome  text default null,
  p_headers     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp, net
as $$
declare
  v_headers jsonb;
  v_rid bigint;
begin
  /* O TOKEN É LIDO NA HORA, e não copiado para dentro do agendamento: token
     rotacionado precisa valer no disparo seguinte, não no próximo deploy. */
  v_headers := jsonb_build_object('Content-Type', 'application/json')
    || coalesce(p_headers, '{}'::jsonb)
    || case
         when p_token_nome is null then '{}'::jsonb
         else jsonb_build_object(
                'x-cron-token',
                (select t.token from public.internal_cron_tokens t where t.name = p_token_nome))
       end;

  select net.http_post(url := p_url, headers := v_headers, body := coalesce(p_body, '{}'::jsonb))
    into v_rid;

  insert into public.automacao_execucao (jobname, request_id) values (p_jobname, v_rid);
  return v_rid;
end;
$$;

revoke all on function public.disparar_automacao(text, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.disparar_automacao(text, text, jsonb, text, jsonb) to service_role;

/* ============================================================================
 *  Colher a resposta, antes que o pg_net a apague
 * ========================================================================== */

create or replace function public.automacao_colher()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp, net
as $$
declare v_n integer;
begin
  update public.automacao_execucao e
     set status_code = r.status_code,
         /* Só o começo do corpo. A resposta da varredura de anexos traz o
            detalhe de cada item e passa de 8 KB; guardar tudo encheria a tabela
            com o que ninguém lê, e o que importa aqui é "deu certo?". */
         resposta = left(coalesce(r.content, r.error_msg, ''), 600),
         colhido_em = now()
    from net._http_response r
   where r.id = e.request_id
     and e.colhido_em is null;
  get diagnostics v_n = row_count;

  /* O QUE NUNCA FOI COLHIDO E JÁ NÃO PODE SER. `net._http_response` guarda ~6h;
     passado isso, a resposta não existe mais em lugar nenhum. Sem este carimbo
     a linha ficaria "em andamento" para sempre e o painel mostraria uma
     execução pendurada que nunca resolve. */
  update public.automacao_execucao
     set colhido_em = now(), resposta = 'a resposta expirou antes de ser lida'
   where colhido_em is null
     and disparado_em < now() - interval '8 hours';

  /* Sete dias bastam para responder "rodou ontem?" e para ver um padrão de
     falha. Guardar mais é guardar o que ninguém pergunta. */
  delete from public.automacao_execucao where disparado_em < now() - interval '7 days';

  return v_n;
end;
$$;

revoke all on function public.automacao_colher() from public, anon;
grant execute on function public.automacao_colher() to authenticated, service_role;

/* ============================================================================
 *  O que o painel lê
 * ========================================================================== */

create or replace function public.hub_automacoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp, cron
as $$
declare v jsonb;
begin
  with j as (
    select c.jobid, c.jobname, c.schedule, c.active,
           coalesce(
             substring(c.command from 'functions/v1/([a-z0-9-]+)'),
             substring(c.command from 'select\s+public\.([a-z_]+)\(')
           ) as alvo,
           /* Cron que não chama função nenhuma é SQL puro (casar, propagar):
              para ele `job_run_details` responde de verdade. */
           (c.command ilike '%functions/v1/%') as chama_funcao
      from cron.job c
  ),
  ult_http as (
    select distinct on (e.jobname)
           e.jobname, e.disparado_em, e.status_code, e.resposta, e.colhido_em
      from public.automacao_execucao e
     order by e.jobname, e.disparado_em desc
  ),
  ult_sql as (
    select distinct on (d.jobid)
           d.jobid, d.start_time, d.status, d.return_message
      from cron.job_run_details d
     order by d.jobid, d.start_time desc
  ),
  falhas as (
    select e.jobname,
           count(*) filter (where e.status_code is not null and e.status_code >= 300) as ruins,
           count(*) as total
      from public.automacao_execucao e
     where e.disparado_em > now() - interval '24 hours'
     group by e.jobname
  )
  select jsonb_build_object(
    'gerado_em', now(),
    'agora', now(),
    'automacoes', coalesce(jsonb_agg(jsonb_build_object(
        'jobname', j.jobname,
        'schedule', j.schedule,
        'ativo', j.active,
        'alvo', j.alvo,
        'chama_funcao', j.chama_funcao,
        /* O ESTADO VEM DA FONTE QUE SABE. Para quem chama função, o HTTP; para
           SQL puro, o `job_run_details`. Misturar os dois numa coluna só foi o
           que fez `omie-cartao-nome` parecer verde por dias. */
        'ultimo_em', coalesce(uh.disparado_em, us.start_time),
        'status_http', uh.status_code,
        'resposta', left(coalesce(uh.resposta, ''), 300),
        'aguardando', (uh.jobname is not null and uh.colhido_em is null),
        'status_sql', us.status,
        'erro_sql', case when us.status is distinct from 'succeeded' then left(coalesce(us.return_message, ''), 200) end,
        'falhas_24h', coalesce(f.ruins, 0),
        'execucoes_24h', coalesce(f.total, 0)
      ) order by j.jobname), '[]'::jsonb)
  ) into v
  from j
  left join ult_http uh on uh.jobname = j.jobname
  left join ult_sql us on us.jobid = j.jobid
  left join falhas f on f.jobname = j.jobname;

  /* AS FILAS, que são o outro metade da pergunta: um cron pode estar rodando
     lindamente e a fila crescendo, e é isso que a pessoa quer ver. */
  v := v || jsonb_build_object('filas', jsonb_build_array(
    jsonb_build_object('chave', 'anexo_erp', 'rotulo', 'notas a subir para o Omie',
      'quantos', (select count(*) from public.notas_externas
                   where fila_erp and enviado_erp_em is null)),
    jsonb_build_object('chave', 'ler_arquivo', 'rotulo', 'arquivos a ler',
      'quantos', (select count(*) from public.notas_externas
                   where tem_arquivo and valor is null and lido_do_arquivo_em is null and ignorado_em is null)),
    jsonb_build_object('chave', 'baixar_link', 'rotulo', 'notas a baixar por link',
      'quantos', (select count(*) from public.notas_externas
                   where link_documento is not null and not tem_arquivo and ignorado_em is null)),
    jsonb_build_object('chave', 'espera_gente', 'rotulo', 'esperando você confirmar',
      'quantos', (select count(*) from public.notas_externas
                   where conferencia in ('falta_anexar', 'promessa_falsa') and tem_arquivo
                     and copia_de is null and not fila_erp and enviado_erp_em is null)),
    jsonb_build_object('chave', 'anexo_conferir', 'rotulo', 'anexos a conferir',
      'quantos', (select count(*) from public.omie_titulo_anexo
                   where classe = 'duvidoso' and revisao is null))
  ));

  return v;
end;
$$;

revoke all on function public.hub_automacoes() from public, anon;
grant execute on function public.hub_automacoes() to authenticated, service_role;

comment on function public.hub_automacoes() is
  'O estado das 35 automações do Hub para a faixa do topo: quando rodou, o que a função RESPONDEU (não só se o cron disparou), falhas em 24h e o tamanho das filas. Ver o cabeçalho de `20260827220000` para por que `cron.job_run_details` sozinho não responde isso.';

/* ============================================================================
 *  Colher de tempo em tempo
 *
 *  A cada 5 min: `net._http_response` dura ~6 h, então há folga de sobra, e uma
 *  colheita frequente deixa o painel quase ao vivo sem custo (é um update por
 *  request_id, indexado).
 * ========================================================================== */

select cron.unschedule('automacao-colher')
 where exists (select 1 from cron.job where jobname = 'automacao-colher');

select cron.schedule('automacao-colher', '*/5 * * * *', $cron$
  select public.automacao_colher();
$cron$);
