-- ============================================================
-- ONDA 4 - OBSERVABILIDADE DOS AGENTES
-- Hub FinOps / Takeat - migration: onda4_observabilidade_agentes
-- Pre-requisito: Ondas 1 a 3 aplicadas.
-- ============================================================

-- ---------- 4.1 agentes ----------
create table if not exists public.agentes (
  id            text primary key,
  nome          text not null,
  descricao     text,
  automacao_id  uuid references public.automacoes_catalogo(id),
  alcada_maxima text not null default 'amarelo'
                  check (alcada_maxima in ('verde','amarelo','vermelho')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.agentes is
  'Registro dos agentes. O id e textual e estavel: thetys, fechamento, fpa, edi, orquestrador.';
comment on column public.agentes.alcada_maxima is
  'Teto global do agente. Sobrepoe a alcada da regra: regra verde em agente amarelo executa como amarelo.';


-- ---------- 4.2 agente_execucoes ----------
create table if not exists public.agente_execucoes (
  id                   uuid primary key default gen_random_uuid(),
  agente_id            text not null references public.agentes(id),
  tarefa               text not null,
  -- o que foi tocado
  entidade             text,
  entidade_id          text,
  regra_id             uuid references public.regras_decisao(id),
  -- o que entrou e o que saiu
  entrada              jsonb,
  saida                jsonb,
  confianca            numeric(5,4) check (confianca >= 0 and confianca <= 1),
  alcada               text check (alcada in ('verde','amarelo','vermelho')),
  resultado            text not null check (resultado in
                         ('executado','proposto','escalado','falhou')),
  -- feedback humano: e daqui que sai o aprendizado
  corrigido_por_humano boolean not null default false,
  correcao             jsonb,
  corrigido_por        uuid references public.lib_colaboradores(id),
  corrigido_em         timestamptz,
  -- diagnostico
  latencia_ms          integer,
  erro                 text,
  executado_em         timestamptz not null default now()
);

create index if not exists agente_exec_agente_idx    on public.agente_execucoes (agente_id, executado_em desc);
create index if not exists agente_exec_resultado_idx on public.agente_execucoes (resultado);
create index if not exists agente_exec_regra_idx     on public.agente_execucoes (regra_id);
create index if not exists agente_exec_correcao_idx
  on public.agente_execucoes (agente_id, executado_em) where corrigido_por_humano;

comment on table public.agente_execucoes is
  'Trilha completa. Uma linha por decisao. Base para medir acerto e para auditoria.';


-- ---------- 4.3 agente_excecoes ----------
create table if not exists public.agente_excecoes (
  id            uuid primary key default gen_random_uuid(),
  agente_id     text not null references public.agentes(id),
  execucao_id   uuid references public.agente_execucoes(id),
  tipo          text not null,
  titulo        text not null,
  descricao     text,
  severidade    text not null default 'media'
                  check (severidade in ('baixa','media','alta','critica')),
  valor         numeric(14,2),
  entidade      text,
  entidade_id   text,
  -- SLA
  sla_horas     integer not null default 24,
  vence_em      timestamptz,
  -- tratamento
  status        text not null default 'aberta'
                  check (status in ('aberta','em_analise','resolvida','descartada')),
  atribuido_a   uuid references public.lib_colaboradores(id),
  resolvido_por uuid references public.lib_colaboradores(id),
  resolvido_em  timestamptz,
  resolucao     text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists agente_exc_abertas_idx
  on public.agente_excecoes (vence_em) where status in ('aberta','em_analise');
create index if not exists agente_exc_agente_idx on public.agente_excecoes (agente_id, status);

-- vence_em nao pode ser coluna gerada: soma de timestamptz com interval
-- depende do fuso e nao e IMMUTABLE. Trigger resolve.
-- Ajuste vs documento: "set search_path = public", convencao do Hub.
create or replace function public.tg_set_vence_em()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.vence_em is null then
    new.vence_em = coalesce(new.criado_em, now())
                 + make_interval(hours => coalesce(new.sla_horas, 24));
  end if;
  return new;
end $$;

drop trigger if exists trg_agente_excecoes_sla on public.agente_excecoes;
create trigger trg_agente_excecoes_sla before insert on public.agente_excecoes
  for each row execute function public.tg_set_vence_em();

comment on table public.agente_excecoes is
  'Fila do humano. Tudo que o agente nao pode ou nao deve decidir sozinho cai aqui, com prazo.';


-- ---------- 4.4 RLS e triggers ----------
alter table public.agentes          enable row level security;
alter table public.agente_execucoes enable row level security;
alter table public.agente_excecoes  enable row level security;

drop policy if exists "auth all agentes" on public.agentes;
create policy "auth all agentes" on public.agentes
  for all to authenticated using (true) with check (true);

drop policy if exists "auth read agente_execucoes" on public.agente_execucoes;
create policy "auth read agente_execucoes" on public.agente_execucoes
  for select to authenticated using (true);
drop policy if exists "auth write agente_execucoes" on public.agente_execucoes;
create policy "auth write agente_execucoes" on public.agente_execucoes
  for insert to authenticated with check (true);

drop policy if exists "auth all agente_excecoes" on public.agente_excecoes;
create policy "auth all agente_excecoes" on public.agente_excecoes
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_agentes_upd on public.agentes;
create trigger trg_agentes_upd before update on public.agentes
  for each row execute function public.tg_set_atualizado_em();

drop trigger if exists trg_agente_excecoes_upd on public.agente_excecoes;
create trigger trg_agente_excecoes_upd before update on public.agente_excecoes
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 4.5 Cadastro inicial dos agentes ----------
insert into public.agentes (id, nome, descricao, alcada_maxima, ativo) values
  ('thetys',       'Thetys - Tesouraria e CAP',   'Operacional: triagem, lancamento, conciliacao e ciclo documental.', 'amarelo', true),
  ('fechamento',   'Agente de Fechamento Mensal', 'Revisao de lancamentos, estornos, CAC e comentarios do tracker.',   'amarelo', false),
  ('fpa',          'Agente de FP&A',              'DRE/DFC vs orcado, projecao de caixa, cenarios e alertas.',         'amarelo', false),
  ('edi',          'Edi - Agente de Editais',     'Radar, score de match, documentacao e prestacao de contas.',        'amarelo', false),
  ('orquestrador', 'Orquestrador',                'Julgamento, fila de excecoes, medicao e proposta de melhoria.',     'amarelo', false)
on conflict (id) do nothing;


-- ---------- 4.6 View de saude para o Orquestrador ----------
create or replace view public.vw_agente_saude
with (security_invoker = on) as
select
  a.id   as agente_id,
  a.nome,
  a.ativo,
  count(e.id) filter (where e.executado_em > now() - interval '30 days')          as execucoes_30d,
  count(e.id) filter (where e.corrigido_por_humano
                        and e.executado_em > now() - interval '30 days')          as corrigidas_30d,
  count(e.id) filter (where e.resultado = 'falhou'
                        and e.executado_em > now() - interval '30 days')          as falhas_30d,
  max(e.executado_em)                                                             as ultima_execucao,
  (select count(*) from public.agente_excecoes x
    where x.agente_id = a.id and x.status in ('aberta','em_analise'))             as excecoes_abertas,
  (select count(*) from public.agente_excecoes x
    where x.agente_id = a.id and x.status in ('aberta','em_analise')
      and x.vence_em < now())                                                     as excecoes_vencidas
from public.agentes a
left join public.agente_execucoes e on e.agente_id = a.id
group by a.id, a.nome, a.ativo;

comment on view public.vw_agente_saude is
  'Leitura do Orquestrador. ultima_execucao antiga = agente parado sem avisar (falha silenciosa).';;
