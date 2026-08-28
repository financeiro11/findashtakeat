-- Radar: compra recorrente (copa, limpeza, papelaria) — preço por unidade e
-- cadência própria.
--
-- POR QUE NÃO BASTAVA CADASTRAR UM ALVO DE CAFÉ. O radar comparava etiqueta com
-- etiqueta, e em consumível isso não erra às vezes: erra sempre para o mesmo
-- lado. Café de 500 g por R$ 34 e café de 1 kg por R$ 52 aparecem lado a lado na
-- mesma busca; o primeiro tem a etiqueta menor e o segundo é 23% mais barato de
-- verdade. Um teto de "R$ 60" não quer dizer nada até se saber o tamanho do
-- pacote — e é justamente o pacote pequeno que bate o teto primeiro.
--
-- Então, para alvo recorrente, o `preco_alvo` passa a ser lido como teto POR
-- UNIDADE (R$/kg, R$/L, R$/un), e o que o radar compara, ordena e guarda na
-- curva é o preço unitário. O `preco_total` continua sendo o que sai do caixa —
-- são duas perguntas que convivem na tela: "quanto sai o pacote?" e "está caro
-- o quilo?".
--
-- A CADÊNCIA É DO ALVO, e não do cron. Notebook se olha todo dia porque o preço
-- se mexe e a compra é grande; papel higiênico se olha por semana. Com o serviço
-- de raspagem no plano gratuito, varrer café duas vezes por dia seria gastar o
-- crédito do mês para ver o mesmo preço 14 vezes.

/* ------------------------------------------------------------- cadência */

-- 0 = toda rodada do cron, que é o comportamento de sempre e continua sendo o
-- padrão: esta migração não muda o ritmo de nenhum alvo existente.
alter table public.facilities_radar_alvos
  add column if not exists cadencia_dias integer not null default 0;

comment on column public.facilities_radar_alvos.cadencia_dias is
  'Dias mínimos entre varreduras deste alvo. 0 = toda rodada (equipamento); 7 = semanal (consumível).';

/* --------------------------------------------------- preço por unidade */

alter table public.facilities_radar_ofertas
  -- O preço na unidade do alvo. Null em equipamento — e é o `coalesce` com
  -- `preco_total` que faz as duas naturezas conviverem na mesma tabela.
  add column if not exists preco_unitario    numeric,
  add column if not exists embalagem_qtd     numeric,
  add column if not exists embalagem_unidade text,
  -- "500g", "6x1,5L", "12 rolos": como estava escrito no anúncio. A tela mostra
  -- isto ao lado do preço unitário, senão "R$ 52/kg" fica sem lastro.
  add column if not exists embalagem_texto   text;

comment on column public.facilities_radar_ofertas.preco_unitario is
  'Preço por kg/L/unidade, com frete rateado. É o que o teto e o ranking comparam em alvo recorrente; null em equipamento.';

/* ------------------------------------------------------- fila de varredura */

-- A fila passa a respeitar a cadência de cada alvo. Ficou como função porque o
-- filtro compara uma coluna com uma expressão sobre OUTRA coluna
-- (`ultima_varredura < now() - cadencia_dias`), e isso não se escreve num
-- filtro do PostgREST — tentar fazê-lo no cliente traria os alvos errados e
-- descartaria depois, gastando a vaga da rodada com quem não estava na hora.
--
-- A TOLERÂNCIA DE UMA HORA não é folga estética. O cron dispara sempre no mesmo
-- horário; sem ela, um alvo varrido ontem às 08:45:10 não estaria "há um dia
-- inteiro sem varrer" às 08:45:00 de hoje — por dez segundos —, e a cadência
-- diária viraria, na prática, a cada dois dias.
create or replace function public.facilities_radar_fila(p_limite integer default 20)
returns setof public.facilities_radar_alvos
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from facilities_radar_alvos a
  where a.ativo
    and (
      a.cadencia_dias <= 0
      or a.ultima_varredura is null
      or a.ultima_varredura < now() - make_interval(days => a.cadencia_dias) + interval '1 hour'
    )
  -- Favorito na frente; depois, quem está há mais tempo sem ser olhado.
  order by a.favorito desc, a.ultima_varredura asc nulls first
  limit greatest(coalesce(p_limite, 20), 1);
$$;

revoke all on function public.facilities_radar_fila(integer) from anon, public;
grant execute on function public.facilities_radar_fila(integer) to authenticated, service_role;

/* ------------------------------------------------------------------ painel */

-- O painel passa a ordenar pelo preço COMPARÁVEL: unitário quando existe, total
-- quando não. Sem isto, o alvo de café elegeria como "melhor" o pacote de 250 g,
-- que é o mais barato da lista e o mais caro por quilo.
drop function if exists public.facilities_radar_painel();

create function public.facilities_radar_painel()
returns table (
  alvo                jsonb,
  alertas_novos       integer,
  ofertas_ativas      integer,
  melhor              jsonb,
  economia_aberta     numeric,
  economia_realizada  numeric,
  pontos_historico    integer,
  menor_fora_do_teto  numeric
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
    -- `is distinct from false`: estoque desconhecido é o caso normal de quem
    -- ainda não foi conferido. Só o "não" apurado exclui.
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false
       order by coalesce(o.preco_unitario, o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada,
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico,
    (select round(min(coalesce(o3.preco_unitario, o3.preco_total, o3.preco)), 2)
       from facilities_radar_ofertas o3
      where o3.alvo_id = a.id and o3.ativo and not o3.dentro_do_teto
        and o3.disponivel is distinct from false) as menor_fora_do_teto
  from facilities_radar_alvos a
  order by a.ativo desc, a.favorito desc, a.created_at desc;
$$;

revoke all on function public.facilities_radar_painel() from anon, public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;

/* --------------------------------------------------------- default velho */

-- A coluna nascia com `mercado_livre` e `amazon`, duas fontes que bloqueiam
-- robô — medido em 26/08/2026. O diálogo já não as oferece, mas qualquer
-- inserção que não passe `fontes` nascia com metade das fontes mortas.
alter table public.facilities_radar_alvos
  alter column fontes set default array['kabum','terabyte','zoom','buscape']::text[];
