-- Radar: o KIT — o conjunto que se compra junto tem preço e curva próprios.
--
-- A PERGUNTA QUE NÃO TINHA ONDE MORAR. O radar responde "o monitor está caro?"
-- quatro vezes, uma por alvo. Mas ninguém compra um monitor: compra-se uma
-- ESTAÇÃO — monitor, notebook, mouse e headset —, e a pergunta do Facilities na
-- hora de aprovar a contratação de alguém é "quanto custa montar uma estação
-- hoje, e isso subiu?". Somar quatro cards à mão dá o número de hoje e não dá a
-- curva, que é justamente a parte que decide se vale esperar ou comprar agora.
--
-- POR QUE UMA TABELA E NÃO UM RÓTULO. `categoria` já agrupa (os quatro são 'TI')
-- e não serve: agrupar não soma. O kit precisa de QUANTIDADE — a estação de um
-- desenvolvedor leva dois monitores e a de um vendedor leva um, e é o mesmo alvo
-- de monitor nas duas. Um campo de texto no alvo não expressa isso, e obrigaria
-- a duplicar o alvo (e a curva) por composição de kit.
--
-- `pai_id` também não serve, e é bom dizer por quê, porque a forma engana: pai é
-- faixa → modelo adotado ("o MX Master é um modelo de Mouse Padrão"), um eixo de
-- ESPECIFICIDADE. O kit é um eixo de COMPOSIÇÃO. O mesmo mouse pode ser modelo
-- de uma faixa e item de três kits.

/* ================================================================== tabelas */

