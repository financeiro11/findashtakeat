-- Radar: a pessoa diz "estes anúncios são o mesmo produto".
--
-- O PROBLEMA. A tabela do alvo já agrupa anúncios de título igual (o mesmo
-- notebook pelo Buscapé, Bondfaro e Zoom vira uma linha — `agruparIguais` em
-- _shared/radar-precos.ts). Só que cada comparador corta o título num ponto
-- diferente, e juntar por semelhança deixaria um título curto engolir modelos
-- distintos. Quem olha a foto sabe na hora; a regra, não.
--
-- A DECISÃO (17/09/2026): junção MANUAL, e não IA a cada varredura. É decisão
-- de quem compra, não gasta crédito e não soma trabalho a uma função que já
-- roda perto do relógio do worker.
--
-- POR TÍTULO, E NÃO POR `oferta_id`. A mesma loja volta a cada varredura com o
-- mesmo título; guardar o título faz a junção valer para as rodadas seguintes
-- sem ninguém repetir o clique. A comparação é sempre por `norm(titulo)` — a
-- coluna guarda o título cru, e cada lado (tela e Edge Function) normaliza com a
-- MESMA função do _shared.
--
-- `grupo` é um uuid qualquer: todas as linhas com o mesmo valor, no mesmo alvo,
-- são um produto só. Separar = apagar a linha daquele título.

create table if not exists public.facilities_radar_iguais (
  id          bigserial primary key,
  alvo_id     uuid not null references public.facilities_radar_alvos(id) on delete cascade,
  titulo      text not null,
  grupo       uuid not null,
  criado_por  text,
  created_at  timestamptz not null default now(),
  unique (alvo_id, titulo)
);

comment on table public.facilities_radar_iguais is
  'Anúncios que a pessoa juntou como o mesmo produto, por alvo. Linhas com o mesmo `grupo` são um produto só; compara-se por norm(titulo). Lida pela tela do Radar (agrupamento) e pela action classificar da facilities-radar (o 👎 derruba o grupo). Ver a migração de 17/09/2026.';

create index if not exists idx_radar_iguais_grupo
  on public.facilities_radar_iguais (alvo_id, grupo);

alter table public.facilities_radar_iguais enable row level security;

-- Mesmo padrão das outras tabelas do módulo: quem está logado enxerga o
-- Facilities inteiro (a rota é que passa pelo PORTÃO).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_iguais' and policyname='fac_radar_iguais_all') then
    create policy fac_radar_iguais_all on public.facilities_radar_iguais for all to authenticated using (true) with check (true);
  end if;
end $$;

revoke all on public.facilities_radar_iguais from anon, public;
grant select, insert, update, delete on public.facilities_radar_iguais to authenticated;
grant usage, select on sequence public.facilities_radar_iguais_id_seq to authenticated;
