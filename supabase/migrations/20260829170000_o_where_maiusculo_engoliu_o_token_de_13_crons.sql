-- O `WHERE` maiúsculo engoliu o token de 13 crons.
--
-- A reescrita automática de `20260827230000` (e a segunda leva, `20260827240000`)
-- extraía o nome do token do comando antigo com:
--
--     substring(r.command from 'internal_cron_tokens\s+where\s+name\s*=\s*''([^'']+)''')
--
-- `substring(... from ...)` no Postgres é regex POSIX **sensível a maiúsculas**, e
-- os comandos antigos foram escritos em SQL maiúsculo:
--
--     'x-cron-token', (SELECT token FROM public.internal_cron_tokens WHERE name = 'asaas-sync')
--                                                                    ^^^^^
--
-- `where` nunca casou com `WHERE`. A extração devolveu null, a guarda das duas
-- migrações só barrava url/body ausentes — token null era considerado legítimo
-- (há crons que de fato não usam token) — e os 13 foram reagendados com
-- `p_token_nome => null`. `disparar_automacao` então monta os headers SEM o
-- `x-cron-token`, a função recebe só a anon key, `requireUser` não acha usuário
-- nenhum e responde "Não autenticado.".
--
-- O DEFEITO É O MESMO QUE O CABEÇALHO DE `20260827450000` DESCREVE — "os jobs
-- passavam `p_token_nome = null`, a função respondia 'Não autenticado' e o
-- `cron.job_run_details` dizia 'succeeded'". Ali ele foi corrigido à mão para
-- dois crons novos; aqui ele havia sido INTRODUZIDO em treze antigos pela
-- reescrita, no mesmo dia, e ninguém ligou os dois fatos.
--
-- POR QUE NÃO APARECEU NO PAINEL. Oito das treze funções devolvem
-- `{"error":"Não autenticado."}` com **HTTP 200** — `falhou()` em
-- `src/lib/automacoes.ts` olhava só o status, e 200 é verde. As outras duas que
-- devolvem 401 foram as únicas a acender a faixa vermelha. Quer dizer: o Asaas,
-- o caixa do Omie, o orçamento e os estornos estavam parados havia dois dias
-- pintados de verde. O predicado do painel passa a ler o corpo (ver o commit
-- que acompanha esta migração).
--
-- A RESTAURAÇÃO É VERIFICADA, não confiada. Cada comando é regenerado a partir
-- da cópia guardada em `automacao_comando_antigo` pelos mesmos extratores de
-- antes — agora com `(?i)` no do token — e só é aplicado se o resultado for
-- IDÊNTICO ao comando atual a menos do argumento do token. Regenerar é o que
-- restaura fielmente; a comparação é o que garante que a regeneração não trocou
-- silenciosamente um body pelo caminho. Quem não casar fica exatamente como
-- está e é anunciado por `raise notice`.
--
-- `editais-sync-diario` fica de fora de propósito: o comando antigo dele nunca
-- teve token, e `editais-sync` não exige usuário — ele roda bem com null.

do $do$
declare
  r record;
  v_novo   text;
  v_feitos int := 0;
  v_pulados int := 0;
begin
  for r in
    select j.jobname, j.schedule, j.command as atual, a.comando as antigo,
           substring(a.comando from '(?i)internal_cron_tokens\s+where\s+name\s*=\s*''([^'']+)''') as token,
           substring(a.comando from 'url\s*:=\s*''([^'']+)''') as url,
           substring(a.comando from '''apikey''\s*,\s*''([^'']+)''') as anon
      from cron.job j
      join public.automacao_comando_antigo a on a.jobname = j.jobname
     where j.command ilike '%disparar_automacao%'
       and j.command ~ ',\s*null,'
     order by j.jobname
  loop
    if r.token is null or r.url is null then
      v_pulados := v_pulados + 1;
      raise notice 'pulado (sem token no comando antigo): %', r.jobname;
      continue;
    end if;

    -- Só existe token se ele existir de verdade: reagendar apontando para um
    -- nome ausente devolveria o header vazio e o mesmo "Não autenticado.".
    if not exists (select 1 from public.internal_cron_tokens t where t.name = r.token) then
      v_pulados := v_pulados + 1;
      raise notice 'pulado (token % não existe): %', r.token, r.jobname;
      continue;
    end if;

    v_novo := format(
      E'  select public.disparar_automacao(\n    %L,\n    %L,\n    %s,\n    %s,\n    %s\n  );',
      r.jobname, r.url,
      public.expressao_do_argumento(r.antigo, 'body'),
      quote_literal(r.token),
      case when r.anon is null then '''{}''::jsonb'
           else format('jsonb_build_object(%L, %L, %L, %L)',
                       'apikey', r.anon, 'Authorization', 'Bearer ' || r.anon) end);

    /* A GUARDA. O comando regenerado tem de ser o comando atual com o token no
       lugar do `null` — nada mais. Se divergir, alguma extração mudou de
       comportamento desde 27/08 e reagendar seria escrever por cima de um
       agendamento que funciona com um palpite. */
    if replace(r.atual, ' null,', ' ' || quote_literal(r.token) || ',') is distinct from v_novo then
      v_pulados := v_pulados + 1;
      raise notice 'pulado (regenerado difere do atual): %', r.jobname;
      continue;
    end if;

    perform cron.schedule(r.jobname, r.schedule, v_novo);
    v_feitos := v_feitos + 1;
    raise notice 'token % devolvido a %', r.token, r.jobname;
  end loop;

  raise notice 'crons restaurados: %, pulados: %', v_feitos, v_pulados;
end
$do$;
