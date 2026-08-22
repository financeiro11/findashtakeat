-- Auditoria: o comprovante vai ao Omie sozinho.
--
-- MEDIDO ANTES DE ESCREVER (21/08/2026):
--   • 81 achados com comprovante — 20 anexados no Omie, 61 parados;
--   • 44 lançamentos da base do cartão com comprovante — NENHUM anexado;
--   • 104 linhas paradas para 100 títulos distintos (4 títulos aparecem dos dois lados).
-- Não era regra de negócio: era falta de quem apertasse o botão. O envio só existia como
-- gesto manual na tela (e por um webhook do n8n que não enxerga o bucket privado).
--
-- A varredura é deliberadamente burra: quem tem comprovante + `omie_cod_titulo` gravado +
-- nenhum carimbo de envio vai para o ERP. Sem recasar título, sem heurística — o
-- "Cruzar com Omie" já decidiu qual é o título, e refazer aquilo aqui só criaria uma
-- segunda opinião para discordar da primeira.

insert into public.internal_cron_tokens (name)
select 'omie-anexar-comprovante'
where not exists (select 1 from public.internal_cron_tokens where name = 'omie-anexar-comprovante');

-- LOTE DE 6, QUATRO VEZES POR HORA — e não um lote grande por dia.
--
-- MEDIDO: o worker é derrubado com WORKER_RESOURCE_LIMIT por volta do 10º item, ANTES do
-- freio de 55s da própria função. O teto é de CPU, não de relógio: zipar e converter o
-- arquivo para base64 é o que consome (o `incluirAnexo` ainda prepara as duas variantes,
-- zip e cru, mesmo quando a primeira resolve). Como cada item é carimbado assim que entra
-- no Omie, morrer no meio não perde trabalho — mas some com o relatório, e um lote grande
-- termina sempre em erro. Lote pequeno e frequente dá 576 anexos/dia de folga; com a fila
-- vazia a chamada volta em 1s.
select cron.schedule(
  'auditoria-anexo-varredura',
  '5,20,35,50 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/omie-anexar-comprovante',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'omie-anexar-comprovante')
    ),
    body := '{"action":"varredura","limite":6}'::jsonb
  );
  $cron$
);
