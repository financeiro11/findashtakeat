/* O PLANO VIROU PRO — E O QUE ISSO DESTRAVA NÃO É O QUE PARECE.
   ============================================================

   Em 01/09/2026 o projeto saiu do free. A leitura fácil seria "o worker agora
   vive 400s em vez de 150s, então é só subir todos os relógios". **Está errada**,
   e esta migração existe para gravar por quê.

   São DOIS tetos diferentes, e só um subiu:

     · **Vida do worker** — free 150s, pago 400s. É quanto tempo o isolate fica
       de pé. Serve para trabalho em segundo plano (`EdgeRuntime.waitUntil`)
       DEPOIS que a resposta já saiu.

     · **Tempo até a primeira resposta** — 150s em TODO plano, e a própria
       documentação diz que "as of now, this limit cannot be increased". Passou
       disso, o gateway devolve **504** e a função nem fica sabendo.

   Ou seja: uma requisição síncrona continua tendo 150s, exatamente como antes.
   Os `LIMITE_WORKER_MS` de 110–135s espalhados pelas funções **estão certos** e
   NÃO devem ser aumentados — subi-los para 360s trocaria a falha silenciosa de
   hoje por 504 no gateway, que é pior.

   O que realmente está errado é outra coisa, e é o que esta migração conserta.

   -------------------------------------------------------------------------
   1) O DISPARADOR DESISTE ANTES DA FUNÇÃO TERMINAR
   -------------------------------------------------------------------------

   `disparar_automacao` manda `timeout_milliseconds := 90000` para o `net.http_post`.
   Só que as funções trabalham até 110–135s. O que acontece todo dia:

     · a função roda 115s, grava tudo certo e responde 200;
     · o `pg_net` já tinha desistido aos 90s e não guardou resposta nenhuma;
     · o `automacao_colher` acha a linha órfã 8 horas depois e carimba
       "a resposta expirou antes de ser lida";
     · o painel de automações acende vermelho numa rodada que **deu certo**.

   Medido nos 30 dias até 01/09/2026: **93 execuções sem resposta colhida**
   contra **3** estouros reais de worker (546). Quase todo o vermelho do painel
   é este desencontro — `nota-ler-arquivo` 38 vezes, `nf-emissao-diaria` 22,
   `anexo-triagem-ia` 15.

   O novo padrão é **160s**, de propósito ACIMA dos 150s do gateway: assim o
   `pg_net` sempre colhe alguma coisa — ou o 2xx da função, ou o 504 do gateway.
   Nunca mais "a resposta expirou antes de ser lida" para uma rodada que existiu.
   Não é para deixar a função rodar mais: é para não perder o veredito dela.

   59 dos 69 crons passam por aqui e nenhum sobrescreve o parâmetro, então mudar
   o padrão muda todos de uma vez. */

