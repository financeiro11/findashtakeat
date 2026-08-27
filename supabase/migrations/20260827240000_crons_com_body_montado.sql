-- Os 17 crons que sobraram, e por que precisaram de outra abordagem.
--
-- A reescrita de `20260827230000` só alcançava `body := '{...}'::jsonb` — um
-- literal, fácil de recortar com regex. Dezessete crons montam o corpo com
-- `body := jsonb_build_object('action', 'sync', ...)`, e alguns com expressão
-- de verdade dentro (data calculada, subselect). Recortar isso com regex é o
-- caminho para quebrar um cron sem perceber: basta um parêntese aninhado.
--
-- Aqui a expressão é extraída POR BALANCEAMENTO DE PARÊNTESES e copiada
-- INTEIRA, sem interpretar nada. `disparar_automacao` recebe `jsonb`, então a
-- expressão continua sendo avaliada no disparo, exatamente como antes —
-- inclusive as que dependem de `now()`.
--
-- A guarda continua a mesma: quem não casar fica como está.

create or replace function public.expressao_do_argumento(p_comando text, p_arg text)
returns text
language plpgsql
immutable
as $$
declare
  i int;
  nivel int := 0;
  c char;
  ini int;
  aspas boolean := false;
begin
  i := position(p_arg || ' :=' in p_comando);
  if i = 0 then i := position(p_arg || ':=' in p_comando); end if;
  if i = 0 then return null; end if;

  ini := position(':=' in substr(p_comando, i)) + i + 1;
  -- pula os espaços depois do :=
  while substr(p_comando, ini, 1) in (' ', E'\n', E'\r', E'\t') loop ini := ini + 1; end loop;

  i := ini;
  while i <= length(p_comando) loop
    c := substr(p_comando, i, 1);
    /* Aspas simples escondem parênteses e vírgulas: sem tratá-las, um valor
       como 'a(b' derrubaria a contagem e o recorte sairia pela metade. */
    if c = '''' then
      aspas := not aspas;
    elsif not aspas then
      if c = '(' then nivel := nivel + 1;
      elsif c = ')' then
        if nivel = 0 then exit; end if;   -- fechou a chamada do http_post
        nivel := nivel - 1;
      elsif c = ',' and nivel = 0 then exit;   -- próximo argumento
      end if;
    end if;
    i := i + 1;
  end loop;

  return btrim(substr(p_comando, ini, i - ini));
end;
$$;

comment on function public.expressao_do_argumento(text, text) is
  'Recorta a expressão de um argumento nomeado (`body := ...`) contando parênteses e respeitando aspas. Existe porque regex quebra em `jsonb_build_object(...)` aninhado — e um cron quebrado por recorte errado só se descobre quando alguém repara que algo parou.';

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
    v_body  := public.expressao_do_argumento(r.command, 'body');
    v_anon  := substring(r.command from '''apikey''\s*,\s*''([^'']+)''');

    if v_url is null or v_body is null or v_body = '' then
      v_pulados := v_pulados + 1;
      raise notice 'pulado: % (url=% body=%)', r.jobname, v_url is not null, v_body;
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
      '    %s,\n'
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

  raise notice 'crons reescritos nesta leva: %, pulados: %', v_feitos, v_pulados;
end
$do$;
