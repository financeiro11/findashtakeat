-- ============================================================
-- ONDA 1 - IDENTIDADE DAS CONTRAPARTES
-- Hub FinOps / Takeat - migration: onda1_identidade_contrapartes
-- Idempotente. Nao apaga nada.
-- ============================================================

-- ---------- 1.0 Funcao de trigger compartilhada ----------
-- Ajuste vs documento: "set search_path = public", seguindo a convencao ja usada
-- por public.update_updated_at_column() no Hub. Evita novo alerta
-- function_search_path_mutable no advisor de seguranca.
create or replace function public.tg_set_atualizado_em()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

comment on function public.tg_set_atualizado_em() is
  'Mantem o carimbo atualizado_em. Usada pelas tabelas do dominio de agentes.';


-- ---------- 1.1 lib_centros_custo ----------
alter table public.lib_centros_custo
  add column if not exists departamento_id  uuid references public.lib_departamentos(id),
  add column if not exists omie_codigo      text,
  add column if not exists ativo            boolean not null default true,
  add column if not exists atualizado_em    timestamptz not null default now();

create unique index if not exists lib_centros_custo_codigo_uidx
  on public.lib_centros_custo (codigo) where codigo is not null;

comment on table public.lib_centros_custo is
  'Centros de custo. Destino das FK de lib_colaboradores, lib_fornecedores e omie_titulos.';


-- ---------- 1.2 lib_fornecedores: de agenda para cadastro de decisao ----------
alter table public.lib_fornecedores
  -- vinculo com o ERP e com a estrutura de custo
  add column if not exists omie_id                 text,
  add column if not exists categoria_omie_codigo   text,
  add column if not exists centro_custo_id         uuid references public.lib_centros_custo(id),
  add column if not exists departamento_id         uuid references public.lib_departamentos(id),
  -- perfil esperado do gasto (base para detectar atipico)
  add column if not exists valor_min               numeric(14,2),
  add column if not exists valor_max               numeric(14,2),
  add column if not exists periodicidade           text,
  add column if not exists prazo_pagamento_dias    integer,
  add column if not exists exige_nf                boolean not null default true,
  -- governanca
  add column if not exists gestor_aprovador_id     uuid references public.lib_colaboradores(id),
  -- medicao de confianca: e isto que autoriza o agente a agir sozinho
  add column if not exists n_ocorrencias           integer not null default 0,
  add column if not exists confianca               numeric(5,4) not null default 0,
  add column if not exists permite_auto_lancamento boolean not null default false,
  add column if not exists atualizado_em           timestamptz not null default now();

-- CNPJ/CPF normalizado: so digitos. E a chave real de cruzamento.
alter table public.lib_fornecedores
  add column if not exists documento_norm text
  generated always as (
    nullif(regexp_replace(coalesce(documento,''), '[^0-9]', '', 'g'), '')
  ) stored;

create unique index if not exists lib_fornecedores_documento_norm_uidx
  on public.lib_fornecedores (documento_norm) where documento_norm is not null;

create index if not exists lib_fornecedores_auto_idx
  on public.lib_fornecedores (permite_auto_lancamento) where permite_auto_lancamento;

alter table public.lib_fornecedores
  drop constraint if exists lib_fornecedores_periodicidade_chk;
alter table public.lib_fornecedores
  add constraint lib_fornecedores_periodicidade_chk
  check (periodicidade is null or periodicidade in
        ('mensal','quinzenal','trimestral','semestral','anual','avulso','variavel'));

alter table public.lib_fornecedores
  drop constraint if exists lib_fornecedores_confianca_chk;
alter table public.lib_fornecedores
  add constraint lib_fornecedores_confianca_chk
  check (confianca >= 0 and confianca <= 1);

comment on column public.lib_fornecedores.permite_auto_lancamento is
  'Interruptor da alcada VERDE (item V10 da matriz). Padrao false. So o humano liga.';
comment on column public.lib_fornecedores.confianca is
  'Taxa historica de acerto da categorizacao deste fornecedor, de 0 a 1. Calculada, nao digitada.';
comment on column public.lib_fornecedores.documento_norm is
  'CNPJ/CPF somente digitos. Chave canonica de cruzamento com extratos e comprovantes.';
comment on column public.lib_fornecedores.atualizado_em is
  'Carimbo do dominio de agentes. Convive com updated_at (mantido por trg_lib_fornecedores_updated).';

drop trigger if exists trg_lib_fornecedores_upd on public.lib_fornecedores;
create trigger trg_lib_fornecedores_upd before update on public.lib_fornecedores
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 1.3 contrapartes_alias ----------
create table if not exists public.contrapartes_alias (
  id             uuid primary key default gen_random_uuid(),
  fornecedor_id  uuid not null references public.lib_fornecedores(id) on delete cascade,
  alias          text not null,
  alias_norm     text generated always as (
                   upper(btrim(regexp_replace(alias, '[[:space:]]+', ' ', 'g')))
                 ) stored,
  fonte          text not null check (fonte in
                   ('sicoob','asaas','cartao','nf','omie_titulo','manual')),
  documento_norm text,
  confianca      numeric(5,4) not null default 1.0 check (confianca >= 0 and confianca <= 1),
  origem         text not null default 'manual' check (origem in ('manual','aprendido')),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create unique index if not exists contrapartes_alias_uidx
  on public.contrapartes_alias (alias_norm, fonte);
create index if not exists contrapartes_alias_forn_idx
  on public.contrapartes_alias (fornecedor_id);
create index if not exists contrapartes_alias_doc_idx
  on public.contrapartes_alias (documento_norm);

comment on table public.contrapartes_alias is
  'Dicionario de grafias. Traduz "PIX FULANO LTDA", "DL*FULANO" e "FULANO SERV" para o mesmo fornecedor_id.';

alter table public.contrapartes_alias enable row level security;
drop policy if exists "auth all contrapartes_alias" on public.contrapartes_alias;
create policy "auth all contrapartes_alias" on public.contrapartes_alias
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_contrapartes_alias_upd on public.contrapartes_alias;
create trigger trg_contrapartes_alias_upd before update on public.contrapartes_alias
  for each row execute function public.tg_set_atualizado_em();;
