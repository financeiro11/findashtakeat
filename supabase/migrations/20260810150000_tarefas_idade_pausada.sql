-- Idade da tarefa sem contar o tempo em que ela ficou parada.
--
-- A coluna "Idade" em /tarefas era simplesmente `hoje - created_at`: um card estacionado
-- no Backlog ou no Acompanhamento envelhecia no mesmo ritmo de um card em andamento e
-- aparecia vermelho como se estivesse atrasado, quando na verdade ninguém devia estar
-- tocando nele. Agora o relógio pausa enquanto o card está numa coluna marcada como
-- "não conta idade", e volta a correr quando ele sai.
--
-- Quais colunas pausam é decisão do time, não de cada pessoa: por isso mora aqui no banco
-- (e não no localStorage, onde vivem ordem e cor das colunas do kanban). Assim todo mundo
-- vê o mesmo número e o gatilho abaixo consegue consultar a regra.

create table if not exists public.tarefas_colunas (
  nome text primary key,
  pausa_idade boolean not null default false,
  atualizado_em timestamptz not null default now()
);

comment on table public.tarefas_colunas is
  'Ajustes por coluna do kanban de Tarefas. Hoje só guarda quem pausa o relógio da idade; ordem e cor continuam no localStorage de cada usuário.';

insert into public.tarefas_colunas (nome, pausa_idade)
values ('Backlog', true), ('Acompanhamento', true)
on conflict (nome) do nothing;

alter table public.tarefas_colunas enable row level security;

drop policy if exists "tarefas_colunas_read" on public.tarefas_colunas;
create policy "tarefas_colunas_read" on public.tarefas_colunas
  for select to authenticated using (true);

-- Quem mexe no quadro mexe na regra: mesma permissão que já existe para mover card.
drop policy if exists "tarefas_colunas_write" on public.tarefas_colunas;
create policy "tarefas_colunas_write" on public.tarefas_colunas
  for all to authenticated using (true) with check (true);

alter table public.tarefas
  add column if not exists status_desde timestamptz,
  add column if not exists pausado_ms bigint not null default 0;

comment on column public.tarefas.status_desde is
  'Quando o card entrou no status atual. O trecho corrente ainda NÃO está em pausado_ms — quem lê soma na hora se a coluna atual pausa.';
comment on column public.tarefas.pausado_ms is
  'Milissegundos já fechados em colunas que não contam idade. O gatilho banca o trecho toda vez que o card sai de uma dessas colunas.';

-- O gatilho é a peça central: seja o card movido pelo desktop, pelo celular ou por outra
-- automação que escreva em `tarefas`, a conta da pausa sai igual — nenhuma tela precisa
-- lembrar de fazer a matemática.
create or replace function public.tarefas_contabiliza_pausa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status_desde := coalesce(new.status_desde, now());
    return new;
  end if;

  if new.status is distinct from old.status then
    -- Fecha o trecho que terminou agora: se a coluna de onde o card saiu não conta idade,
    -- esse tempo vira desconto permanente.
    if exists (
      select 1 from public.tarefas_colunas c
       where c.nome = old.status and c.pausa_idade
    ) then
      new.pausado_ms := coalesce(old.pausado_ms, 0)
        + greatest(0, (extract(epoch from (now() - coalesce(old.status_desde, old.created_at))) * 1000)::bigint);
    end if;
    new.status_desde := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tarefas_contabiliza_pausa on public.tarefas;
create trigger trg_tarefas_contabiliza_pausa
before insert or update on public.tarefas
for each row execute function public.tarefas_contabiliza_pausa();

-- Backfill: o passado é reconstruído do tarefas_log, que registra toda movimentação como
-- 'moveu de "X" para "Y"' desde 18/07/2026.
--
-- Duas aproximações, assumidas de propósito:
--   1. o status inicial do card é o "de" do primeiro movimento registrado (é o que ele diz:
--      o card estava lá até então). Para cards anteriores ao log isso estende o primeiro
--      trecho até a criação — é a melhor estimativa disponível;
--   2. card sem nenhum movimento registrado começa a contar do zero no status atual.
with mov as (
  select
    l.tarefa_id,
    l.created_at                                                     as em,
    substring(l.descricao from 'moveu de "([^"]+)" para "')          as de,
    substring(l.descricao from 'moveu de "[^"]+" para "([^"]+)"')    as para
  from public.tarefas_log l
  where l.tarefa_id is not null
    and l.descricao like 'moveu de %'
),
ordenado as (
  select
    tarefa_id, em, de, para,
    row_number() over (partition by tarefa_id order by em) as n,
    lead(em)    over (partition by tarefa_id order by em) as proximo
  from mov
  where de is not null and para is not null
),
trechos as (
  -- da criação até o primeiro movimento
  select o.tarefa_id, t.created_at as ini, o.em as fim, o.de as status
    from ordenado o
    join public.tarefas t on t.id = o.tarefa_id
   where o.n = 1
  union all
  -- de um movimento ao seguinte (o último trecho fica de fora: é o corrente, ainda aberto)
  select o.tarefa_id, o.em, o.proximo, o.para
    from ordenado o
   where o.proximo is not null
),
pausa as (
  select tr.tarefa_id,
         sum(greatest(0, (extract(epoch from (tr.fim - tr.ini)) * 1000)::bigint)) as ms
    from trechos tr
    join public.tarefas_colunas c on c.nome = tr.status and c.pausa_idade
   group by tr.tarefa_id
),
ultimo as (
  select distinct on (tarefa_id) tarefa_id, em
    from ordenado
   order by tarefa_id, em desc
)
update public.tarefas t
   set pausado_ms   = coalesce(p.ms, 0),
       status_desde = coalesce(u.em, base.created_at)
  from public.tarefas base
  left join pausa  p on p.tarefa_id = base.id
  left join ultimo u on u.tarefa_id = base.id
 where t.id = base.id;
