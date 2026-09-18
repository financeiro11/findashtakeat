-- O espelho do Takeat OS entra no repositório e passa a obedecer o crachá.
--
-- Em 17/09/2026 o time de RPA ligou um postgres_fdw (servidor `takeat_os`, outro projeto
-- Supabase) e criou DIRETO no banco, sem migration:
--   • schema `os_sync` — 8 foreign tables apontando para o OS (sem grant para authenticated);
--   • cópias locais `public.os_*` + `os_sync_log`;
--   • `public.os_sync_refresh()` (TRUNCATE + INSERT de tudo) e o cron `os_sync_painel` (09:00 UTC).
--
-- O servidor, o user mapping (tem a senha do outro banco) e as foreign tables ficam FORA do
-- repo de propósito. Aqui entram: o formato das cópias (idempotente — elas já existem), a
-- leitura por capacidade e a função de atualização consertada.
--
-- O que estava errado:
--   1. Policy "os leitura logado" = `true`: qualquer sessão lia tudo, inclusive os dois
--      indicadores que o próprio OS marca `sensivel` (Margem de Contribuição e LTV).
--   2. `os_sync_refresh()` é SECURITY DEFINER e estava executável por `anon` e
--      `authenticated` — com a chave pública dava para disparar o truncate+recópia.
--   3. O handler de erro gravava o log e dava `raise`: o raise desfaz a transação inteira,
--      log incluído. Falha nunca aparecia em `os_sync_log`.

------------------------------------------------------------------------------------------
-- 1. As cópias (documentação executável; `if not exists` porque já estão lá)
------------------------------------------------------------------------------------------
create table if not exists public.os_departamentos (
  id uuid, nome text, ordem integer
);
create table if not exists public.os_canais (
  id uuid, nome text, department_id uuid, departamento text, ativo boolean, comite_order integer
);
create table if not exists public.os_indicadores (
  id uuid, departamento text, canal text, indicador text, unidade text, sensivel boolean,
  e_formula boolean, formula text, north_star boolean, menor_e_melhor boolean,
  no_painel boolean, no_comite boolean, no_bp boolean, ativo boolean, ordem integer,
  department_id uuid, channel_id uuid
);
create table if not exists public.os_painel_mensal (
  indicator_id uuid, departamento text, canal text, indicador text, unidade text,
  sensivel boolean, e_formula boolean, ano integer, mes integer, competencia date,
  orcado numeric, realizado numeric, menor_e_melhor boolean, atualizado_em timestamptz,
  atingimento_pct numeric
);
create table if not exists public.os_painel_semanal (
  indicator_id uuid, departamento text, canal text, indicador text, unidade text,
  sensivel boolean, e_formula boolean, ano integer, semana integer, rotulo_semana text,
  mes integer, realizado numeric, atualizado_em timestamptz
);
create table if not exists public.os_assinaturas (
  id uuid, ano integer, mes integer, competencia date, mrr_total numeric,
  mrr_total_assinatura numeric, mrr_banestes numeric, mrr_aluguel numeric,
  clientes integer, perfil jsonb, criado_em timestamptz
);
create table if not exists public.os_custos (
  id uuid, ano integer, mes integer, competencia date, grupo text, categoria text,
  ordem integer, valor numeric, atualizado_em timestamptz
);
create table if not exists public.os_sync_log (
  id bigserial primary key, executado_em timestamptz not null default now(),
  ok boolean, linhas jsonb, erro text
);

create index if not exists os_painel_mensal_periodo_idx  on public.os_painel_mensal (ano, mes);
create index if not exists os_painel_mensal_canal_idx    on public.os_painel_mensal (canal, indicador);
create index if not exists os_painel_semanal_periodo_idx on public.os_painel_semanal (ano, semana);

comment on table public.os_indicadores is
  'Espelho do Takeat OS (RPA): o que cada departamento/canal mede. `e_formula` = calculado no OS a partir de outros ids ([uuid] indicador, [cost:uuid] categoria de custo — esta NÃO é o os_custos.id, então fórmula de custo não se recalcula aqui). Escrita só por os_sync_refresh(). Ver migration 20260918140000.';
comment on table public.os_painel_mensal is
  'Espelho do Takeat OS: orçado × realizado × atingimento por indicador e mês (jan/25 em diante). Fórmula só tem realizado quando o OS materializa; total consolidado vira null se um canal estiver null. Linha `sensivel` só para quem tem demonstracoes.';
comment on table public.os_painel_semanal is
  'Espelho do Takeat OS: realizado semanal por indicador. Sem orçado.';
comment on table public.os_assinaturas is
  'Espelho do Takeat OS: MRR e clientes por mês. Vem da MESMA planilha de assinaturas_snapshot (conferido ao centavo em jun–ago/26).';
