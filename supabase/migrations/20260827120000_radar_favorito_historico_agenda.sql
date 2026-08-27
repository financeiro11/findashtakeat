-- Radar: favoritos, histórico de preço conferível, e a agenda lida do cron.
--
-- Três coisas que andam juntas porque atendem à mesma pergunta do Facilities:
-- "esse preço é bom mesmo?". A resposta não está no preço de hoje — está na
-- linha do tempo dele.

/* --------------------------------------------------------------- favoritos */

-- Equipamento que a empresa compra sempre (notebook do time, cadeira padrão)
-- não deveria ser recadastrado a cada contratação. Marcado como favorito, o
-- alvo fica fixo no topo e — o que importa de verdade — **entra primeiro na
-- fila da varredura**: a ordem passa a ser favorito, depois quem está há mais
-- tempo sem ser varrido. Sem isso, "favorito" seria enfeite de tela.
alter table public.facilities_radar_alvos
  add column if not exists favorito boolean not null default false;

create index if not exists idx_radar_alvos_fila
  on public.facilities_radar_alvos (ativo, favorito desc, ultima_varredura nulls first);

/* ------------------------------------------------- histórico de verdade */

-- ATÉ AQUI, SÓ O QUE CABIA NO TETO VIRAVA LINHA — e isso mutilava justamente o
-- histórico. Um notebook que custa R$ 4.500 há três meses era descartado como
-- "acima do teto" e sumia; quando enfim caísse para R$ 3.900, não haveria com o
-- que comparar, e o Hub dirianada além de "entrou no teto".
--
-- Agora o anúncio que passa em TODOS os filtros e só peca no preço também é
-- guardado, marcado com `dentro_do_teto = false`. Ele não vira alerta, não
-- conta como "oferta ativa" e não disputa o "melhor agora" — mas alimenta a
-- curva. É ele que dá sentido à frase "R$ 3.900 é o menor preço em 90 dias".
--
-- O que continua sendo jogado fora é o que NÃO é o produto: acessório, sucata,
-- spec abaixo do pedido. Isso não é histórico de nada.
alter table public.facilities_radar_ofertas
  add column if not exists dentro_do_teto boolean not null default true;

create index if not exists idx_radar_ofertas_historico
  on public.facilities_radar_ofertas (alvo_id, ativo);

-- Um ponto por dia, por alvo: o menor total do dia, a mediana e quantos
-- anúncios sustentavam aquele preço.
--
-- POR DIA, e não por varredura: são duas varreduras diárias e o gráfico ficaria
-- serrilhado por uma diferença de horário, não de mercado. E a MEDIANA junto do
-- mínimo de propósito — o mínimo isolado pode ser uma promoção-relâmpago de um
-- vendedor só; a distância entre os dois conta se o preço caiu ou se apareceu
-- um outlier.
create or replace function public.facilities_radar_historico(
  p_alvo_id uuid,
  p_dias    integer default 90
)
returns table (
  dia          date,
  menor        numeric,
  mediana      numeric,
  ofertas      integer,
  menor_no_teto numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (pr.coletado_em at time zone 'America/Sao_Paulo')::date as dia,
    round(min(pr.preco), 2)                                  as menor,
    round((percentile_cont(0.5) within group (order by pr.preco))::numeric, 2) as mediana,
    count(distinct pr.oferta_id)::int                        as ofertas,
    -- O menor entre os que caberiam no teto. Fica null no dia em que nada
    -- coube, e é exatamente essa lacuna que mostra desde quando se espera.
    round(min(pr.preco) filter (where o.dentro_do_teto), 2)  as menor_no_teto
  from facilities_radar_precos pr
  join facilities_radar_ofertas o on o.id = pr.oferta_id
  where o.alvo_id = p_alvo_id
    and pr.coletado_em >= now() - make_interval(days => greatest(p_dias, 1))
  group by 1
  order by 1;
$$;

-- A linha do tempo de UM anúncio, para quando a pergunta é "esse produto
-- específico está caindo?".
create or replace function public.facilities_radar_historico_oferta(
  p_oferta_id bigint,
  p_dias      integer default 90
)
returns table (dia date, preco numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select (coletado_em at time zone 'America/Sao_Paulo')::date, round(min(preco), 2)
  from facilities_radar_precos
  where oferta_id = p_oferta_id
    and coletado_em >= now() - make_interval(days => greatest(p_dias, 1))
  group by 1
  order by 1;
$$;

/* ------------------------------------------------------------------ agenda */

-- Quando é a próxima varredura, LIDO DO PRÓPRIO CRON.
--
-- A tentação é a tela saber os horários e mostrar uma conta. Foi assim que o
-- radar passou dias varrendo às 5h45 da manhã sem ninguém notar: o comentário
-- dizia 08:45, o pg_cron lia UTC, e não havia nada na tela para desmentir. Uma
-- contagem regressiva que lê de outro lugar que não o agendador é capaz de
-- contar para uma hora que não existe.
--
-- SECURITY DEFINER porque `cron.job` não é legível por `authenticated`, e o
-- filtro por nome é fixo: esta função só enxerga os jobs do radar e devolve
-- nome, ação e horário — nada do comando, que carrega credencial.
create or replace function public.facilities_radar_agenda()
returns table (job text, acao text, proxima timestamptz)
language sql
stable
security definer
set search_path = public, cron
as $$
  with j as (
    select jobname,
           split_part(schedule, ' ', 1)::int as minuto,
           split_part(schedule, ' ', 2)::int as hora
    from cron.job
    where active
      and jobname like 'facilities-radar%'
      -- Só agenda diária simples; qualquer outra forma seria conta errada.
      and schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$'
  ), hoje as (
    select jobname, minuto, hora,
           (date_trunc('day', now() at time zone 'UTC')
             + make_interval(hours => hora, mins => minuto)) at time zone 'UTC' as quando
    from j
  )
  select
    jobname::text,
    (case when jobname like '%confirma%' then 'confirmar' else 'varrer' end)::text,
    case when quando > now() then quando else quando + interval '1 day' end
  from hoje
  order by 3;
$$;

/* ------------------------------------------------------------------ painel */

-- O painel passa a respeitar o teto ao escolher a melhor oferta e a contar as
-- ativas — senão as linhas guardadas só para histórico apareceriam como se
-- fossem achados — e a ordenar favoritos primeiro.
drop function if exists public.facilities_radar_painel();

create function public.facilities_radar_painel()
returns table (
  alvo               jsonb,
  alertas_novos      integer,
  ofertas_ativas     integer,
  melhor             jsonb,
  economia_aberta    numeric,
  economia_realizada numeric,
  pontos_historico   integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_jsonb(a) as alvo,
    (select count(*)::int from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'novo') as alertas_novos,
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
       order by coalesce(o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada,
    -- Quantos DIAS distintos de preço existem. É o que diz se já dá para
    -- confiar na curva ou se ela ainda é um ponto solto.
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico
  from facilities_radar_alvos a
  order by a.ativo desc, a.favorito desc, a.created_at desc;
$$;

comment on column public.facilities_radar_ofertas.dentro_do_teto is
  'false = passou em todos os filtros MENOS no preço. Não vira alerta nem conta como oferta ativa, mas alimenta o histórico — é ele que dá sentido a "menor preço em 90 dias".';
comment on column public.facilities_radar_alvos.favorito is
  'Equipamento que a empresa compra sempre. Fixa o alvo no topo E o coloca na frente da fila de varredura.';