create table if not exists public.facilities_radar_kits (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.facilities_radar_kits is
  'Conjunto de alvos do radar comprados juntos (ex.: kit de onboarding). Existe para somar preço e curva de uma composição — ver facilities_radar_kits_painel e _kit_curva.';

create table if not exists public.facilities_radar_kit_itens (
  kit_id      uuid not null references public.facilities_radar_kits(id) on delete cascade,
  -- `cascade` aqui é correto (ao contrário de `alvos.pai_id`): o item não guarda
  -- histórico nenhum, é só a linha "este kit leva N destes". Apagar o alvo tira
  -- ele do kit e não perde curva, que mora em facilities_radar_precos.
  alvo_id     uuid not null references public.facilities_radar_alvos(id) on delete cascade,
  quantidade  integer not null default 1 check (quantidade > 0),
  primary key (kit_id, alvo_id)
);

comment on column public.facilities_radar_kit_itens.quantidade is
  'Quantas unidades deste alvo entram numa unidade do kit. É a razão de o kit ser tabela e não rótulo: a estação de dev leva 2 monitores e a de vendas leva 1, com o mesmo alvo.';

/* ====================================================================== RLS */

alter table public.facilities_radar_kits      enable row level security;
alter table public.facilities_radar_kit_itens enable row level security;

-- Mesmo padrão das outras tabelas do módulo (fac_radar_alvos_all…): app interno,
-- quem está logado enxerga o Facilities inteiro.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_kits' and policyname='fac_radar_kits_all') then
    create policy fac_radar_kits_all on public.facilities_radar_kits for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_kit_itens' and policyname='fac_radar_kit_itens_all') then
    create policy fac_radar_kit_itens_all on public.facilities_radar_kit_itens for all to authenticated using (true) with check (true);
  end if;
end $$;

-- O `grant` para `anon` sai por padrão neste projeto e ninguém pediu: sem este
-- revoke, a tabela nasce legível por quem tem só a chave publicável.
revoke all on public.facilities_radar_kits      from anon;
revoke all on public.facilities_radar_kit_itens from anon;
grant select, insert, update, delete on public.facilities_radar_kits      to authenticated;
grant select, insert, update, delete on public.facilities_radar_kit_itens to authenticated;

/* =================================================================== painel */

-- Uma linha por kit, com a composição já resolvida. RPC e não select+join no
-- front pelo motivo de sempre: o menor preço de cada item sai de uma agregação
-- sobre `facilities_radar_ofertas`, e trazer as ofertas para somar no navegador
-- esbarraria no corte silencioso de 1000 linhas do PostgREST.
--
-- O NÚMERO DO KIT É A SOMA DO QUE ESTÁ ESCRITO NAS LINHAS, e isso obrigou a
-- copiar a regra do card em vez de inventar uma mais simples: o card mostra o
-- menor DENTRO do teto quando existe, e cai para o menor fora do teto quando
-- não existe nenhum dentro (senão a tela diria "nada" e a pessoa concluiria que
-- o radar quebrou, quando o que não alcança é o teto). Um total que não bate com
-- a soma visível na tela é pior que total nenhum — ninguém sabe qual dos dois
-- acreditar, e a resposta viraria "confere na mão", que é o trabalho que este
-- painel existe para acabar.
create or replace function public.facilities_radar_kits_painel()
returns table (
  kit          jsonb,
  itens        jsonb,
  total        numeric,
  teto_total   numeric,
  medidos      integer,
  itens_total  integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with item as (
    select
      ki.kit_id, ki.alvo_id, ki.quantidade,
      a.titulo, a.modo, a.categoria, a.preco_alvo, a.ultima_varredura, a.ativo as alvo_ativo,
      -- `is distinct from false`: estoque desconhecido é o caso normal de quem
      -- não foi conferido — e em vigia é o caso de TODOS, porque vigia não
      -- confere. `<> false` derrubaria os `null` junto e zeraria o kit.
      (select min(coalesce(o.preco_unitario, o.preco_total, o.preco))
         from facilities_radar_ofertas o
        where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
          and o.disponivel is distinct from false) as menor_no_teto,
      (select min(coalesce(o.preco_unitario, o.preco_total, o.preco))
         from facilities_radar_ofertas o
        where o.alvo_id = a.id and o.ativo
          and o.disponivel is distinct from false) as menor_qualquer
    from facilities_radar_kit_itens ki
    join facilities_radar_alvos a on a.id = ki.alvo_id
  ), resolvido as (
    select i.*, coalesce(i.menor_no_teto, i.menor_qualquer) as menor
    from item i
  )
  select
    to_jsonb(k)  as kit,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'alvo_id',          r.alvo_id,
          'titulo',           r.titulo,
          'quantidade',       r.quantidade,
          'modo',             r.modo,
          'categoria',        r.categoria,
          'alvo_ativo',       r.alvo_ativo,
          'teto',             r.preco_alvo,
          'menor',            r.menor,
          -- Estourou = apareceu preço, mas nenhum dentro do teto. Diferente de
          -- "sem preço", que é o item que o radar ainda não mediu: um pede
          -- decisão (rever o teto ou o produto), o outro pede paciência.
          'estourou',         r.menor_no_teto is null and r.menor_qualquer is not null,
          'ultima_varredura', r.ultima_varredura
        )
        order by r.titulo
      ) filter (where r.alvo_id is not null),
      '[]'::jsonb
    ) as itens,
    -- Soma só do que tem preço. `medidos` × `itens_total` ao lado é o que
    -- impede o número de mentir por omissão: um kit de quatro itens com três
    -- medidos mostra um total menor que o real, e a tela tem de poder dizer isso.
    coalesce(round(sum(r.menor * r.quantidade), 2), 0)          as total,
    coalesce(round(sum(r.preco_alvo * r.quantidade), 2), 0)     as teto_total,
    count(r.menor)::int                                         as medidos,
    count(r.alvo_id)::int                                       as itens_total
  from facilities_radar_kits k
  left join resolvido r on r.kit_id = k.id
  where k.ativo
  group by k.id
  order by k.created_at;
$$;

revoke all on function public.facilities_radar_kits_painel() from anon, public;
grant execute on function public.facilities_radar_kits_painel() to authenticated, service_role;

/* ==================================================================== curva */

