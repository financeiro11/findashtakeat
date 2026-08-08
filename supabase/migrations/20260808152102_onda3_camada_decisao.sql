-- ============================================================
-- ONDA 3 - CAMADA DE DECISAO
-- Hub FinOps / Takeat - migration: onda3_camada_decisao
-- Pre-requisito: Ondas 1 e 2 aplicadas.
-- ============================================================

-- ---------- 3.1 regras_decisao: unifica de_para_rules + reclassificacoes_regras ----------
create table if not exists public.regras_decisao (
  id                uuid primary key default gen_random_uuid(),
  escopo            text not null check (escopo in
                      ('categorizacao','conciliacao','validacao_nf','rateio','reembolso')),
  nome              text not null,
  descricao         text,
  -- a quem se aplica
  fornecedor_id     uuid references public.lib_fornecedores(id),
  -- logica da regra, em formato consultavel
  condicao          jsonb not null default '{}'::jsonb,
  acao              jsonb not null default '{}'::jsonb,
  -- governanca de alcada
  confianca_minima  numeric(5,4) not null default 0.90
                      check (confianca_minima >= 0 and confianca_minima <= 1),
  alcada_resultante text not null default 'amarelo'
                      check (alcada_resultante in ('verde','amarelo','vermelho')),
  prioridade        integer not null default 100,
  -- proveniencia e versionamento
  origem            text not null default 'manual'
                      check (origem in ('manual','aprendida','migrada')),
  versao            integer not null default 1,
  ativa             boolean not null default true,
  -- medicao: base para promover de amarelo para verde
  n_aplicacoes      integer not null default 0,
  n_corrigidas      integer not null default 0,
  acerto            numeric(5,4) generated always as (
                      case when n_aplicacoes = 0 then null
                           else round((n_aplicacoes - n_corrigidas)::numeric
                                      / n_aplicacoes, 4) end
                    ) stored,
  criada_por        uuid references public.lib_colaboradores(id),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists regras_decisao_escopo_idx on public.regras_decisao (escopo) where ativa;
create index if not exists regras_decisao_forn_idx   on public.regras_decisao (fornecedor_id);
create index if not exists regras_decisao_prio_idx   on public.regras_decisao (prioridade, escopo);
create index if not exists regras_decisao_cond_gin   on public.regras_decisao using gin (condicao);

comment on table public.regras_decisao is
  'Regra unica de decisao para todos os agentes. Substitui de_para_rules e omie_reclassificacoes_regras.';
comment on column public.regras_decisao.condicao is
  'Ex: {"keyword":"UBER","documento_norm":"12345678000199","valor_max":500}';
comment on column public.regras_decisao.acao is
  'Ex: {"categoria_codigo":"3.01.02","centro_custo":"COM","departamento":"Comercial"}';
comment on column public.regras_decisao.acerto is
  'Calculado. Base objetiva para o Orquestrador propor promocao de alcada.';

alter table public.regras_decisao enable row level security;
drop policy if exists "auth all regras_decisao" on public.regras_decisao;
create policy "auth all regras_decisao" on public.regras_decisao
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_regras_decisao_upd on public.regras_decisao;
create trigger trg_regras_decisao_upd before update on public.regras_decisao
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 3.2 omie_reclassificacoes: registrar o desfecho ----------
alter table public.omie_reclassificacoes
  add column if not exists rubrica_final text,
  add column if not exists decidido_por  uuid references public.lib_colaboradores(id),
  add column if not exists decidido_em   timestamptz,
  add column if not exists virou_regra   boolean not null default false,
  add column if not exists regra_id      uuid references public.regras_decisao(id);

create index if not exists omie_reclass_regra_idx on public.omie_reclassificacoes (regra_id);
create index if not exists omie_reclass_pend_idx
  on public.omie_reclassificacoes (detectado_em) where rubrica_final is null;

comment on column public.omie_reclassificacoes.rubrica_final is
  'Para onde a rubrica foi de fato apos a decisao humana. Sem isto a linha nao serve de treino.';
comment on column public.omie_reclassificacoes.virou_regra is
  'Marca os casos ja convertidos em regras_decisao, evitando retrabalho.';


-- ---------- 3.3 lib_politicas: parte estruturada ----------
alter table public.lib_politicas
  add column if not exists regras        jsonb not null default '{}'::jsonb,
  add column if not exists versao        integer not null default 1,
  add column if not exists vigente_desde date,
  add column if not exists mantenedor_id uuid references public.lib_colaboradores(id),
  add column if not exists atualizado_em timestamptz not null default now();

create index if not exists lib_politicas_regras_gin on public.lib_politicas using gin (regras);

comment on column public.lib_politicas.regras is
  'Parametros consultaveis pelo agente. Ex: {"limite_reembolso_sem_aprovacao":150.00, "prazo_prestacao_contas_dias":7, "exige_nf_acima_de":0}. O campo conteudo segue para leitura humana.';
comment on column public.lib_politicas.atualizado_em is
  'Carimbo do dominio de agentes. Convive com updated_at (mantido por trg_lib_politicas_updated).';

drop trigger if exists trg_lib_politicas_upd on public.lib_politicas;
create trigger trg_lib_politicas_upd before update on public.lib_politicas
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 3.4 calendario_financeiro ----------
create table if not exists public.calendario_financeiro (
  id                uuid primary key default gen_random_uuid(),
  evento            text not null,
  descricao         text,
  regra_data        text not null check (regra_data in
                      ('dia_fixo','dia_util','ultimo_dia','ultimo_dia_util')),
  dia               integer check (dia >= 1 and dia <= 31),
  antecedencia_dias integer not null default 0,
  responsavel_id    uuid references public.lib_colaboradores(id),
  agente_dono       text check (agente_dono in
                      ('thetys','fechamento','fpa','edi','orquestrador','humano')),
  automacao_id      uuid references public.automacoes_catalogo(id),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists calendario_ativo_idx on public.calendario_financeiro (ativo, dia);

comment on table public.calendario_financeiro is
  'Datas do ciclo financeiro. Centraliza o que hoje esta hardcoded nas automacoes 5, 13, 18 e 23.';

alter table public.calendario_financeiro enable row level security;
drop policy if exists "auth all calendario_financeiro" on public.calendario_financeiro;
create policy "auth all calendario_financeiro" on public.calendario_financeiro
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_calendario_upd on public.calendario_financeiro;
create trigger trg_calendario_upd before update on public.calendario_financeiro
  for each row execute function public.tg_set_atualizado_em();;
