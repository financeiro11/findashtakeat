-- O 👎 NUM ANÚNCIO PASSA A TIRÁ-LO DE CENA.
--
-- Até aqui o voto era "puramente aditivo" (migração de 03/09/2026): gravava, e
-- só virava filtro quando a MARCA acumulava três recusas e a pessoa confirmava.
-- A cautela é certa para a marca — generalizar de três casos pode ser
-- coincidência — e errada para o anúncio: quem olhou a foto e disse "não" já
-- decidiu sobre AQUELE produto. Continuar mostrando o anúncio recusado na
-- tabela, como "Melhor agora" no card e como achado a confirmar (gastando
-- crédito de raspagem e, depois, mandando WhatsApp) é pedir a mesma decisão
-- de novo a cada rodada.
--
-- A regra da marca NÃO muda: ela continua precisando de confirmação.
--
-- DUAS METADES, e as duas são reversíveis (clicar de novo no 👎 desfaz):
--   1. O painel ignora o anúncio recusado ao escolher o melhor, contar o que
--      cabe no teto e achar o menor fora dele. É filtro de leitura — desfazer
--      o voto devolve o anúncio sem ninguém precisar regravar nada.
--   2. Os achados abertos daquele anúncio viram `descartado` (a Edge Function,
--      action classificar). O status de antes fica em `status_antes_do_voto`,
--      e é de lá que o desfazer o devolve — sem essa coluna, desfazer o voto
--      deixaria o achado morto e o índice único (alvo, oferta, preço)
--      impediria a varredura de recriá-lo.

alter table public.facilities_radar_alertas
  add column if not exists status_antes_do_voto text;

comment on column public.facilities_radar_alertas.status_antes_do_voto is
  'Preenchido quando um 👎 no anúncio descartou este achado: guarda o status que ele tinha (a_confirmar | novo | visto) para o desfazer do voto devolver. Null em qualquer outro descarte.';

-- A leitura "este anúncio foi recusado?" roda por anúncio dentro do painel.
create index if not exists idx_radar_feedback_recusa
  on public.facilities_radar_feedback (oferta_id)
  where sinal = 'nao_gostei';

comment on table public.facilities_radar_feedback is
  '👍/👎 por anúncio, por alvo. 👎 tira AQUELE anúncio (e as cópias dele noutras lojas) da tabela, do painel e dos achados — ver a migração de 17/09/2026. A MARCA só vira filtro depois de 3+ 👎 e da confirmação da pessoa: a Edge Function facilities-radar (action classificar) devolve uma `proposta`, e a confirmação escreve em facilities_radar_alvos.specs.termos_proibidos.';

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
    -- ainda não foi conferido — e, em alvo de vigia, é o caso de TODOS, porque
    -- vigia não confere. A tela avisa que o número não passou pela conferência.
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false
         and not exists (select 1 from facilities_radar_feedback f
                          where f.oferta_id = o.id and f.sinal = 'nao_gostei')) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo and o.dentro_do_teto
         and o.disponivel is distinct from false
         and not exists (select 1 from facilities_radar_feedback f
                          where f.oferta_id = o.id and f.sinal = 'nao_gostei')
       order by coalesce(o.preco_unitario, o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada,
    -- A CURVA NÃO FILTRA O VOTO. O preço do anúncio recusado continua sendo
    -- preço de mercado; o 👎 diz "não compro este", não "este preço não existiu".
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico,
    (select round(min(coalesce(o3.preco_unitario, o3.preco_total, o3.preco)), 2)
       from facilities_radar_ofertas o3
      where o3.alvo_id = a.id and o3.ativo and not o3.dentro_do_teto
        and o3.disponivel is distinct from false
        and not exists (select 1 from facilities_radar_feedback f
                         where f.oferta_id = o3.id and f.sinal = 'nao_gostei')) as menor_fora_do_teto
  from facilities_radar_alvos a
  left join facilities_radar_alvos p on p.id = a.pai_id
  order by
    coalesce(p.ativo, a.ativo) desc,
    coalesce(p.favorito, a.favorito) desc,
    coalesce(p.created_at, a.created_at) desc,
    (a.pai_id is not null),
    a.created_at desc;
$$;

revoke all on function public.facilities_radar_painel() from anon, public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;
