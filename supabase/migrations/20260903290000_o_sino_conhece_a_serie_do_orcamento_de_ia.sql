-- `sinais.serie` tem chave estrangeira para `sinal_serie`, e o aviso de orçamento de IA
-- tentou tocar sem a série cadastrada — o INSERT morria em 23503. Pego no ensaio, antes
-- de o aviso precisar existir de verdade; sem o teste, o primeiro alarme do mês seria
-- justamente o que falharia calado.
--
-- Os parâmetros de banda (k, folga, min_relativo, historico_meses) não valem aqui: esta
-- série não é medida pelo `vigia-series` contra mediana e MAD. Ela é um LIMIAR — 70%, 90%
-- e 100% de um teto que nós declaramos — e quem insere é a `ia_orcamento_alerta()`, em SQL
-- puro, de hora em hora. Ficam nos defaults só porque a tabela os exige.
INSERT INTO public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
VALUES (
  'ia.orcamento', 'configuracoes', 'Orçamento de IA do mês',
  'Gasto acumulado das chamadas de IA no mês contra o teto declarado em Configurações › Uso de IA. '
  || 'Avisa em 70%, 90% e 100%, uma vez por faixa. O provedor não informa saldo: o teto é nosso.',
  '/configuracoes/uso-ia', 'acima', 'alta', true
)
ON CONFLICT (serie) DO UPDATE
  SET titulo = excluded.titulo, descricao = excluded.descricao,
      rota = excluded.rota, atualizado_em = now();
