-- Radar: a contagem regressiva do topo passa a enxergar o cron SEMANAL da vigia.
--
-- A MENTIRA, vista em 03/09/2026. Com os quatro alvos do kit em vigia e nenhum
-- em compra, a tela dizia "Próxima varredura em 1h48min · 16:45". Aquilo é o
-- cron de compra (`45 19 * * *`), que naquele dia — e em todos os outros —
-- passaria pela fila, não encontraria alvo de compra nenhum e voltaria sem
-- varrer nada. O número estava certo e a frase estava errada: prometia às 16:45
-- um trabalho que só aconteceria na segunda, às 09:00.
--
-- É a mesma família do defeito que esta função nasceu para resolver. O comentário
-- original conta que o radar varreu às 5h45 por dias porque a tela repetia um
-- horário escrito à mão em vez de ler o agendador. Ler o agendador não bastou:
-- é preciso ler TODOS os jobs que agem sobre o que está na tela.
--
-- POR QUE A VIGIA FICAVA DE FORA. O filtro exigia `^[0-9]{1,2} [0-9]{1,2} \* \* \*$`
-- — só agenda diária. O cron da vigia é `0  12 * * 1` e caía fora por duas
-- razões independentes, e a segunda é a traiçoeira:
--
--   1. o quinto campo é `1` (segunda), não `*`;
--   2. ele tem ESPAÇO DUPLO entre o minuto e a hora, porque foi escrito alinhado
--      em coluna na migração que o criou. `split_part(schedule, ' ', 2)` devolve
--      string vazia nesse caso, e `''::int` estoura. Ou seja: bastasse afrouxar
--      o filtro para aceitar o dia da semana, a função passaria a dar ERRO em vez
--      de resposta — e o topo da página sumiria inteiro, porque o componente
--      esconde a linha quando a agenda vem vazia.
--
-- Daí `regexp_split_to_array(btrim(schedule), '\s+')`: o cron aceita qualquer
-- espaçamento, então quem lê o cron também tem de aceitar.
--
-- O QUE CONTINUA DE FORA, e de propósito: lista (`0,30`), passo (`*/15`) e
-- intervalo (`1-5`). A conta para essas formas é fácil de escrever errado, e uma
-- contagem regressiva errada é pior que nenhuma — ela tem toda a cara de certeza.
-- Job com essa forma simplesmente não aparece.

create or replace function public.facilities_radar_agenda()
returns table (job text, acao text, proxima timestamptz)
language sql
stable
security definer
set search_path = public, cron
as $$
  with j as (
    select jobname, regexp_split_to_array(btrim(schedule), '\s+') as p
    from cron.job
    where active
      and jobname like 'facilities-radar%'
      -- minuto, hora, dia do mês `*`, mês `*`, dia da semana `*` ou um número.
      and btrim(schedule) ~ '^[0-9]{1,2}\s+[0-9]{1,2}\s+\*\s+\*\s+(\*|[0-7])$'
  ), q as (
    select
      jobname,
      p[1]::int as minuto,
      p[2]::int as hora,
      -- Domingo é 0 E 7 no cron; `extract(dow)` só conhece o 0.
      (nullif(p[5], '*')::int % 7) as dow
    from j
  ), base as (
    select
      jobname, dow,
      -- O horário de hoje, em UTC, que é como o pg_cron lê a agenda.
      (date_trunc('day', now() at time zone 'UTC') + make_interval(hours => hora, mins => minuto))
        at time zone 'UTC' as hoje,
      extract(dow from (now() at time zone 'UTC'))::int as dow_hoje
    from q
  )
  select
    jobname::text,
    (case
       when jobname like '%confirma%' then 'confirmar'
       when jobname like '%vigia%'    then 'vigia'
       else 'varrer'
     end)::text,
    case
      when dow is null then
        -- Diário: hoje se ainda não passou, senão amanhã.
        case when hoje > now() then hoje else hoje + interval '1 day' end
      else
        -- Semanal: quantos dias até o próximo `dow`. Zero significa "é hoje" —
        -- e aí só vale se a hora ainda não passou; se passou, é daqui a uma
        -- semana inteira.
        hoje + make_interval(days =>
          ((dow - dow_hoje + 7) % 7)
          + case when (dow - dow_hoje + 7) % 7 = 0 and hoje <= now() then 7 else 0 end
        )
    end
  from base
  order by 3;
$$;

revoke all on function public.facilities_radar_agenda() from anon, public;
grant execute on function public.facilities_radar_agenda() to authenticated, service_role;

comment on function public.facilities_radar_agenda() is
  'Quando cada cron do radar roda em seguida, lido do próprio pg_cron. Devolve `acao` = varrer | confirmar | vigia — a vigia é semanal e entrou em 03/09/2026, quando a tela prometia uma varredura diária que não tocaria em alvo nenhum. Aceita agenda diária e semanal simples; lista, passo e intervalo ficam de fora porque conta errada aqui tem cara de certeza.';
