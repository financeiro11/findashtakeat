-- Radar: o cron da vigia permanente — uma manhã por semana, e só ela.
--
-- CINCO CHAMADAS PARA UMA VARREDURA SEMANAL, e a razão não é redundância: é o
-- relógio. Uma chamada cobre no máximo DOIS alvos, porque `ORCAMENTO_MS` corta
-- a rodada em 55s e um alvo leva de 16 a 54s mesmo com duas fontes (elas correm
-- em paralelo — o custo é o da mais lenta, não a soma). Cinco chamadas de cinco
-- em cinco minutos cobrem até dez alvos, que é a lista inteira prevista (as
-- seis faixas do kit de estação mais os modelos adotados).
--
-- O ESPAÇAMENTO É DE CINCO MINUTOS, e não de um: quem sobra da primeira chamada
-- tem de ser encontrado pela segunda, e `facilities_radar_fila_vigia` guarda um
-- piso de 30 minutos entre duas varreduras do MESMO alvo — o espaçamento só
-- precisa ser maior que a duração de uma rodada (~2 min) para a chamada
-- seguinte não pegar a fila no meio do trabalho.
--
-- SEGUNDA DE MANHÃ, e a escolha tem motivo. A curva é semanal: o dia exato não
-- muda a série, desde que seja SEMPRE o mesmo — medir ora na segunda ora no
-- sábado misturaria promoção de fim de semana com preço de dia útil na mesma
-- linha do tempo. Segunda 09:00 BRT também é quando alguém está na mesa para
-- ver o card ficar vermelho se uma fonte quebrar.
--
-- NÃO HÁ CRON DE CONFERÊNCIA AQUI, e isso é o desenho inteiro. Vigia não
-- confere: é a conferência que custa (abrir o anúncio um a um, `maxAge: 0`,
-- digitar o CEP) e é ela que a curva não precisa. Quando o alvo entra em modo
-- compra, ele passa a ser pego pelos crons normais — varredura E conferência —
-- sem que nada aqui mude.
--
-- 12:00 UTC = 09:00 BRT. O pg_cron lê a agenda em UTC, e escrever o horário de
-- Brasília aqui já fez o radar varrer às 05:45 por dias sem sintoma nenhum.

create extension if not exists pg_cron with schema cron;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('facilities-radar-vigia-1', '0  12 * * 1'),
      ('facilities-radar-vigia-2', '5  12 * * 1'),
      ('facilities-radar-vigia-3', '10 12 * * 1'),
      ('facilities-radar-vigia-4', '15 12 * * 1'),
      ('facilities-radar-vigia-5', '20 12 * * 1')
    ) as t(nome, quando)
  loop
    if exists (select 1 from cron.job where jobname = j.nome) then perform cron.unschedule(j.nome); end if;
    /* `p_token_nome` PREENCHIDO — foi o defeito que deixou os quatro jobs do
       radar respondendo "Não autenticado." por dias, com `cron.job_run_details`
       dizendo "succeeded" e `automacao_execucao` sem uma linha sequer. O token
       de cron só é injetado quando se passa o NOME dele; JWT anônimo nos
       headers não serve. Ver a migração do ritmo do plano Hobby.

       E `p_timeout_ms` de 150000: o padrão é 90s, e uma rodada de vigia com
       duas fontes vai a ~110s. Com o padrão, o pg_net registraria timeout numa
       rodada que terminou bem e a faixa de automações mostraria vermelho — o
       alarme que soa sem motivo, que ensina a ignorar. */
    perform cron.schedule(j.nome, j.quando, format($cmd$
      select public.disparar_automacao(
        %L,
        'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/facilities-radar',
        '{"action":"varrer","modo":"vigia","limite":20}'::jsonb,
        'facilities-radar',
        '{}'::jsonb,
        150000
      );
    $cmd$, j.nome));
  end loop;
end $$;
