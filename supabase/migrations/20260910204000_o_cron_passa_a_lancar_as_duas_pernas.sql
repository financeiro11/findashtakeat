/* ============================================================================
 * O cron diário passa a lançar as DUAS pernas.
 *
 * Desde 10/09/2026 cada dia de extrato tem duas metades no ERP: o movimento na
 * "ASAAS Disponível" (o extrato propriamente dito) e a saída do faturado na
 * "ASAAS Pago" — o que entra numa sai da outra, que é o que impede a Pago de
 * voltar a acumular dinheiro que não existe.
 *
 * Sem `perna: "ambas"`, o cron manteria só a primeira metade e a Pago voltaria a
 * crescer sozinha à razão de um mês de faturamento por mês — devagar o bastante
 * para ninguém perceber até o fechamento seguinte.
 *
 * O teto sobe de 40 para 60 pelo mesmo motivo: em regime são ~5 lançamentos de
 * extrato mais ~1 de contrapartida por dia, e 60 continua dando mais de uma
 * semana de folga se a rotina passar dias sem rodar.
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
    '{"action":"enviar","perna":"ambas","teto":60,"trigger":"cron"}'::jsonb,
    'asaas-omie-extrato',
    '{}'::jsonb,
    150000
  );
  $$
);