-- A curva do kit: quanto custava montar a estação em cada dia medido.
--
-- O DIA INCOMPLETO NÃO VIRA PONTO, e esta é a decisão inteira desta função.
-- Somar o que houver naquele dia produziria uma curva que DESPENCA sempre que um
-- item ficou sem medição — e um kit de quatro itens em que faltou o notebook cai
-- uns 80%. Seria um gráfico dizendo "a estação ficou 80% mais barata" quando o
-- que houve foi uma fonte fora do ar. O erro é grave porque tem a forma exata da
-- notícia que se está procurando.
--
-- A saída é LOCF (last observation carried forward): em cada dia, cada item
-- entra com o último preço conhecido ATÉ aquele dia. É o certo para preço, que
-- é uma grandeza de estoque e não de fluxo — se ninguém mediu o mouse na
-- quarta, o preço dele na quarta é o de segunda, não zero. E, mesmo assim, o dia
-- só vira ponto quando TODOS os itens já têm ao menos uma medição: antes disso
-- não há kit para precificar, só parte dele.
--
-- Isso faz a curva começar no dia em que o ÚLTIMO item ganhou preço, e é o
-- comportamento honesto — um kit criado hoje com um alvo cadastrado hoje não tem
-- três meses de história só porque os outros três tinham.
create or replace function public.facilities_radar_kit_curva(p_kit_id uuid, p_dias integer default 180)
returns table (dia date, total numeric, itens integer)
language sql
stable
security invoker
set search_path = public
as $$
  with itens as (
    select ki.alvo_id, ki.quantidade
    from facilities_radar_kit_itens ki
    where ki.kit_id = p_kit_id
  ), pontos as (
    -- O menor comparável de cada alvo em cada dia. `pr.preco` já é o comparável
    -- (unitário onde faz sentido, total com frete no resto) e já exclui
    -- esgotado, que não entra na curva — ver o insert em `varrerAlvo`.
    select
      o.alvo_id,
      (pr.coletado_em at time zone 'America/Sao_Paulo')::date as dia,
      min(pr.preco) as menor
    from facilities_radar_precos pr
    join facilities_radar_ofertas o on o.id = pr.oferta_id
    join itens i on i.alvo_id = o.alvo_id
    group by 1, 2
  ), dias as (
    -- Só os dias dentro da janela; o LOCF abaixo continua podendo alcançar
    -- medição anterior a ela, que é o que faz o primeiro ponto da janela ser
    -- um preço de verdade e não uma lacuna.
    select distinct dia
    from pontos
    where dia >= (now() at time zone 'America/Sao_Paulo')::date - greatest(coalesce(p_dias, 180), 1)
  )
  select
    d.dia,
    round(sum(u.menor * i.quantidade), 2)::numeric as total,
    count(*)::int as itens
  from dias d
  cross join itens i
  -- O `cross join lateral` derruba a linha do item sem medição até aquele dia —
  -- é essa queda que o `having` abaixo transforma em "dia incompleto".
  cross join lateral (
    select p.menor
    from pontos p
    where p.alvo_id = i.alvo_id and p.dia <= d.dia
    order by p.dia desc
    limit 1
  ) u
  group by d.dia
  having count(*) = (select count(*) from itens)
  order by d.dia;
$$;

revoke all on function public.facilities_radar_kit_curva(uuid, integer) from anon, public;
grant execute on function public.facilities_radar_kit_curva(uuid, integer) to authenticated, service_role;

/* ================================================== o kit que já existe hoje */

-- Semeadura única do kit de onboarding com os quatro alvos que a operação já
-- trata como conjunto (informado em 03/09/2026). Casa por título exato e não por
-- id: os ids são deste banco, e a migração precisa poder rodar noutro que ainda
-- não os tenha — onde ela simplesmente não encontra e não semeia nada.
--
-- Só roda se não houver kit nenhum: a migração é um ponto de partida, não uma
-- opinião permanente sobre a composição. Quem mexer no kit pela tela depois não
-- pode ver a mudança desfeita numa reaplicação.
do $$
declare
  novo uuid;
begin
  if exists (select 1 from public.facilities_radar_kits) then return; end if;

  insert into public.facilities_radar_kits (nome, descricao)
  values ('Kit onboarding', 'A estação padrão de quem entra: uma unidade de cada.')
  returning id into novo;

  insert into public.facilities_radar_kit_itens (kit_id, alvo_id, quantidade)
  select novo, a.id, 1
  from public.facilities_radar_alvos a
  where a.titulo in ('Monitor Padrão', 'Notebook Padrão', 'Mouse Padrão', 'Headset Padrão')
  on conflict do nothing;

  -- Kit sem item é lixo silencioso: se nenhum título bateu, desfaz.
  if not exists (select 1 from public.facilities_radar_kit_itens where kit_id = novo) then
    delete from public.facilities_radar_kits where id = novo;
  end if;
end $$;
