/* ============================================================================
 * O backfill acelera de 26h para ~6h — e ganha uma janela de silêncio.
 *
 * O QUE MUDOU NO RITMO. Tirar as idas ao Postgres do caminho crítico (o lote
 * inteiro vira 'pendente' de uma vez, e os resultados voltam de 25 em 25) levou
 * o ritmo de 2,07 para **2,43 lançamentos por segundo**, medido em rodada real:
 * 250 linhas em 102,8s. Com o cron de 2 em 2 minutos, são 7.500 linhas por hora,
 * contra 1.800 antes.
 *
 *   45.500 linhas restantes ÷ 7.500 por hora ≈ **6 horas**.
 *
 * O CUSTO EM REQUISIÇÕES, que é o que precisa ficar seguro: 125 por minuto,
 * ~52% do teto de 240/min do Omie. Sobra metade — e a metade que sobra é para a
 * máquina de NFS-e, que roda das 13h às 22h UTC a ~6 chamadas por minuto, e para
 * as varreduras de anexo, que são de quinze em quinze minutos.
 *
 * A JANELA DE SILÊNCIO (10h, 11h e 12h UTC) é o que garante isso. É nela que
 * moram os consumidores pesados, e nenhum deles é interrompível:
 *
 *   10:45  asaas-extrato-sync      espelha o extrato do Asaas
 *   11:00  omie-orcamento-sync
 *   11:05  asaas-omie-extrato      a contrapartida diária da "ASAAS Pago"
 *   11:15  demonstracoes-meios-pagamento
 *   11:20  omie-contas-pagar-sync  até 300 consultas numa rodada
 *   12:00  omie-caixa-sync         paga o pull do cache: ~121s de varredura
 *   12:25  omie-sync               a DRE, lendo do cache
 *
 * Disputar orçamento de requisição justamente com o fechamento seria trocar seis
 * horas de backfill por um dia sem DRE. Três horas paradas custam pouco: o
 * backfill acaba antes de chegar nelas, e em regime a virada não tem o que fazer
 * — sem dia pendente, ela não faz uma chamada sequer ao Omie.
 * ========================================================================== */

select cron.unschedule('asaas-omie-linha')
where exists (select 1 from cron.job where jobname = 'asaas-omie-linha');

select cron.schedule(
  'asaas-omie-linha',
  -- de 2 em 2 minutos, exceto 10h, 11h e 12h UTC
  '*/2 0-9,13-23 * * *',
  $$
  select public.disparar_automacao(
    'asaas-omie-linha',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-omie-extrato',
    '{"action":"virar","teto":250,"trigger":"cron"}'::jsonb,
    'asaas-omie-extrato',
    '{}'::jsonb,
    160000
  );
  $$
);
