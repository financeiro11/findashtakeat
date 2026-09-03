-- Passagens: o teto deixa de ser palpite.
--
-- O PROBLEMA. O teto decide quando o sino toca, e até agora saía de um chute:
-- baixo demais, nunca toca; alto demais, toca no preço de sempre. Os dois são
-- modos de morte deste módulo, e quem cadastra a viagem não tem como saber em
-- qual dos dois caiu — não existe, em lugar nenhum da empresa, a resposta para
-- "quanto costuma custar ir a Porto Alegre?".
--
-- E A RESPOSTA NÃO É PEDIR PARA A IA CHUTAR. Um modelo que sugerisse "R$ 2.700
-- para VIX–POA em novembro" erraria do jeito mais perigoso: com confiança e sem
-- rastro. Preço de rota é dado local, volátil e datado — exatamente onde a
-- alucinação sai plausível. E o teto não é opinião, é gatilho: um número que
-- ninguém consegue defender vira silêncio permanente ou ruído permanente.
-- É a mesma decisão já registrada em `sugerirTeto` (_shared/radar-precos.ts):
-- os números saem da regra, testados e iguais toda vez; a IA no máximo redige.
--
-- TRÊS FONTES DE DADO, que chegam em momentos diferentes:
--
--   1. AGORA — o preço que o Google mostra na tela em que a pessoa já está
--      (ela precisa abrir o link para ligar o alerta). Vira o primeiro ponto da
--      curva, e o `google_veredito` guarda o que o Google disse sobre ele.
--   2. EM SEMANAS — a curva desta viagem, que `sugerirTeto` já sabe ler.
--      `passagens_curva_diaria` entrega no formato `PontoHistorico` que a função
--      espera, para não haver uma segunda régua de teto no Hub.
--   3. DEPOIS DE COMPRAR — o que a empresa de fato pagou naquela rota. É a mais
--      forte das três, porque é dado próprio e verificável, e a única que
--      funciona NO INSTANTE do cadastro de uma rota repetida.

/* ------------------------------------------------ o que o Google dizia */

alter table public.passagens_viagens
  -- Qualitativo, e não derivável de preço nenhum: o Google calcula com o
  -- histórico dele e escreve "os preços estão altos no momento". R$ 3.793 com
  -- "alto" convida a esperar; o mesmo R$ 3.793 com "baixo" convida a comprar.
  -- Guardado como foto do momento do cadastro, nunca reavaliado.
  add column if not exists google_veredito text
    check (google_veredito is null or google_veredito in ('baixo', 'tipico', 'alto'));

comment on column public.passagens_viagens.google_veredito is
  'O que o Google Flights dizia sobre o preço quando a viagem foi cadastrada (baixo/tipico/alto). Foto do momento — não é reavaliado. O preço em si não mora aqui: vira o primeiro ponto de passagens_precos.';

/* ------------------------------------- camada 2: a curva no formato certo */

-- Entrega `passagens_precos` na forma `PontoHistorico` de radar-precos.ts —
-- `{dia, menor, mediana, ofertas}` — para o front chamar `sugerirTeto` sem
-- adaptação. Reusar a função em vez de escrever uma segunda é o ponto: duas
-- réguas de teto no mesmo Hub divergiriam no primeiro ajuste, e o sintoma seria
-- a tela do Radar e a de Passagens discordando sobre o que é um teto bom.
--
-- ATENÇÃO À AMOSTRA. O Radar mede ~28 vezes em 14 dias; aqui os pontos chegam
-- quando o Google resolve escrever, o que pode ser uma vez por semana. Por isso
-- a tela mostra QUANTOS pontos sustentam a conta em vez de esconder o número
-- atrás do `pode` da função — com cinco pontos a leitura ainda vale, desde que
-- se saiba que são cinco.
create or replace function public.passagens_curva_diaria(p_viagem_id uuid, p_dias integer default 180)
returns table (dia date, menor numeric, mediana numeric, ofertas integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (pr.coletado_em at time zone 'America/Sao_Paulo')::date as dia,
    round(min(pr.preco), 2)                                 as menor,
    round((percentile_cont(0.5) within group (order by pr.preco))::numeric, 2) as mediana,
    count(*)::int                                           as ofertas
  from passagens_precos pr
  where pr.viagem_id = p_viagem_id
    and pr.coletado_em >= now() - make_interval(days => greatest(coalesce(p_dias, 180), 1))
  group by 1
  order by 1;
$$;

revoke all on function public.passagens_curva_diaria(uuid, integer) from anon, public;
grant execute on function public.passagens_curva_diaria(uuid, integer) to authenticated, service_role;

/* ------------------------------ camada 3: o livro de preços da empresa */

-- Quanto a empresa JÁ PAGOU nesta rota. É a referência mais defensável que
-- existe — não é estimativa de mercado, é o extrato — e a única que responde no
-- instante do cadastro, antes de qualquer curva.
--
-- CASA POR PAR EXATO DE IATA, e a limitação é consciente: VIX–GRU e VIX–CGH são
-- a mesma viagem para quem vai a São Paulo, e aqui contam separado. Agrupar por
-- cidade exigiria a tabela de aeroportos no banco, que hoje vive só no TS
-- (AEROPORTOS, em _shared/passagens.ts) — duplicá-la para ganhar esse caso é
-- trocar um erro pequeno e visível por duas listas que divergem em silêncio.
--
-- Só viagem COMPRADA entra. Cancelada e expirada não têm preço pago, e
-- rastreando ainda não é história — é a pergunta em aberto.
create or replace function public.passagens_historico_rota(p_origem text, p_destino text)
returns table (
  compras      integer,
  menor        numeric,
  mediana      numeric,
  maior        numeric,
  ultima_em    timestamptz,
  ultimo_preco numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with pagas as (
    select v.preco_comprado as preco, v.comprado_em
    from passagens_viagens v
    where v.status = 'comprada'
      and v.preco_comprado is not null
      and upper(v.origem)  = upper(p_origem)
      and upper(v.destino) = upper(p_destino)
  )
  select
    count(*)::int                                                              as compras,
    round(min(preco), 2)                                                       as menor,
    round((percentile_cont(0.5) within group (order by preco))::numeric, 2)    as mediana,
    round(max(preco), 2)                                                       as maior,
    max(comprado_em)                                                           as ultima_em,
    (select p.preco from pagas p order by p.comprado_em desc nulls last limit 1) as ultimo_preco
  from pagas;
$$;

revoke all on function public.passagens_historico_rota(text, text) from anon, public;
grant execute on function public.passagens_historico_rota(text, text) to authenticated, service_role;
