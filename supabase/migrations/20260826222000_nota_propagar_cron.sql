-- A propagação também precisa de uma varredura, e não só dos gatilhos.
--
-- POR QUE O GATILHO NÃO BASTA. Ele é de LINHA, e boa parte do que dá alvo a uma
-- nota é escrita em MASSA: `notas_externas_casar` roda um `update` sobre 4 mil
-- linhas de uma vez, e o `omie-match-cartao` preenche `omie_cod_titulo` em lote.
-- Nesses caminhos o gatilho até dispara, mas o que muda é o ALVO da nota — não
-- a coluna do arquivo — e o vínculo novo nasce sem ninguém para espalhá-lo.
--
-- Então: gatilho para o gesto de gente (anexar agora, aqui) e varredura para o
-- que as máquinas descobrem sozinhas. A varredura é barata porque
-- `nota_propagar` só escreve onde está vazio: passada em dia não faz nada.
--
-- `:08` está livre — os anexos disputam a fila do Omie em `:05 :20 :35 :50`
-- (enviar), `:12 :27 :42` (reler), `:00 :10 :30 :40` (aquecer link) e
-- `:15 :45` (triagem). Esta é SQL puro e não toca o ERP, mas rodar junto do
-- envio só criaria contenção no banco à toa.

select cron.unschedule('nota-propagar-varredura')
 where exists (select 1 from cron.job where jobname = 'nota-propagar-varredura');

select cron.schedule(
  'nota-propagar-varredura',
  '8 * * * *',
  $cron$ select public.nota_propagar_tudo(800); $cron$
);
