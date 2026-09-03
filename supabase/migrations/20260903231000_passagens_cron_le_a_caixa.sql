-- Passagens: o cron que lê os alertas do Google Flights na caixa do financeiro@.
--
-- DUAS VEZES AO DIA, e não mais. O que chega é e-mail: o Google manda quando
-- ele quer, e ler a mesma caixa de hora em hora não faria aparecer alerta que
-- não foi enviado — só gastaria worker para reencontrar os mesmos ids já
-- gravados. Manhã e fim de tarde cobrem o dia útil com folga, e a janela de
-- `newer_than:7d` da função garante que nada se perde se uma rodada falhar.
--
-- 11:20 UTC = 08:20 BRT · 20:20 UTC = 17:20 BRT. O pg_cron lê em UTC — escrever
-- horário de Brasília aqui já fez o radar varrer às 05:45 por dias sem sintoma.
--
-- `p_token_nome` PREENCHIDO: o token de cron só é injetado quando se passa o
-- NOME dele. Sem isso a função responde "Não autenticado." e o
-- `cron.job_run_details` diz "succeeded" mesmo assim — o defeito mais mudo que
-- este projeto já teve.

insert into public.internal_cron_tokens (name, token)
values ('passagens-gmail-sync', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create extension if not exists pg_cron with schema cron;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('passagens-gmail-manha', '20 11 * * *'),
      ('passagens-gmail-tarde', '20 20 * * *')
    ) as t(nome, quando)
  loop
    if exists (select 1 from cron.job where jobname = j.nome) then perform cron.unschedule(j.nome); end if;
    perform cron.schedule(j.nome, j.quando, format($cmd$
      select public.disparar_automacao(
        %L,
        'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/passagens-gmail-sync',
        '{"action":"sync","dias":7}'::jsonb,
        'passagens-gmail-sync',
        '{}'::jsonb,
        150000
      );
    $cmd$, j.nome));
  end loop;
end $$;
