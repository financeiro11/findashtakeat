-- Radar: parar de pagar três vezes pelo mesmo anúncio, e escolher fonte pelo que
-- ela rende.
--
-- OS GÊMEOS. Buscapé, Zoom e Bondfaro são a mesma empresa e listam a MESMA
-- oferta — o código já sabia disso para não repetir aviso e para não deixar
-- fantasma na tela (`irmasDaMesmaOferta`), mas continuava pagando três raspagens
-- por rodada para ler o mesmo estoque. Medido em 27/08/2026:
--
--     fonte        anúncios   dentro do teto   úteis
--     kabum            17           9            9
--     carrefour        15           4            4
--     americanas       13           4            3
--     bondfaro          9           4            3   ┐
--     zoom              9           4            3   ├ mesma empresa, mesmas ofertas
--     buscape           8           3            3   ┘
--     casasbahia       16           1            1
--     terabyte          4           0            0
--     pichau            2           0            0
--
-- Três créditos por rodada, por alvo, para trazer as mesmas três ofertas. Com
-- seis rodadas diárias e dois alvos, são ~24 créditos/dia — perto de 700 por mês
-- gastos em duplicata. A partir daqui só UM representante da família entra por
-- rodada, e ele gira: se o Zoom estiver fora do ar hoje, amanhã é a vez do
-- Buscapé, e a cobertura continua.
--
-- E A ORDEM DAS FONTES PASSA A SER MEDIDA. A lista de prioridades foi escrita à
-- mão em 26/08 com a medição daquele dia, e um dia depois já estava errada: a
-- Casas Bahia trazia 16 anúncios e 1 aproveitável, enquanto o Carrefour — que
-- estava no rodízio, entrando de vez em quando — trazia 4. Prioridade escrita à
-- mão envelhece calada; esta função deixa o número falar.
--
-- O QUE É "ÚTIL": anúncio que entrou no teto do alvo e não foi desmentido pela
-- conferência. Contar anúncio bruto premiaria a vitrine cheia de acessório, que
-- é exatamente o que o radar recusa depois.

create or replace function public.facilities_radar_rendimento(p_dias integer default 14)
returns table (
  fonte     text,
  anuncios  integer,
  uteis     integer,
  alertas   integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.fonte,
    count(*)::int as anuncios,
    count(*) filter (
      where o.dentro_do_teto and o.disponivel is distinct from false
    )::int as uteis,
    count(distinct al.id)::int as alertas
  from facilities_radar_ofertas o
  left join facilities_radar_alertas al on al.oferta_id = o.id
  where o.visto_em > now() - make_interval(days => greatest(coalesce(p_dias, 14), 1))
  group by o.fonte;
$$;

revoke all on function public.facilities_radar_rendimento(integer) from anon, public;
grant execute on function public.facilities_radar_rendimento(integer) to authenticated, service_role;

/* ==================================================== a fila não se repete */

-- INTERVALO MÍNIMO ENTRE DUAS VARREDURAS DO MESMO ALVO.
--
-- O agendamento tem seis chamadas por dia porque UMA chamada cobre no máximo
-- dois alvos (o worker morre aos 150s) — as chamadas `-b`, quatro minutos depois
-- das principais, existem para pegar quem não coube. Com três alvos isso dá
-- quatro varreduras por alvo, que foi a conta do plano.
--
-- Só que hoje há DOIS alvos ativos. Os dois cabem na primeira chamada, e a `-b`,
-- quatro minutos depois, encontra a fila inteira disponível de novo e varre os
-- mesmos dois — seis varreduras por alvo por dia em vez de quatro, ao custo de
-- seis fontes cada. O ritmo ficou 50% mais caro sem ninguém decidir isso: foi um
-- efeito colateral de ter menos alvos, que é o contrário do que se esperaria.
--
-- Meia hora resolve sem tirar nada do desenho: a chamada `-b` continua pegando
-- quem sobrou da principal (que aconteceu há 4 minutos) e para de repetir quem
-- já foi. Quando houver mais alvos, as `-b` voltam a trabalhar sozinhas — o
-- ajuste se desfaz sem que ninguém precise lembrar de mexer no cron.
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
    -- O piso, independente da cadência: nem o alvo de cadência 0 ("toda rodada")
    -- precisa ser varrido duas vezes em quatro minutos.
    and (a.ultima_varredura is null or a.ultima_varredura < now() - interval '30 minutes')
  order by a.favorito desc, a.ultima_varredura asc nulls first
  limit greatest(coalesce(p_limite, 20), 1);
$$;

revoke all on function public.facilities_radar_fila(integer) from anon, public;
grant execute on function public.facilities_radar_fila(integer) to authenticated, service_role;
