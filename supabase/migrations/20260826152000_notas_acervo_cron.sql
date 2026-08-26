-- O acervo passa a andar sozinho.
--
-- O QUE FALTAVA: `notas_externas_casar()` NÃO TINHA CRON. Ela só rodava quando
-- alguém apertava "Ler as planilhas" na aba PIX — e como a `gmail-nf-sync`
-- despeja notas de hora em hora e a `comprovantes-drive-sync` todo dia às 09:10,
-- o acervo crescia e o casamento envelhecia. Nota que chegou às 10h esperava
-- alguém abrir a tela para descobrir a que lançamento pertencia.
--
-- Agora são dois passos no mesmo minuto, e é SQL puro: não há Edge Function no
-- meio, então não há `x-cron-token`, nem worker, nem teto de CPU.
--
--   1. `notas_externas_casar()`            — ~3 s, recasa o acervo inteiro
--   2. `notas_externas_enfileirar_automatico()` — põe exata/alta na fila
--
-- O RELÓGIO NÃO É ARBITRÁRIO. Os minutos deste projeto já estão loteados porque
-- a trava do Omie é POR MÉTODO e duas rodadas no mesmo instante disputam o mesmo
-- `ListarAnexo`:
--
--   :25  gmail-nf-sync         (traz nota nova)
--   :30  ESTE                  (casa e enfileira o que chegou)
--   :05 :20 :35 :50  omie-anexar-comprovante  (leva o arquivo ao ERP)
--   :12 :27 :42      omie-anexos-varredura    (relê o ERP e fecha o ciclo)
--
-- Encaixar em :30 fecha a volta em cinco minutos: a nota que entrou às :25 casa
-- às :30, sobe às :35 e o ERP confirma às :42. Antes disso, o mesmo percurso
-- dependia de alguém abrir duas telas.

create extension if not exists pg_cron with schema cron;

select cron.unschedule('notas-acervo-casar')
 where exists (select 1 from cron.job where jobname = 'notas-acervo-casar');

select cron.schedule(
  'notas-acervo-casar',
  '30 * * * *',
  $cron$
  select public.notas_externas_casar(), public.notas_externas_enfileirar_automatico(200);
  $cron$
);

comment on function public.notas_externas_enfileirar_automatico(integer) is
  'Põe na fila do ERP o que casou por IDENTIDADE (exata/alta) ou foi decidido à mão. Confiança média fica de fora — essa espera alguém confirmar na aba Acervo. Roda no cron `notas-acervo-casar`, de hora em hora aos :30.';