create or replace function public.disparar_automacao(
  p_jobname text,
  p_url text,
  p_body jsonb default '{}'::jsonb,
  p_token_nome text default null::text,
  p_headers jsonb default '{}'::jsonb,
  p_timeout_ms integer default 160000
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'net'
as $function$
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

  /* 160s: acima dos 150s em que o gateway devolve 504, para que a resposta
     colhida seja sempre a resposta de alguém — ver o cabeçalho. */
  select net.http_post(url := p_url, headers := v_headers,
                       body := coalesce(p_body, '{}'::jsonb),
                       timeout_milliseconds := coalesce(p_timeout_ms, 160000))
    into v_rid;

  insert into public.automacao_execucao (jobname, request_id) values (p_jobname, v_rid);
  return v_rid;
end;
$function$;

/* -------------------------------------------------------------------------
   2) A MEMÓRIA DE 7 DIAS ERA APERTO DE ESPAÇO, E JÁ NÃO É
   -------------------------------------------------------------------------

   `automacao_colher` apagava tudo com mais de 7 dias, com a justificativa de que
   "sete dias bastam para responder 'rodou ontem?'". Bastavam mesmo — quando o
   banco tinha 30 MB de folga em 500 MB.

   Só que já existe pergunta que os 7 dias não respondem, e ela está no código:
   `sinal_automacoes_dia(p_dias integer default 14)` pede **14 dias** de série
   para o vigia e recebe 7, calado. A banda que decide se um sinal é anormal vem
   dessa série; com metade do histórico, ela decide com metade da informação.

   90 dias custam ~35 MB (hoje são 6.728 linhas em 7 dias, ~2,7 MB) num banco de
   8 GB. É o que permite responder "esta automação está piorando?" em vez de
   "rodou ontem?". */

create or replace function public.automacao_colher()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'net'
as $function$
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

  /* 90 dias, não mais 7 — ver o cabeçalho. O corte existe para a tabela não
     crescer sem regra, não mais para caber no plano. */
  delete from public.automacao_execucao where disparado_em < now() - interval '90 days';

  return v_n;
end;
$function$;

/* -------------------------------------------------------------------------
   3) O PAINEL PRECISA CONTINUAR SIGNIFICANDO A MESMA COISA
   -------------------------------------------------------------------------

   `hub_automacoes` pega a última execução de cada job SEM filtro de data. Isso
   era inofensivo enquanto a tabela só tinha 7 dias: "a última que existe" e "a
   última da semana" eram a mesma linha.

   Com 90 dias de memória, deixar sem filtro mudaria o sentido do painel — um job
   desligado há dois meses voltaria a mostrar o verde da última vez que rodou,
   como se estivesse saudável agora. Verde velho é pior que sem informação.

   A janela de 7 dias vai explícita, e o painel segue dizendo exatamente o que
   dizia ontem. Como bônus, o `distinct on` volta a ler uma fatia pequena. */

create or replace function public.hub_automacoes()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp', 'cron'
as $function$
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
     /* A JANELA É O SENTIDO DO PAINEL, não otimização — ver o cabeçalho. */
     where e.disparado_em > now() - interval '7 days'
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
$function$;

/* -------------------------------------------------------------------------
   4) O HISTÓRICO DO PRÓPRIO CRON NÃO TINHA REGRA NENHUMA
   -------------------------------------------------------------------------

   `cron.job_run_details` cresce desde 27/05/2026 e ninguém nunca apagou nada:
   10.414 linhas, 5,9 MB. O pg_cron não poda sozinho — quem quer retenção
   escreve a retenção.

   No free isso ia virar problema por si só. Agora não vira, mas continua sendo
   tabela sem dono: em um ano são ~40 mil linhas de log que ninguém lê depois de
   noventa dias. A poda entra agora, valendo quase nada (8 linhas hoje passam de
   90 dias), porque teto que se instala com a tabela vazia nunca precisa de
   mutirão depois.

   `security definer` porque o schema `cron` não é visível para o papel que roda
   os jobs de aplicação — foi essa exata pedra que fez `teste-diagnostico` morrer
   com "permission denied for schema cron" em 30/08. */

create or replace function public.cron_historico_podar(p_dias integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'cron'
as $function$
declare v_n integer;
begin
  /* `greatest(..., 7)` é trava de segurança: um zero passado por engano apagaria
     o histórico inteiro, inclusive o da rodada de agora. */
  delete from cron.job_run_details
   where end_time < now() - make_interval(days => greatest(coalesce(p_dias, 90), 7));
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

/* O Supabase concede EXECUTE para `anon`/`authenticated` em função nova por
   padrão. Isto aqui apaga log de operação — não é para o navegador chamar. */
revoke all on function public.cron_historico_podar(integer) from public;
revoke all on function public.cron_historico_podar(integer) from anon;
revoke all on function public.cron_historico_podar(integer) from authenticated;

/* 04:40, depois da madrugada cheia e antes do expediente. */
select cron.schedule(
  'cron-historico-podar',
  '40 4 * * *',
  $$ select public.cron_historico_podar(); $$
);

/* -------------------------------------------------------------------------
   5) O ACERVO PARA DE PINGAR E PASSA A DRENAR
   -------------------------------------------------------------------------

   `notas-arquivar` rodava **uma vez por dia**, 60 por rodada, e a fila do
   copiador tinha 87 — dois dias parada por nada, e cada dia de atraso é um dia a
   mais em que a pasta de origem no Drive de alguém pode sumir.

   CUIDADO COM O NÚMERO QUE PARECE A FILA E NÃO É. `notas_externas` tem 1.517
   linhas com `tem_arquivo` e sem `arquivo_bucket`, e é tentador ler isso como "o
   que falta copiar". Não é: **1.356 delas não têm origem copiável** — o `link`
   não aponta para Drive nenhum, então o predicado de
   `notas_externas_para_arquivar` nunca as viu. Quem responde "quanto falta" é a
   própria RPC, ou o campo `falta` da resposta da função.

   De diária para **de hora em hora**. O job se apaga sozinho quando não há o que
   fazer: a fila vem de `notas_externas_para_arquivar`, que devolve zero linhas
   quando tudo já foi copiado, e a rodada termina sem baixar nada. Não é preciso
   voltar aqui depois para desacelerar.

   O comando é lido do próprio catálogo em vez de reescrito, porque ele carrega a
   chave anon embutida e chave não se copia para dentro de arquivo versionado.

   E O NOME APARECE DUAS VEZES, não uma. Renomear o job em `cron.job` não toca no
   texto do comando, e é lá dentro que vai o `p_jobname` gravado em
   `automacao_execucao`. Trocar só um dos dois deixa o painel sem linha: o
   `hub_automacoes` casa `automacao_execucao.jobname` com `cron.job.jobname`, e
   um job que dispara sob outro nome vira uma automação sem estado HTTP nenhum —
   verde apagado, sem erro, sem explicação. Os dois trocam juntos. */

do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'notas-arquivar-diaria';

  if v_cmd is not null then
    perform cron.unschedule('notas-arquivar-diaria');
    /* O nome muda junto com a cadência: cron chamado "diaria" rodando de hora em
       hora é a próxima pessoa lendo errado às três da manhã. */
    perform cron.schedule('notas-arquivar-horaria', '15 * * * *', v_cmd);
  end if;

  /* O nome de dentro do comando, que é o que a execução carimba. */
  select command into v_cmd from cron.job where jobname = 'notas-arquivar-horaria';
  if v_cmd is not null and position('notas-arquivar-diaria' in v_cmd) > 0 then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'notas-arquivar-horaria'),
      command := replace(v_cmd, 'notas-arquivar-diaria', 'notas-arquivar-horaria')
    );
  end if;
end $$;
