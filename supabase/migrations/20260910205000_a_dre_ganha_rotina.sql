/* ============================================================================
 * A DRE/DFC ganha rotina.
 *
 * Até 10/09/2026 o `omie-sync` só rodava por clique na tela — e ninguém clicava.
 * O último rodou em 04/09 04:27, e a coluna Sep-26 da DRE mostrava 383.114,03,
 * que é a soma dos títulos de 01 a **03/09**. Seis dias de ERP parados.
 *
 * O QUE ESCONDIA ISSO: o `updated_at` de `demonstracoes_contabeis` ficava fresco
 * assim mesmo, porque o cron `demonstracoes-meios-pagamento-diario` (11:15)
 * reescreve o blob todo dia. Quem responde "está sincronizado?" é o
 * `omie_sync_log`, nunca o `updated_at`.
 *
 * POR QUE 12:25 E NÃO ANTES — este é o ponto que decide se a rotina sobrevive.
 * Nenhum cron passa `atualizar`, então quem chega PRIMEIRO com o cache de
 * movimentos vencido (>6h, `IDADE_MOVIMENTOS_MIN`) paga o pull inteiro do Omie.
 * MEDIDO no próprio `omie_sync_log`: a rodada fria de 10/09/2026 levou **157,8s**
 * com 16.552 movimentos; a quente, lendo cache, levou **1,2s**. O teto de 150s
 * até a primeira resposta do gateway é DURO e não sobe em plano nenhum.
 *
 * Às 12:25 o `omie-caixa-sync-diario` (12:00) já pagou o pull — ele é o único
 * cron diário que lê os movimentos — e o `omie-sync` lê do cache em ~1s.
 *
 * SE MESMO ASSIM ESTOURAR, o estrago é cosmético e não de dado: o gateway
 * devolve 504 aos 150s mas o worker continua vivo (400s no plano pago) e termina
 * o trabalho. Foi exatamente o que aconteceu na rodada de 157,8s — ela gravou o
 * blob e fechou o log com `status: ok`. Ou seja, o painel de automações pode
 * pintar vermelho num dia em que a DRE atualizou. Quem responde de verdade é o
 * `omie_sync_log`.
 *
 * `timeout_milliseconds` vai em 160000, acima dos 150s do gateway, para que a
 * resposta colhida seja sempre o veredito de alguém e não um estouro do lado do
 * Postgres.
 *
 * Roda DEPOIS do cron de Meios de Pagamento (11:15) de propósito: a camada de
 * valores manuais é reaplicada no fim de toda escrita (`salvarDemonstracao`),
 * então a célula do Asaas sobrevive ao sync — e o sync recalcula os totais com
 * ela dentro.
 * ========================================================================== */

select cron.unschedule('omie-sync-diario')
where exists (select 1 from cron.job where jobname = 'omie-sync-diario');

select cron.schedule(
  'omie-sync-diario',
  '25 12 * * *',
  $$
  select public.disparar_automacao(
    'omie-sync-diario',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-sync',
    '{"action":"sync","trigger":"cron"}'::jsonb,
    'omie-sync',
    '{}'::jsonb,
    160000
  );
  $$
);
