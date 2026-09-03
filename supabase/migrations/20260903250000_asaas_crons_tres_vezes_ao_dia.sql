-- Asaas: espalha as rotinas em 3 horarios/dia (07:45, 12:30, 17:00 BRT), no lugar
-- do bloco unico da manha. Sem webhook, e o polling que mantem os dados frescos ao
-- longo do dia — e o custo e irrisorio: cada rodada ~15-30 requisicoes, 3x/dia,
-- contra a cota de 25.000/12h do Asaas (menos de 0,5%).
--
-- PRESERVA O COMANDO de cada cron (lido do proprio cron.job), so troca o horario:
-- cada job vira 3 (-1/-2/-3), com o mesmo corpo/token. Os horarios em UTC (pg_cron
-- le em UTC): 07:45 BRT = 10:45, 12:30 BRT = 15:30, 17:00 BRT = 20:00.
--
-- IDEMPOTENTE: reaplicar reconstroi os 3 a partir do que existir (base ou -1).
-- Os nomes de automacao DENTRO do comando (1o argumento do disparar_automacao)
-- seguem os originais de proposito — sao a chave de token e de log, nao o jobname.

create extension if not exists pg_cron with schema cron;

do $$
declare
  base    text;
  cmd     text;
  s       text;
  i       int;
  victims text[];
  v       text;
  bases   text[] := array[
    'asaas-extrato-sync-diario',
    'asaas-janela-sync-diaria',
    'asaas-sync-diario',
    'estornos-sync-asaas',
    'nf-sondar-config-asaas'
  ];
  slots   text[] := array['45 10 * * *', '30 15 * * *', '0 20 * * *']; -- 07:45 / 12:30 / 17:00 BRT
begin
  foreach base in array bases loop
    -- comando atual (do job base ou, em reaplicacao, do primeiro variante)
    select command into cmd
      from cron.job
      where jobname = base or jobname = base || '-1'
      order by (jobname = base) desc
      limit 1;

    if cmd is null then
      raise notice 'cron % nao encontrado, pulando', base;
      continue;
    end if;

    -- remove o base e quaisquer variantes antigas (coleta antes de apagar)
    select array_agg(jobname) into victims
      from cron.job
      where jobname = base or jobname like base || '-_';
    if victims is not null then
      foreach v in array victims loop
        perform cron.unschedule(v);
      end loop;
    end if;

    -- recria em 3 horarios, mesmo comando
    i := 0;
    foreach s in array slots loop
      i := i + 1;
      perform cron.schedule(base || '-' || i, s, cmd);
    end loop;
  end loop;
end $$;
