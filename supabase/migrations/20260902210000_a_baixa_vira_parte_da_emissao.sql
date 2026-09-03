-- A baixa vira parte da emissão, não um mutirão.
--
-- Continuação de [20260902200000_a_cobranca_paga_deixa_de_assustar]. Aquela
-- migration abriu espaço para regularizar as 1.428 OS já emitidas; esta existe
-- para que não haja uma 1.429ª.
--
-- ===========================================================================
-- POR QUE UM CRON, E NÃO UM PASSO DENTRO DA EMISSÃO
--
-- O título a receber não nasce quando a OS é criada — nasce quando ela é
-- FATURADA, e o faturamento é assíncrono: `FaturarLoteOS` volta na hora, o lote
-- fecha uns 2 minutos depois e o RPS vira nota autorizada ~1 minuto após isso
-- (os dois tempos, medidos na OS 1629). A rodada de emissão já respondeu e
-- morreu muito antes de existir título para baixar.
--
-- Pendurar a baixa no fim de `emitir_dia` significaria esperar o lote dentro de
-- um worker que já opera a 103–153s contra o limite DURO de 150s do gateway.
-- Seria trocar "cliente vê Atrasada" por "a rodada morre no 504 e as notas saem
-- sem registro" — que é o acidente que o `teto_rodada = 16` acabou de conter.
--
-- Um cron separado é o desenho certo porque a pergunta que ele faz é barata e
-- idempotente: "que OS têm nota autorizada e título ainda em aberto?". Se ele
-- perder uma rodada, a seguinte pega. Se rodar com a fila vazia, custa duas
-- leituras do Postgres e nenhuma chamada ao Omie.
--
-- ===========================================================================
-- O RITMO, E POR QUE ELE É APERTADO
--
-- O que resta de exposição ao cliente é uma JANELA, e ela precisa ser curta. A
-- corrente é: a rodada emite → ~2min o lote fecha → ~1min o RPS vira nota
-- autorizada → o `espelhar` (de 10 em 10) grava isso → só então a baixa acha o
-- título. Enquanto isso o e-mail com o link do portal JÁ FOI (o `cEnvLink` é
-- lido no faturamento), e quem clicar cedo vê "Atrasada".
--
-- Daí de 5 em 5 minutos, das 13h às 22h UTC — a janela de emissão (`13-21`) mais
-- uma hora de rabo, para alcançar o que foi faturado no fim do expediente. Isso
-- põe o pior caso em ~10 minutos em vez de ~25.
--
-- Os minutos 3/8/13/…/58 são todos `3 mod 5`, e nenhum colide com
-- `nf-emissao-diaria` (0,10,20,30,40,50) nem com `nf-espelho-rodada`
-- (5,15,25,35,45,55): três crons batendo no mesmo método do Omie ao mesmo tempo
-- esbarram na trava, que é POR MÉTODO e não por função.
--
-- RODAR 12 VEZES POR HORA NÃO CUSTA 12 VARREDURAS. Com a fila vazia a função
-- devolve antes de qualquer chamada ao Omie — são duas leituras do Postgres. As
-- 4 páginas de `ListarContasReceber` só acontecem quando há o que baixar, ou
-- seja ~uma vez por rodada de emissão.
--
-- `teto` 70 é o que cabe no orçamento de 110s do worker: ~9s para indexar os
-- títulos (4 páginas de 500) e ~1,3s por `LancarRecebimento`, medido na
-- varredura de 02/09 (1.024 baixas em 14 levas).

select cron.unschedule('nf-baixar-adiantamento')
where exists (select 1 from cron.job where jobname = 'nf-baixar-adiantamento');

select cron.schedule(
  'nf-baixar-adiantamento',
  '3,8,13,18,23,28,33,38,43,48,53,58 13-22 * * *',
  $cron$
  select public.disparar_automacao(
    'nf-baixar-adiantamento',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-nfse-sync',
    '{"action":"baixar_adiantamento","teto":70}'::jsonb,
    'omie-nfse-sync',
    jsonb_build_object(
      'apikey',        current_setting('app.anon_key', true),
      'Authorization', 'Bearer ' || current_setting('app.anon_key', true)
    )
  );
  $cron$
);
