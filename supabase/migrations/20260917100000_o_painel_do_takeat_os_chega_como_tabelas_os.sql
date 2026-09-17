-- ============================================================================
-- Integração TakeatOS → Hub Financeiro (FinOps, projeto lgcxyxyidoirqmbdlldh)
--
-- RODAR NO BANCO DO FINOPS, não no TakeatOS.
--
-- O Hub puxa o Painel do TakeatOS 1x ao dia (6h BRT) via postgres_fdw +
-- pg_cron, mesmo desenho da integração com o portal RH. Tudo que for digitado,
-- importado ou sincronizado no Painel aparece aqui no próximo ciclo.
--
-- Lado TakeatOS já pronto (migrations/hub_espelho_painel.sql): esquema `hub`
-- com as views e o usuário `hub_leitor`, que só enxerga esse esquema.
--
-- ANTES DE RODAR: troque SENHA_DO_HUB_LEITOR_AQUI pela senha definida no
-- TakeatOS com `alter role hub_leitor password '...'`. NÃO deixe a senha
-- salva neste arquivo depois.
-- ============================================================================

create extension if not exists postgres_fdw;
create extension if not exists pg_cron;

create schema if not exists os_sync;

-- Pooler do TakeatOS (us-east-2), modo sessão, porta 5432.
create server if not exists takeat_os foreign data wrapper postgres_fdw
  options (host 'aws-1-us-east-2.pooler.supabase.com', port '5432', dbname 'postgres');

create user mapping if not exists for postgres server takeat_os
  options (user 'hub_leitor.letbfcvhdtvpfdkgsjeo', password 'SENHA_DO_HUB_LEITOR_AQUI');

-- Traz as views do esquema `hub` do TakeatOS como tabelas estrangeiras.
import foreign schema hub
  limit to (indicadores, departamentos, canais, painel_mensal, painel_mensal_com_atingimento, painel_semanal, assinaturas, custos)
  from server takeat_os into os_sync;

-- ─── Cópias locais (o que o Hub consulta) ────────────────────────────────────
-- Cópia, não link: se o TakeatOS cair, o Hub fica com o último dado.
create table if not exists public.os_indicadores      (like os_sync.indicadores);
create table if not exists public.os_departamentos    (like os_sync.departamentos);
create table if not exists public.os_canais           (like os_sync.canais);
create table if not exists public.os_painel_mensal    (like os_sync.painel_mensal_com_atingimento);
create table if not exists public.os_painel_semanal   (like os_sync.painel_semanal);
create table if not exists public.os_assinaturas      (like os_sync.assinaturas);
create table if not exists public.os_custos           (like os_sync.custos);

create index if not exists os_painel_mensal_periodo_idx  on public.os_painel_mensal (ano, mes);
create index if not exists os_painel_mensal_canal_idx    on public.os_painel_mensal (canal, indicador);
create index if not exists os_painel_semanal_periodo_idx on public.os_painel_semanal (ano, semana);

create table if not exists public.os_sync_log (
  id bigserial primary key,
  executado_em timestamptz not null default now(),
  ok boolean not null,
  linhas jsonb,
  erro text
);

-- ─── Atualização ─────────────────────────────────────────────────────────────
create or replace function public.os_sync_refresh()
returns void
language plpgsql
security definer
as $$
declare
  n jsonb := '{}'::jsonb;
  c bigint;
begin
  truncate public.os_indicadores, public.os_departamentos, public.os_canais,
           public.os_painel_mensal, public.os_painel_semanal, public.os_assinaturas, public.os_custos;

  insert into public.os_indicadores    select * from os_sync.indicadores;                 get diagnostics c = row_count; n := n || jsonb_build_object('indicadores', c);
  insert into public.os_departamentos  select * from os_sync.departamentos;               get diagnostics c = row_count; n := n || jsonb_build_object('departamentos', c);
  insert into public.os_canais         select * from os_sync.canais;                      get diagnostics c = row_count; n := n || jsonb_build_object('canais', c);
  insert into public.os_painel_mensal  select * from os_sync.painel_mensal_com_atingimento; get diagnostics c = row_count; n := n || jsonb_build_object('painel_mensal', c);
  insert into public.os_painel_semanal select * from os_sync.painel_semanal;              get diagnostics c = row_count; n := n || jsonb_build_object('painel_semanal', c);
  insert into public.os_assinaturas    select * from os_sync.assinaturas;                 get diagnostics c = row_count; n := n || jsonb_build_object('assinaturas', c);
  insert into public.os_custos         select * from os_sync.custos;                      get diagnostics c = row_count; n := n || jsonb_build_object('custos', c);

  insert into public.os_sync_log (ok, linhas) values (true, n);
exception when others then
  insert into public.os_sync_log (ok, erro) values (false, sqlerrm);
  raise;
end
$$;

-- 6h de Brasília = 9h UTC. Uma vez ao dia basta: o Painel muda no ritmo de quem digita.
select cron.unschedule(jobid) from cron.job where jobname = 'os_sync_painel';
select cron.schedule('os_sync_painel', '0 9 * * *', $$select public.os_sync_refresh()$$);

-- Leitura pelo app do Hub (ajuste ao padrão de RLS do FinOps, se houver).
grant select on public.os_indicadores, public.os_departamentos, public.os_canais,
                public.os_painel_mensal, public.os_painel_semanal, public.os_assinaturas, public.os_custos,
                public.os_sync_log
  to authenticated, service_role;

-- Primeira carga, na hora:
select public.os_sync_refresh();
select * from public.os_sync_log order by id desc limit 1;

-- ─── RLS (padrão do Hub: tabela restrita, leitura só para logado) ────────────
-- A função de sync roda como postgres e passa por cima do RLS; a API só lê.
do $$
declare t text;
begin
  foreach t in array array['os_indicadores','os_departamentos','os_canais','os_painel_mensal','os_painel_semanal','os_assinaturas','os_custos','os_sync_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "os leitura logado" on public.%I', t);
    execute format('create policy "os leitura logado" on public.%I for select to authenticated using (true)', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
