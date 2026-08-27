-- Fornecedor de fora não emite NFS-e. O recibo dele É o documento.
--
-- Decisão do financeiro em 27/08/2026: "tudo que for estrangeiro você pode
-- aceitar invoice caso eles não emitam NF no estilo brasileira".
--
-- É a mesma decisão que já valia para Uber e 99, por um motivo idêntico:
-- recusar o documento que o fornecedor emite, porque ele não é uma NFS-e
-- brasileira, manda alguém procurar um papel que não existe.
--
-- ---------------------------------------------------------------------------
-- O SINAL É A MOEDA, e ele se identifica sozinho
--
-- Não precisa de cadastro de fornecedor: um documento emitido em USD ou EUR não
-- saiu de emissor brasileiro. `moeda` já vem preenchida pela `nota-ler-arquivo`
-- desde `20260827140000`. Cadastro exigiria alguém lembrar de manter a lista;
-- a moeda está no papel.
--
-- ATENÇÃO: `valor_moeda is not null` NÃO significa estrangeiro — essa coluna
-- guarda o valor original também quando ele é em real. Quem responde é
-- `moeda in ('USD','EUR')`. Cheguei a suspeitar de 124 notas brasileiras lidas
-- como dólar; eram todas `moeda = 'BRL'`, com `valor_moeda = valor`.
--
-- ---------------------------------------------------------------------------
-- SÓ O RECIBO SOBE, E `outro` FICA DE FORA — é o ponto que faz a diferença
--
-- Medido, entre os documentos em moeda estrangeira:
--   nota    55 linhas · R$ 362.335  (já contavam)
--   outro   27 linhas · R$ 249.705  (NÃO sobem)
--   recibo  12 linhas · R$ 115.850  (passam a contar)
--
-- Os 27 de `outro` são principalmente **CREDIT_MEMO** e **Order** do HubSpot.
-- Nota de crédito é DEVOLUÇÃO, não despesa: aceitá-la como documento de um
-- título a pagar seria dar por resolvida uma cobrança com o papel que a desfaz.
-- "Order" é pedido, que antecede a cobrança. Por isso a promoção alcança
-- exatamente um tipo, e não "tudo que não é nota".
--
-- Boleto também fica de fora, e continua fora mesmo em dólar: boleto prova que
-- se pagou, não o que se comprou.

update public.notas_externas
   set tipo_documento = 'nota', atualizado_em = now()
 where moeda in ('USD', 'EUR')
   and tipo_documento = 'recibo'
   and ignorado_em is null;

comment on column public.notas_externas.moeda is
  'A moeda em que o documento foi emitido. `valor` fica SEMPRE em reais (convertido pela PTAX do dia); `valor_moeda` guarda o número original — inclusive quando ele é em real, então valor_moeda NÃO é sinal de documento estrangeiro. Quem responde isso é esta coluna. Documento em USD/EUR não sai de emissor brasileiro, e por isso o recibo dele vale como nota (decisão de 27/08/2026): não existe NFS-e a cobrar de quem não a emite.';
