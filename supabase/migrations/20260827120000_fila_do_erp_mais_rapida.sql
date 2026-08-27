-- A fila do ERP anda 3× mais rápido, sem tocar no que protege o worker.
--
-- ---------------------------------------------------------------------------
-- O QUE FOI MEDIDO, em 27/08/2026, com 227 notas esperando
--
--   • vazão real: 12 a 19 anexos por hora (12 h de `enviado_erp_em`);
--   • 425 tentativas em 12 h, das quais **41 precisaram converter imagem**.
--
-- O segundo número é o que muda a decisão. `CONVERSOES_POR_RODADA = 3` existe
-- porque converter foto para PDF é o único passo que mata o worker por CPU — e
-- foi calibrado numa rodada que morreu no quarto arquivo. Mas ele quase não
-- morde: 3 por rodada × 48 rodadas dá 144 conversões possíveis por 12 h, e só
-- 41 foram usadas. Ou seja, **90% da fila é PDF e XML, que quase não custam** —
-- e o que segurava a vazão era o teto de ITENS, não o de CPU.
--
-- ---------------------------------------------------------------------------
-- AS DUAS ALAVANCAS, e por que estas e não outras
--
-- 1. `limite` 6 → 12. O teto de itens por rodada. O que protege o worker
--    continua sendo `CONVERSOES_POR_RODADA` (3, no código) e `ORCAMENTO_MS`
--    (55 s, conferido ANTES de puxar trabalho novo) — nenhum dos dois muda.
--    Doze PDFs cabem com folga onde três imagens não cabiam.
--
-- 2. Quatro rodadas a mais por hora: 5,20,35,50 → 5,13,20,28,35,43,50,58.
--    Espaçadas de 7 a 8 minutos, e cada rodada termina em menos de 60 s: não há
--    duas se sobrepondo.
--
-- OS MINUTOS CONTINUAM COREOGRAFADOS, e é isso que torna seguro aumentar a
-- frequência. A trava do Omie é POR MÉTODO, então o que não pode é dobrar o
-- mesmo método — e cada varredura usa um:
--
--   :00 :10 :30 :40   ObterAnexo   (aquecer o link)
--   :12 :27 :42       ListarAnexo  (reler o que o ERP tem)
--   :02 :17 :32 :47   triagem (Gemini, lê do cache)
--   :25               gmail-nf-sync (não toca no Omie)
--   :30               casar + enfileirar (só Postgres)
--   :40               nota-baixar-link (não toca no Omie)
--   :08               propagar (só Postgres)
--
-- Os slots novos (13, 28, 43, 58) caem um minuto DEPOIS do ListarAnexo, o que é
-- de propósito: relê o que o ERP tem e, logo em seguida, manda o que ainda
-- falta — com a leitura mais fresca possível.
--
-- ---------------------------------------------------------------------------
-- SE ESTOURAR, NADA SE PERDE. O worker morre com `WORKER_RESOURCE_LIMIT` sem
-- devolver relatório, mas o carimbo é gravado ITEM A ITEM: o que subiu está
-- marcado, e a rodada seguinte começa exatamente de onde esta parou. O
-- prejuízo de errar para mais é uma rodada sem resposta, não anexo duplicado.
-- Para voltar atrás basta reagendar com `limite: 6` e as quatro rodadas.

select cron.unschedule('auditoria-anexo-varredura')
 where exists (select 1 from cron.job where jobname = 'auditoria-anexo-varredura');

select cron.schedule('auditoria-anexo-varredura', '5,13,20,28,35,43,50,58 * * * *', $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexar-comprovante',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'omie-anexar-comprovante')
    ),
    body := '{"action":"varredura","limite":12}'::jsonb
  );
$cron$);

/* A releitura acompanha: sem ela o Hub manda mais rápido do que descobre que
   mandou, e a tela continua acusando quem já foi atendido. `ListarAnexo` é
   leitura pura e barata — o custo é a vez na fila do Omie, e ela ganhou dois
   slots que não colidem com nenhum outro método. */
select cron.unschedule('omie-anexos-varredura')
 where exists (select 1 from cron.job where jobname = 'omie-anexos-varredura');

select cron.schedule('omie-anexos-varredura', '12,27,42,57 * * * *', $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexos-varredura',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'omie-anexos-varredura')
    ),
    body := '{"action":"varrer","limite":150}'::jsonb
  );
$cron$);

/* E o casamento passa a rodar duas vezes por hora, não uma. Ele é só Postgres
   (~3 s) e é ele que transforma "nota nova no acervo" em "nota na fila" — com
   uma rodada por hora, uma nota que chega às :31 espera 59 minutos antes de
   sequer entrar na fila. :00 está livre de Postgres (lá só há ObterAnexo). */
select cron.unschedule('notas-acervo-casar')
 where exists (select 1 from cron.job where jobname = 'notas-acervo-casar');

select cron.schedule('notas-acervo-casar', '0,30 * * * *', $cron$
  select public.notas_externas_casar(), public.notas_externas_enfileirar_automatico(200);
$cron$);
