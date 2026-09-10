-- Radar de Preços: o achado confirmado vira mensagem de WhatsApp.
--
-- O QUE FALTAVA ERA A MEMÓRIA DO QUE JÁ FOI DITO. A conferência roda quatro
-- vezes por dia e o alerta fica na tela até virar cotação ou ser arquivado —
-- sem registro de envio, a mesma oferta seria mandada em toda rodada, e um
-- aviso que chega todo dia às 09:15, 13:15, 17:15 e 20:15 deixa de ser lido
-- exatamente como o `MAX_ALERTAS_POR_ALVO` já previa para a tela.
--
-- DUAS COLUNAS, NÃO UMA. `avisado_em` sozinho responderia "já mandei?" e a
-- regra escolhida foi outra: manda de novo SE O PREÇO CAIU MAIS depois do
-- último aviso. Isso exige saber por quanto ele foi anunciado — daí
-- `avisado_preco`. Sem ele, a alternativa seria comparar com `preco`, que é
-- justamente o campo que a reconferência acabou de atualizar: a comparação
-- sempre daria "igual" e a queda nunca sairia.
--
-- O preço guardado é o COMPARÁVEL (o mesmo `alertas.preco`): unitário no alvo
-- recorrente, total com frete nos demais. Guardar o total num alvo medido por
-- quilo faria a comparação trocar de moeda no meio.

alter table public.facilities_radar_alertas
  add column if not exists avisado_em timestamptz,
  add column if not exists avisado_preco numeric;

comment on column public.facilities_radar_alertas.avisado_em is
  'Quando este achado foi enviado por WhatsApp. Nulo = nunca avisado. Só é carimbado depois de o n8n confirmar o envio — sem canal configurado, fica nulo e a rodada seguinte tenta de novo.';

comment on column public.facilities_radar_alertas.avisado_preco is
  'O preço comparável no momento do último aviso. É contra ele que se decide reavisar (só quando cai mais que QUEDA_MINIMA_PARA_REAVISAR), nunca contra o preço atual.';

-- O QUE JÁ ESTÁ NA TELA NASCE COMO "JÁ AVISADO", e esta é a linha que evita o
-- pior primeiro dia possível. A reconferência passa por TODO achado na tela a
-- cada 24h; sem o carimbo, a primeira rodada depois do deploy encontraria
-- dezenas de alertas com `avisado_em` nulo e mandaria o acervo inteiro de uma
-- vez — inaugurando o canal com exatamente a mensagem que ensina a ignorá-lo.
--
-- E o preço vai junto, não só a data: com `avisado_preco` nulo a regra de
-- reavisar não teria contra o que comparar e o achado antigo só voltaria a
-- falar se alguém o arquivasse. Assim, oferta velha que CAIR de preço amanhã
-- ainda avisa — que é o comportamento pedido.
update public.facilities_radar_alertas
   set avisado_em = coalesce(created_at, now()),
       avisado_preco = preco
 where avisado_em is null
   and status in ('novo', 'visto')
   and preco > 0;
