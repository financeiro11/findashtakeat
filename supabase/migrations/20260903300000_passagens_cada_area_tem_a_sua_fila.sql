-- Passagens: cada área tem a sua fila.
--
-- POR QUE ISTO NASCE JUNTO COM A FILA DE DECISÕES, e não depois. O painel vai
-- deixar de ser uma lista de viagens e virar um "o que resolver hoje". Uma fila
-- que mistura viagem administrativa com viagem de evento não é fila de ninguém:
-- o comprador do Facilities passa os olhos por pendência que não é dele, o
-- analista de eventos idem, e os dois aprendem a ignorar a lista — que é
-- exatamente o modo como esta tela morreria.
--
-- DUAS PESSOAS, DOIS FLUXOS, MESMO MOTOR (informado em 03/09/2026): o Facilities
-- compra a viagem administrativa; o analista de eventos compra as passagens dos
-- eventos, e viaja muito mais. O teto, a curva, o alerta do Google e o sino são
-- idênticos nos dois casos — o que muda é de quem é a fila.
--
-- É CLASSIFICAÇÃO, NÃO PERMISSÃO. Todo mundo continua enxergando tudo: a RLS
-- deste Hub é `to authenticated using (true)` em todas as tabelas, e furar esse
-- padrão só aqui criaria uma exceção que ninguém lembraria de manter. A área
-- serve para FOCAR (filtro que a tela lembra por pessoa), não para esconder —
-- e cobrir a viagem do colega quando ele estiver de férias continua sendo um
-- clique, não um pedido de acesso.
--
-- TABELA E NÃO `check`, pelo mesmo motivo do `sinal_serie`: acrescentar uma área
-- ("Comercial", "Diretoria") tem de ser um insert, não uma migração com deploy
-- atrás. Se virar obra, o motor está errado.

create table if not exists public.passagens_areas (
  chave      text primary key,
  nome       text not null,
  -- Ordem na lista de escolha; empate desempata por nome.
  ordem      integer not null default 100,
  ativa      boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.passagens_areas is
  'As áreas que compram passagem (administrativo, eventos, …). Classificação para focar a fila de decisões — NÃO é permissão: a RLS continua deixando todo mundo ver tudo. Acrescentar área é insert aqui.';

insert into public.passagens_areas (chave, nome, ordem) values
  ('administrativo', 'Administrativo', 10),
  ('eventos',        'Eventos',        20)
on conflict (chave) do update set nome = excluded.nome, ordem = excluded.ordem, ativa = true;

alter table public.passagens_viagens
  -- NULL de propósito, e não um default: as viagens que já existem foram
  -- cadastradas antes de a área existir, e carimbá-las de "administrativo" seria
  -- inventar uma classificação que ninguém deu. A tela mostra "sem área" e
  -- pede — que é honesto e leva um clique.
  -- `on delete set null`: desativar uma área não pode apagar viagem nenhuma.
  add column if not exists area text references public.passagens_areas(chave) on delete set null;

create index if not exists idx_passagens_viagens_area
  on public.passagens_viagens (area, status, data_ida);

comment on column public.passagens_viagens.area is
  'Quem compra esta viagem (passagens_areas). Null = ainda não classificada. Filtra a fila de decisões; não restringe acesso.';

revoke all on public.passagens_areas from anon, public;
grant select, insert, update, delete on public.passagens_areas to authenticated;

alter table public.passagens_areas enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='passagens_areas' and policyname='passagens_areas_all') then
    create policy passagens_areas_all on public.passagens_areas for all to authenticated using (true) with check (true);
  end if;
end $$;
