/* ============================================================================
 * A rotina que mantém o extrato do Asaas em dia dentro do Omie.
 *
 * Roda às 11:05 UTC, 20 minutos depois do `asaas-extrato-sync` das 10:45 — o
 * espelho precisa estar fresco antes de alguém somar o dia. Fica na fresta
 * entre o `omie-orcamento-sync` (11:00) e o `omie-contas-pagar-sync` (11:20):
 * a trava do Omie é POR MÉTODO, e `IncluirLancCC` não briga com `ListarMovimentos`,
 * mas não custa não empilhar.
 *
 * UMA VEZ AO DIA BASTA, e a razão é a carência: a função só lança dia fechado há
 * mais de dois dias (CARENCIA_DIAS), porque o `asaas-extrato-sync` reprocessa os
 * últimos três e um dia que ainda cresce viraria lançamento incompleto — que
 * ninguém conserta depois, já que o Omie recusa a mesma chave de integração
 * duas vezes. Em regime são ~5 lançamentos por dia; o teto de 40 dá folga de
 * uma semana inteira de atraso sem ninguém precisar tocar em nada.
 *
 * O `teto` também protege o relógio: o worker morre por volta dos 150s sem
 * exceção que dê para pegar, e a função tem freio próprio em 110s.
 * ========================================================================== */

select cron.unschedule('asaas-omie-extrato-diario')
where exists (select 1 from cron.job where jobname = 'asaas-omie-extrato-diario');

select cron.schedule(
  'asaas-omie-extrato-diario',
  '5 11 * * *',
  $$
  select public.disparar_automacao(
    'asaas-omie-extrato-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-omie-extrato',
    '{"action":"enviar","teto":40,"trigger":"cron"}'::jsonb,
    'asaas-omie-extrato',
    '{}'::jsonb,
    150000
  );
  $$
);
