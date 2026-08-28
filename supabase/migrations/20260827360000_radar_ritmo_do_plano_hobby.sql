-- Radar: o ritmo que o plano pago comporta — e o conserto do cron que nunca
-- autenticou.
--
-- PRIMEIRO O DEFEITO, porque sem ele o resto seria enfeite. Os quatro jobs do
-- radar chamavam `disparar_automacao` com `p_token_nome = null` e o JWT anônimo
-- nos headers. A função exige gente logada ou o `x-cron-token`, e o token só é
-- injetado quando se passa o NOME dele — então toda rodada agendada respondia
-- `{"ok":false,"erro":"Não autenticado."}`. Conferido em 27/08/2026 refazendo a
-- chamada exata do cron. O sintoma era o pior possível: `cron.job_run_details`
-- dizendo "succeeded" (porque o SQL que enfileira o POST funcionou), zero linha
-- em `automacao_execucao` para o radar, e a tela do Facilities apenas... parada.
-- Um radar que não varre não avisa que não varreu.
--
-- AGORA O RITMO. Com o Firecrawl no plano pago (5.000 créditos/mês), o gargalo
-- deixa de ser o crédito e passa a ser o que a vigilância entrega:
--
--   • QUATRO VARREDURAS POR DIA, às 8h45, 12h45, 16h45 e 19h45. Promoção de
--     loja de TI dura de algumas horas a um dia; com duas leituras diárias se
--     pega o que dura mais de doze horas, com quatro se pega quase tudo que
--     dura meia jornada. Acima disso é pagar para vigiar a madrugada, quando
--     ninguém vai abrir o link.
--
--   • DUAS CHAMADAS nas rodadas da manhã e do fim da tarde (às :45 e às :49).
--     Uma chamada cobre no máximo dois alvos — não por escolha, mas porque o
--     worker morre aos 150s e um alvo leva de 16 a 54s. A segunda chamada pega
--     quem ficou, e a fila (ordenada por `ultima_varredura`) garante que seja
--     outro. São seis chamadas por dia: com três alvos, quatro varreduras cada.
--
--   • QUATRO CONFERÊNCIAS, meia hora depois de cada varredura. Varrer sem
--     conferir na mesma proporção é encher a quarentena: o achado do meio-dia
--     só apareceria no dia seguinte, e é a conferência que o põe na tela. Ela
--     custa um crédito por anúncio aberto — dobrá-la é barato e é o que de fato
--     entrega.
--
-- A conta fica em ~2.800 créditos/mês com três alvos, contra os 5.000 do plano:
-- folga de 40%, que é a reserva para o dia em que alguma loja passar a exigir
-- proxy stealth (a mesma página salta de 1 para 5 créditos).
--
-- O PRAZO DE 150s NÃO É DETALHE. `disparar_automacao` desiste em 90 segundos por
-- padrão, e uma rodada de varredura pode ir até 135 — o teto do worker. Com o
-- padrão, o pg_net registraria timeout numa rodada que terminou bem, e a faixa
-- de automações mostraria vermelho para um radar funcionando. Alarme que soa
-- sem motivo é pior que alarme nenhum: ensina a ignorar.

/* ------------------------------------------------- fora o agendamento velho */

do $$
declare v text;
begin
  foreach v in array array[
    'facilities-radar-manha', 'facilities-radar-tarde',
    'facilities-radar-confirma-manha', 'facilities-radar-confirma-tarde'
  ] loop
    if exists (select 1 from cron.job where jobname = v) then perform cron.unschedule(v); end if;
  end loop;
end $$;

/* ----------------------------------------------------------- as varreduras */

-- Os horários estão em UTC porque é assim que o pg_cron os lê — e essa foi a
-- pegadinha que fez o radar varrer às 5h45 por dias. A tela não repete a conta:
-- `facilities_radar_agenda()` lê a agenda do próprio cron.
--   11:45 UTC = 08:45 BRT   15:45 = 12:45   19:45 = 16:45   22:45 = 19:45
do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('facilities-radar-varre-manha',      '45 11 * * *'),
      ('facilities-radar-varre-manha-b',    '49 11 * * *'),
      ('facilities-radar-varre-meiodia',    '45 15 * * *'),
      ('facilities-radar-varre-tarde',      '45 19 * * *'),
      ('facilities-radar-varre-tarde-b',    '49 19 * * *'),
      ('facilities-radar-varre-noite',      '45 22 * * *')
    ) as t(nome, quando)
  loop
    if exists (select 1 from cron.job where jobname = j.nome) then perform cron.unschedule(j.nome); end if;
    perform cron.schedule(j.nome, j.quando, format($cmd$
      select public.disparar_automacao(
        %L,
        'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
        '{"action":"varrer","limite":20}'::jsonb,
        'facilities-radar',
        '{}'::jsonb,
        150000
      );
    $cmd$, j.nome));
  end loop;
end $$;

/* --------------------------------------------------------- as conferências */

--   12:15 UTC = 09:15 BRT   16:15 = 13:15   20:15 = 17:15   23:15 = 20:15
do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('facilities-radar-confirma-manha',   '15 12 * * *'),
      ('facilities-radar-confirma-meiodia', '15 16 * * *'),
      ('facilities-radar-confirma-tarde',   '15 20 * * *'),
      ('facilities-radar-confirma-noite',   '15 23 * * *')
    ) as t(nome, quando)
  loop
    if exists (select 1 from cron.job where jobname = j.nome) then perform cron.unschedule(j.nome); end if;
    -- `limite` 8 e não 6: a reconferência dos achados que já estão na tela
    -- reserva vagas nesta mesma fila, e quem sobra é a quarentena. O relógio
    -- continua sendo o freio real — a leva para quando o tempo acaba.
    perform cron.schedule(j.nome, j.quando, format($cmd$
      select public.disparar_automacao(
        %L,
        'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
        '{"action":"confirmar","limite":8}'::jsonb,
        'facilities-radar',
        '{}'::jsonb,
        150000
      );
    $cmd$, j.nome));
  end loop;
end $$;
