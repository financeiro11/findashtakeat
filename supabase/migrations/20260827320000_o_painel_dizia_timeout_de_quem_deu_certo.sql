-- O painel novo acusou "timeout" numa automação que tinha dado certo.
--
-- Primeira coisa que a faixa de automações pegou depois de ligada, e foi nela
-- mesma: disparei a `notas-diagnostico` e a resposta colhida foi
--
--   status_code: null
--   resposta:    "Timeout of 5000 ms reached. Total time: 5003 ms"
--
-- A função tinha rodado inteira. O texto da IA está gravado em
-- `cap_notas_diagnostico_texto`, com o carimbo do minuto do disparo. Quem
-- desistiu foi o `pg_net`: `net.http_post` tem `timeout_milliseconds` com
-- **padrão de 5 segundos**, e nenhuma chamada a modelo de linguagem responde em
-- cinco segundos. Ele fecha a conexão, registra o timeout, e a função do outro
-- lado segue trabalhando até o fim sem saber que ninguém está mais ouvindo.
--
-- ---------------------------------------------------------------------------
-- POR QUE ISSO É PIOR DO QUE UM NÚMERO ERRADO
--
-- A faixa existe para responder "está rodando?" — e um painel que pinta de
-- vermelho o que funcionou gasta a confiança de quem olha mais rápido do que a
-- ausência de painel gastava. Depois de duas ou três dessas, o ponto vermelho
-- vira ruído e o dia em que ele estiver certo ninguém vai clicar.
--
-- ---------------------------------------------------------------------------
-- 90 SEGUNDOS, E O QUE ISSO NÃO CUSTA
--
-- O `pg_net` é assíncrono: a espera acontece no worker dele, não no cron nem
-- numa transação aberta. Alargar o limite não segura nada — só evita desligar o
-- telefone antes de a outra ponta responder. Noventa segundos cobre o
-- diagnóstico com IA, a varredura de anexos e a emissão de NFS-e, que são as
-- três que passam de cinco.
--
-- O parâmetro tem padrão e vai no FIM da assinatura de propósito: as 39 chamadas
-- já reescritas nos crons continuam válidas sem tocar em nenhuma.

create or replace function public.disparar_automacao(
  p_jobname     text,
  p_url         text,
  p_body        jsonb default '{}'::jsonb,
  p_token_nome  text default null,
  p_headers     jsonb default '{}'::jsonb,
  p_timeout_ms  int default 90000
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

  select net.http_post(url := p_url, headers := v_headers,
                       body := coalesce(p_body, '{}'::jsonb),
                       timeout_milliseconds := coalesce(p_timeout_ms, 90000))
    into v_rid;

  insert into public.automacao_execucao (jobname, request_id) values (p_jobname, v_rid);
  return v_rid;
end;
$$;

comment on function public.disparar_automacao(text, text, jsonb, text, jsonb, int) is
  'Dispara a Edge Function de um cron e GUARDA o request_id, para `automacao_colher` poder ler a resposta de verdade depois. O timeout padrão é 90s e não os 5s do pg_net: chamada a modelo de linguagem não responde em cinco segundos, e o painel passava a acusar timeout de automação que tinha dado certo. Ver 20260827320000.';

revoke all on function public.disparar_automacao(text, text, jsonb, text, jsonb, int) from public, anon;
grant execute on function public.disparar_automacao(text, text, jsonb, text, jsonb, int) to service_role;

/* A ASSINATURA DE CINCO ARGUMENTOS PRECISA SAIR, e isto não é limpeza.
   `create or replace` com um parâmetro a mais cria uma função NOVA — a antiga
   continua viva e alcançável. As duas ficariam ambíguas para toda chamada de
   cinco argumentos (`42725: is not unique`), que é exatamente como os 39 crons
   chamam. Já aconteceu neste repo com `notas_externas_acervo`, no mesmo dia em
   que duas frentes mexeram nela. Ver [[migrations-nao-batem-com-o-banco]]. */
drop function if exists public.disparar_automacao(text, text, jsonb, text, jsonb);
