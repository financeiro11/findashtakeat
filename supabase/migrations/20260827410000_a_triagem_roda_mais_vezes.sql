-- A triagem passa a rodar de 5 em 5 minutos — e o lote NÃO aumenta.
--
-- Pedido do usuário: *"pode aumentar o lote, só tome cuidado para não quebrar
-- nada"*. O cuidado começa por ler o que já foi medido: a própria
-- `anexo-triagem` tem os números no cabeçalho, de 26/08/2026.
--
--   ms_por_documento: 45.978   ← 46 segundos cada, e são ESPERA DO GEMINI
--   megabytes: 1,8             ← quatro documentos inteiros vivos
--
-- O custo é espera, não memória e não CPU. E lote grande já foi tentado e
-- morreu: `limite: 20` derrubou o worker com WORKER_RESOURCE_LIMIT depois de 5
-- documentos, e a chamada seguinte com `limite: 6` morreu depois de 4 — porque
-- o worker é reutilizado entre invocações e rodadas seguidas dividem o mesmo
-- orçamento. Está escrito lá: *"throughput não vem de lote grande: vem de
-- rodada pequena e frequente"*.
--
-- Então o lote fica onde está. O que muda é a frequência: de 4 para 12 vezes por
-- hora. Com 8 documentos por rodada (é o que o orçamento de 55 s entre ondas
-- permite, medido agora: a rodada das 20:17 leu exatamente 8), são 96 por hora
-- em vez de 32 — os 431 que faltam saem em ~4h30 em vez de ~13h30.
--
-- Os minutos são `:02, :07, :12…` de propósito: o envio ao Omie está em
-- `:05/:20/:35/:50` e a leitura de arquivos em `:35`. Empilhar duas funções
-- pesadas no mesmo minuto é o jeito mais fácil de transformar duas coisas que
-- funcionam numa que não funciona.
--
-- ---------------------------------------------------------------------------
-- E O TIMEOUT, QUE ERA O DEFEITO DE VERDADE
--
-- A rodada das 20:17 apareceu no painel como falha:
--
--   status_code: null
--   resposta: "Timeout of 90000 ms reached"
--
-- Ela tinha funcionado. Leu os 8 documentos e terminou às 20:19:13 — 133
-- segundos. Quem desistiu aos 90 foi o `pg_net`, com o teto que eu mesmo pus
-- hoje de manhã em `disparar_automacao` (`20260827320000`), quando o problema
-- era o padrão de 5 s da plataforma.
--
-- 90 s cobre chamada de IA que lê UM documento. Esta lê oito, em duas ondas de
-- quatro, e 110–135 s é o funcionamento normal dela. O teto vai a **170 s** só
-- aqui, no ponto de chamada, e não no padrão da função: as outras 38 automações
-- respondem em segundos, e afrouxar o padrão para todas esconderia justamente o
-- travamento que o painel existe para mostrar.
--
-- Aumentar a frequência SEM isto teria enchido o painel de vermelho — doze
-- falsos alarmes por hora, na semana em que ele acabou de nascer.

select cron.schedule(
  'anexo-triagem-ia',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  $cron$
  select public.disparar_automacao(
    'anexo-triagem-ia',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/anexo-triagem',
    '{"action":"triar","limite":16}'::jsonb,
    'anexo-triagem',
    '{}'::jsonb,
    170000
  );
  $cron$
);

/* O `limite: 16` do corpo fica como está de propósito, e não é descuido: ele é
   clipado duas vezes antes de virar trabalho — a `anexo_triagem_fila` corta em
   12, e o orçamento de 55 s entre ondas corta em 8. Baixá-lo para 8 não mudaria
   nada hoje e tiraria a folga do dia em que os documentos forem menores e as
   ondas mais rápidas. */
