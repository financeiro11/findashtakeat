-- Loja que não tem o produto sai do alvo por uma semana.
--
-- Em 13/09/2026 o alvo "Bolsa Bag Máquina Fotográfica" consultou Pichau e
-- Terabyte, lojas de informática: devolveram o próprio catálogo na faixa de
-- preço (mouse, gabinete, powerbank), e todo o crédito da leitura foi gasto
-- para o anúncio ser recusado. `facilities_radar_rendimento` não resolve isto:
-- é por fonte e global, e a Pichau rende bem nos alvos de TI.
--
-- A medida é POR ALVO e por família de lojas (Zoom/Buscapé/Bondfaro são uma
-- só): anúncios lidos e quantos atendiam ao pedido. A varredura escreve; a
-- regra (`fonteForaDoAssunto`, em _shared/radar-precos.ts) lê. O formulário
-- zera a coluna quando o pedido muda.

alter table public.facilities_radar_alvos
  add column if not exists fontes_rendimento jsonb not null default '{}'::jsonb;

comment on column public.facilities_radar_alvos.fontes_rendimento is
  'Por loja/família, neste alvo: {anuncios, uteis, ultima}. Escrito pela varredura; zerado quando o pedido muda.';

-- A bolsa já foi medida: depois da limpeza de 13/09, oferta ativa = oferta que
-- atende ao pedido, então a contagem sai do próprio banco.
update public.facilities_radar_alvos a
   set fontes_rendimento = s.rend
  from (
    select jsonb_object_agg(
             fonte,
             jsonb_build_object(
               'anuncios', n,
               'uteis', u,
               'ultima', to_char(v at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             )
           ) as rend
      from (
        select fonte, count(*)::int as n, (count(*) filter (where ativo))::int as u, max(visto_em) as v
          from public.facilities_radar_ofertas
         where alvo_id = 'af63c7bc-501a-481e-add7-3c7f7972fa26'
         group by fonte
      ) x
  ) s
 where a.id = 'af63c7bc-501a-481e-add7-3c7f7972fa26'
   and a.fontes_rendimento = '{}'::jsonb;
