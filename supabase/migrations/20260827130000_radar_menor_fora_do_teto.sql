-- Painel: quanto custou o mais barato quando NADA coube no teto.
--
-- É a informação mais útil do primeiro dia de um alvo, e faltava. Quando o
-- Facilities cadastra "notebook i5 16GB até R$ 3.000" e o mercado começa em
-- R$ 3.869, a tela dizia apenas "nada dentro dos filtros" — que ele lê como
-- "o radar não achou", quando o certo é "o radar achou, e nenhum cabe no seu
-- teto". São diagnósticos opostos: o primeiro sugere defeito, o segundo sugere
-- rever o teto.
--
-- Agora que o anúncio bom-porém-caro é guardado (`dentro_do_teto = false`), o
-- número existe. Só faltava trazê-lo.

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
    (select count(distinct (pr.coletado_em at time zone 'America/Sao_Paulo')::date)::int
       from facilities_radar_precos pr
       join facilities_radar_ofertas o2 on o2.id = pr.oferta_id
      where o2.alvo_id = a.id) as pontos_historico,
    -- O mais barato entre os que NÃO couberam. Null quando algum coube — nesse
    -- caso a pergunta não se coloca.
    (select round(min(coalesce(o3.preco_total, o3.preco)), 2)
       from facilities_radar_ofertas o3
      where o3.alvo_id = a.id and o3.ativo and not o3.dentro_do_teto) as menor_fora_do_teto
  from facilities_radar_alvos a
  order by a.ativo desc, a.favorito desc, a.created_at desc;
$$;
