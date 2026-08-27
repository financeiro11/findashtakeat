-- Os crons passam a registrar o que dispararam.
--
-- Sem isto, `disparar_automacao` e `automacao_colher` existem e ficam vazias: o
-- vínculo entre o cron e a resposta HTTP só pode ser gravado NO DISPARO, porque
-- o `pg_net` esvazia a fila de requisição ao processar (ver `20260827220000`).
--
-- A REESCRITA É AUTOMÁTICA, e conservadora por construção: extrai url, body e
-- nome do token do comando atual, e **só reescreve quem casar os três**. O que
-- não casar fica exatamente como está — continua aparecendo no painel, só sem o
-- status HTTP. Errar para menos aqui significa um cron sem status; errar para
-- mais significaria um cron quebrado.
--
-- O comando antigo fica guardado em `automacao_comando_antigo`. Não é zelo
-- excessivo: `cron.schedule` sobrescreve sem devolver o que havia, e sem cópia
-- o caminho de volta seria reconstruir 30 comandos de memória.
--
-- Os headers de `apikey`/`Authorization` (anon key) são preservados quando o
-- comando original os tinha. A anon key é pública — está no bundle do front —,
-- então copiá-la para o agendamento não expõe nada. O que NÃO se copia é o
-- token de cron: ele continua sendo lido na hora do disparo, para que rotacionar
-- o token não exija reagendar nada.

create table if not exists public.automacao_comando_antigo (
  jobname   text primary key,
  comando   text not null,
  schedule  text,
  salvo_em  timestamptz not null default now()
);

comment on table public.automacao_comando_antigo is
  'O comando de cada cron antes da reescrita de 27/08/2026. `cron.schedule` sobrescreve sem devolver o que havia; sem esta cópia o caminho de volta seria reconstruir os comandos de memória.';

do $do$
declare
  r record;
  v_url    text;
  v_token  text;
  v_body   text;
  v_anon   text;
  v_extra  text;
  v_novo   text;
  v_feitos int := 0;
  v_pulados int := 0;
begin
  for r in
    select jobid, jobname, schedule, command
      from cron.job
     where command ilike '%net.http_post%'
       and command ilike '%functions/v1/%'
       and command not ilike '%disparar_automacao%'
     order by jobname
  loop
    v_url   := substring(r.command from 'url\s*:=\s*''([^'']+)''');
    v_token := substring(r.command from 'internal_cron_tokens\s+where\s+name\s*=\s*''([^'']+)''');
    v_body  := substring(r.command from 'body\s*:=\s*''(\{.*?\})''::jsonb');
    v_anon  := substring(r.command from '''apikey''\s*,\s*''([^'']+)''');

    -- Sem url ou sem body não dá para reconstruir a chamada com segurança.
    if v_url is null or v_body is null then
      v_pulados := v_pulados + 1;
      continue;
    end if;

    v_extra := case
      when v_anon is null then '''{}''::jsonb'
      else format('jsonb_build_object(%L, %L, %L, %L)',
                  'apikey', v_anon, 'Authorization', 'Bearer ' || v_anon)
    end;

    v_novo := format(
      E'  select public.disparar_automacao(\n'
      '    %L,\n'
      '    %L,\n'
      '    %L::jsonb,\n'
      '    %s,\n'
      '    %s\n'
      '  );',
      r.jobname, v_url, v_body,
      case when v_token is null then 'null' else quote_literal(v_token) end,
      v_extra);

    insert into public.automacao_comando_antigo (jobname, comando, schedule)
    values (r.jobname, r.command, r.schedule)
    on conflict (jobname) do nothing;

    perform cron.schedule(r.jobname, r.schedule, v_novo);
    v_feitos := v_feitos + 1;
  end loop;

  raise notice 'crons reescritos: %, pulados: %', v_feitos, v_pulados;
end
$do$;