comment on table public.os_custos is
  'Espelho do Takeat OS: a matriz do CAC (Equipes/Investimentos/Comissões). Bate com cac_painel em 16 de 19 linhas de ago/26.';
comment on table public.os_sync_log is
  'Uma linha por os_sync_refresh(): contagem por tabela ou o erro. Desde 20260918140000 a falha é gravada (antes o raise desfazia o próprio log).';

------------------------------------------------------------------------------------------
-- 2. Leitura por capacidade: `metricas` (a mesma de /assinaturas, estornos e CAC)
------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['os_departamentos','os_canais','os_indicadores','os_assinaturas',
                           'os_custos','os_sync_log','os_painel_mensal','os_painel_semanal']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "os leitura logado" on public.%I', t);
    execute format('drop policy if exists "le quem ve metricas" on public.%I', t);
  end loop;
end $$;

create policy "le quem ve metricas" on public.os_departamentos
  for select to authenticated using (public.pode_ler('metricas'));
create policy "le quem ve metricas" on public.os_canais
  for select to authenticated using (public.pode_ler('metricas'));
create policy "le quem ve metricas" on public.os_indicadores
  for select to authenticated using (public.pode_ler('metricas'));
create policy "le quem ve metricas" on public.os_assinaturas
  for select to authenticated using (public.pode_ler('metricas'));
create policy "le quem ve metricas" on public.os_custos
  for select to authenticated using (public.pode_ler('metricas'));
create policy "le quem ve metricas" on public.os_sync_log
  for select to authenticated using (public.pode_ler('metricas'));

-- O `sensivel` usa `pode()` (duro), não `pode_ler()`: com `demonstracoes` em modo aviso,
-- pode_ler libera todo mundo, e quem marcou o indicador como sensível foi o próprio OS.
-- `pode` é STABLE e não escreve, então serve em policy.
create policy "le quem ve metricas" on public.os_painel_mensal
  for select to authenticated using (
    public.pode_ler('metricas')
    and (not coalesce(sensivel, false) or auth.uid() is null or public.pode('demonstracoes'))
  );
create policy "le quem ve metricas" on public.os_painel_semanal
  for select to authenticated using (
    public.pode_ler('metricas')
    and (not coalesce(sensivel, false) or auth.uid() is null or public.pode('demonstracoes'))
  );

------------------------------------------------------------------------------------------
-- 3. A atualização: fechada para o app, e falha que fica registrada
------------------------------------------------------------------------------------------
-- TRUNCATE + INSERT numa função só é UMA transação: quem lê espera o lock e vê o conjunto
-- novo inteiro, nunca a tabela vazia. O bloco `begin … exception` é um savepoint: se a
-- leitura do OS falhar, as cópias voltam ao estado anterior, o erro é gravado e a função
-- termina com WARNING (sem o raise que apagava o próprio log).
create or replace function public.os_sync_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  n jsonb := '{}'::jsonb;
  c bigint;
begin
  begin
    truncate public.os_indicadores, public.os_departamentos, public.os_canais,
             public.os_painel_mensal, public.os_painel_semanal, public.os_assinaturas, public.os_custos;

    insert into public.os_indicadores    select * from os_sync.indicadores;                   get diagnostics c = row_count; n := n || jsonb_build_object('indicadores', c);
    insert into public.os_departamentos  select * from os_sync.departamentos;                 get diagnostics c = row_count; n := n || jsonb_build_object('departamentos', c);
    insert into public.os_canais         select * from os_sync.canais;                        get diagnostics c = row_count; n := n || jsonb_build_object('canais', c);
    insert into public.os_painel_mensal  select * from os_sync.painel_mensal_com_atingimento; get diagnostics c = row_count; n := n || jsonb_build_object('painel_mensal', c);
    insert into public.os_painel_semanal select * from os_sync.painel_semanal;                get diagnostics c = row_count; n := n || jsonb_build_object('painel_semanal', c);
    insert into public.os_assinaturas    select * from os_sync.assinaturas;                   get diagnostics c = row_count; n := n || jsonb_build_object('assinaturas', c);
    insert into public.os_custos         select * from os_sync.custos;                        get diagnostics c = row_count; n := n || jsonb_build_object('custos', c);
  exception when others then
    insert into public.os_sync_log (ok, erro) values (false, sqlerrm);
    raise warning 'os_sync_refresh falhou, cópias mantidas: %', sqlerrm;
    return;
  end;

  insert into public.os_sync_log (ok, linhas) values (true, n);
end
$function$;

revoke execute on function public.os_sync_refresh() from public, anon, authenticated;
