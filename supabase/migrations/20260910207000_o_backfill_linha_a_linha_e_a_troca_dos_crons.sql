/* ============================================================================
 * O backfill linha a linha, e a troca de papéis entre os dois crons.
 *
 * A ARMADILHA QUE ESTA MIGRATION EVITA. O cron das 11:05 rodava com
 * `perna: "ambas"`: criava o lançamento-resumo do dia na "ASAAS Disponível" E a
 * contrapartida na "ASAAS Pago". Com a virada linha a linha, a ação `virar`
 * APAGA os resumos da Disponível assim que as linhas daquele dia entram. Os dois
 * juntos seriam um moinho: o das 11:05 cria o resumo, o da virada apaga, no dia
 * seguinte tudo de novo — gastando chamadas do Omie para chegar ao mesmo lugar.
 *
 * Então cada um fica com metade:
 *   • 11:05, `perna: "pago"` — só a contrapartida do faturado, que segue DIÁRIA
 *     (não é movimentação do Asaas, e a "ASAAS Pago" precisa continuar pequena
 *     para não sair do cache de movimentos, onde mora a receita da DRE);
 *   • de 5 em 5 minutos, `virar` — as linhas do extrato e a remoção dos resumos.
 *
 * O RITMO, e por que é esse. Medido: 1,63 lançamento/segundo. Teto de 150 por
 * invocação leva ~92s, dentro dos 110s de relógio da função. A cada 5 minutos
 * dá 1.800/hora — e as 46.240 linhas levam ~26 horas. Em requisições isso é
 * **30 por minuto, 12,5% do teto de 240/min do Omie**: sobra folga para o
 * omie-caixa-sync, o omie-sync e o resto do Hub, que falam com o mesmo ERP.
 *
 * Correr mais seria possível e não vale: o ganho é chegar em 13h em vez de 26h,
 * e o risco é disputar o orçamento de requisições com os syncs que fecham o mês.
 *
 * QUANDO ACABAR, o cron não precisa ser desligado. `virar` sem dia pendente não
 * faz chamada nenhuma ao Omie — ele vira a rotina que mantém o espelho em dia,
 * com a mesma carência de 2 dias de sempre.
 * ========================================================================== */

/* 1. O diário deixa de mexer na "ASAAS Disponível". */
select cron.unschedule('asaas-omie-extrato-diario')
where exists (select 1 from cron.job where jobname = 'asaas-omie-extrato-diario');

select cron.schedule(
  'asaas-omie-extrato-diario',
  '5 11 * * *',
  $$
  select public.disparar_automacao(
    'asaas-omie-extrato-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-omie-extrato',
    '{"action":"enviar","perna":"pago","teto":60,"trigger":"cron"}'::jsonb,
    'asaas-omie-extrato',
    '{}'::jsonb,
    160000
  );
  $$
);

/* 2. A virada linha a linha, de 5 em 5 minutos. */
select cron.unschedule('asaas-omie-linha')
where exists (select 1 from cron.job where jobname = 'asaas-omie-linha');

select cron.schedule(
  'asaas-omie-linha',
  '*/5 * * * *',
  $$
  select public.disparar_automacao(
    'asaas-omie-linha',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/asaas-omie-extrato',
    '{"action":"virar","teto":150,"trigger":"cron"}'::jsonb,
    'asaas-omie-extrato',
    '{}'::jsonb,
    160000
  );
  $$
);
