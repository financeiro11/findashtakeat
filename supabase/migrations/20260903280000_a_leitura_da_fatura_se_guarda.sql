-- A transcrição do PDF passa a ser guardada.
--
-- O uso natural é "ensaia, confere, grava", e cada passo relia o mesmo PDF de 30 páginas:
-- em 03/09/2026 a fatura de agosto foi ao modelo TRÊS vezes (ensaio, gravação que abortou
-- na chave duplicada, gravação boa) para produzir uma resposta só. Ler PDF é a chamada mais
-- cara do Hub — cobra-se por página, e são ~35 por fatura.
--
-- `resultado` guarda o RELATÓRIO (o que casou, o que ficou órfão); `leitura` guarda o que o
-- modelo transcreveu. São coisas diferentes: o relatório muda quando o extrato muda, a
-- leitura não muda nunca — é o que está impresso no papel.
ALTER TABLE public.cartao_fatura_rateio
  ADD COLUMN IF NOT EXISTS leitura jsonb;

COMMENT ON COLUMN public.cartao_fatura_rateio.leitura IS
  'Transcrição crua do PDF (blocos por portador). Reaproveitada pelas rodadas seguintes da '
  'mesma competência; `reler: true` no corpo força uma leitura nova no modelo.';
