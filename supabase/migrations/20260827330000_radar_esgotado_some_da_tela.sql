-- Radar: produto esgotado some da tela — e não volta na varredura seguinte.
--
-- O SINTOMA. Um Vivobook da Magalu apareceu no radar por R$ 2.969,10 com a
-- própria página do anúncio escrevendo PRODUTO INDISPONÍVEL. A conferência
-- tinha feito o trabalho dela: às 12h18 de 27/08/2026 marcou a oferta 155 como
-- `disponivel = false, ativo = false` e o alerta como `indisponivel`. Duas
-- horas depois a varredura das 14h15 desfez tudo — `ativo = true`,
-- `disponivel = null` — e o defunto voltou a ser o "melhor preço" do alvo.
--
-- POR QUE ACONTECE. A varredura lê a página de BUSCA, que continua listando o
-- produto esgotado com o último preço praticado. Ela não tem como saber que
-- acabou, e o `upsert` dela escrevia `ativo: true` e `disponivel: o.disponivel
-- ?? null` sobre o que a conferência havia apurado. O "não sei" da busca
-- apagava o "não" de quem abriu a página. Todo dia.
--
-- O QUE MUDA, e é em três lugares:
--   1. a varredura respeita o esgotado recente (`DIAS_QUE_O_ESGOTADO_VALE`) e
--      não grava preço de defunto no histórico — a curva ancora o teto
--      sugerido no MENOR valor, e um morto barato repetido puxaria o teto para
--      baixo para sempre;
--   2. a confirmação passa a RECONFERIR o que já está na tela a cada 24h — sem
--      isso, conferir na entrada só garante que o achado era verdade no dia em
--      que subiu;
--   3. aqui: o painel nunca escolhe como "melhor" uma oferta sabidamente
--      esgotada, mesmo que alguma outra coisa a deixe `ativo` por engano. É
--      cinto além do suspensório, e de propósito: este é o lugar da tela em que
--      o erro apareceu.

/* ------------------------------------------------- 1. o estrago já gravado */

-- As ofertas que a conferência matou e a varredura ressuscitou. O critério é
-- estreito: só as que têm alerta `indisponivel` e NENHUM alerta vivo — se
-- houver um `novo`/`visto`/`virou_cotacao`, alguma conferência posterior disse
-- que o produto está de pé, e essa é a informação mais recente.
update public.facilities_radar_ofertas o
   set ativo = false,
       disponivel = false
 where exists (
         select 1 from public.facilities_radar_alertas a
          where a.oferta_id = o.id and a.status = 'indisponivel')
   and not exists (
         select 1 from public.facilities_radar_alertas a
          where a.oferta_id = o.id and a.status in ('novo','visto','virou_cotacao'))
   and (o.ativo or o.disponivel is distinct from false);

-- E AS GÊMEAS. Zoom, Buscapé e Bondfaro são a mesma empresa e listam a MESMA
-- oferta: a 155 e a 156 deste alvo carregam o mesmo `oid=1578116400` no link do
-- lead, mesmo título e mesmo R$ 2.969,10. Conferiu-se a do Zoom, que morreu; a
-- do Bondfaro seguiu viva e assumiu o posto de "melhor preço" do alvo — o mesmo
-- notebook esgotado, agora por outra porta. Daqui para a frente a conferência
-- propaga sozinha (`irmasDaMesmaOferta`); aqui é o que já estava gravado.
update public.facilities_radar_ofertas x
   set ativo = false,
       disponivel = false,
       confirmado_em = coalesce(x.confirmado_em, m.confirmado_em, now())
  from public.facilities_radar_ofertas m
 where m.alvo_id = x.alvo_id
   and m.id <> x.id
   and m.disponivel is false
   and x.disponivel is distinct from false
   and (
        -- mesmo lead do agregador: é literalmente a mesma oferta
        (substring(m.url from '[?&]oid=([0-9]+)') is not null
         and substring(m.url from '[?&]oid=([0-9]+)') = substring(x.url from '[?&]oid=([0-9]+)'))
        -- ou mesmo título e mesmo total: o anúncio replicado de sempre
     or (x.titulo = m.titulo
         and round(coalesce(x.preco_total, x.preco)) = round(coalesce(m.preco_total, m.preco)))
   );

-- E os preços fantasmas: as linhas coletadas DEPOIS de a conferência dizer que
-- o anúncio acabou. Não são preço de mercado — são o último preço praticado,
-- que a vitrine da loja repete indefinidamente. Ficam de fora da curva porque
-- é a curva que responde "esse preço é bom?".
delete from public.facilities_radar_precos pr
 using public.facilities_radar_ofertas o
 where o.id = pr.oferta_id
   and o.disponivel is false
   and o.confirmado_em is not null
   and pr.coletado_em > o.confirmado_em;

/* ------------------------------------------------------ 2. painel honesto */

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
    -- `is distinct from false` e não `is true`: estoque desconhecido (null) é o
    -- caso normal de quem ainda não foi conferido, e some da conta se o teste
    -- for pela positiva. Só o "não" apurado exclui.
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false
       order by coalesce(o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada,
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico,
    -- O mais barato entre os que NÃO couberam. Null quando algum coube — nesse
    -- caso a pergunta não se coloca.
    (select round(min(coalesce(o3.preco_total, o3.preco)), 2)
       from facilities_radar_ofertas o3
      where o3.alvo_id = a.id and o3.ativo and not o3.dentro_do_teto
        and o3.disponivel is distinct from false) as menor_fora_do_teto
  from facilities_radar_alvos a
  order by a.ativo desc, a.favorito desc, a.created_at desc;
$$;

/* O GRANT AUTOMÁTICO DO SUPABASE, de novo. Função recriada nasce chamável por
   quem não deveria — ora via PUBLIC (`=X/postgres`), ora nominalmente a `anon`.
   Por isso o revoke nomeia os dois E vai numa instrução separada do `create`:
   no mesmo bloco, o gatilho que concede roda depois e desfaz o revoke. */
revoke all on function public.facilities_radar_painel() from anon, public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;

comment on column public.facilities_radar_ofertas.disponivel is
  'true/false apurados ABRINDO o anúncio; null = ninguém conferiu. A varredura, que lê a página de busca, nunca apaga um false recente — a vitrine continua listando o esgotado com o último preço.';
