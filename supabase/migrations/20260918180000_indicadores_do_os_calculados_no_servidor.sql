-- O que o Hub calcula do Takeat OS passa a existir no banco, não só na tela.
--
-- A tela /indicadores completa o que o OS deixa vazio (CAC, LTV, TM MRR, Payback, totais)
-- com a fórmula do próprio OS — ver supabase/functions/_shared/indicadores-os-calculo.ts.
-- O Assistente e a Revisão do Mês não enxergavam esses números. Agora a Edge Function
-- `os-indicadores-calcular` roda o MESMO módulo logo depois da cópia diária e grava aqui.
--
--   os_painel_calculado — só o que o Hub calculou (origem hub / hub_parcial / hub_estimado),
--                         com a nota do porquê. Nunca repete número do OS.
--   os_painel_completo  — a leitura pronta: número do OS quando existe, senão o do Hub,
--                         com `origem` dizendo qual. security_invoker: a RLS de quem lê vale.

create table if not exists public.os_painel_calculado (
  indicator_id uuid not null,
  competencia  date not null,
  ano integer, mes integer,
  departamento text, canal text, indicador text, unidade text,
  sensivel boolean not null default false,
  orcado numeric,
  realizado numeric not null,
  origem text not null check (origem in ('hub', 'hub_parcial', 'hub_estimado')),
  nota text,
  calculado_em timestamptz not null default now(),
  primary key (indicator_id, competencia)
);

comment on table public.os_painel_calculado is
  'Realizado que o Takeat OS deixou vazio e o Hub calculou com a fórmula do OS (os-indicadores-calcular, após a cópia diária). origem: hub = fórmula completa; hub_parcial = soma só dos canais que lançaram; hub_estimado = estimativa (CAC MKT, churn de Ativação). Ver migration 20260918180000.';

alter table public.os_painel_calculado enable row level security;
drop policy if exists "le quem ve metricas" on public.os_painel_calculado;
create policy "le quem ve metricas" on public.os_painel_calculado
  for select to authenticated using (
    public.pode_ler('metricas')
    and (not sensivel or auth.uid() is null or public.pode('demonstracoes'))
  );
revoke insert, update, delete on public.os_painel_calculado from authenticated, anon;

create or replace view public.os_painel_completo
with (security_invoker = true) as
select
  coalesce(p.indicator_id, c.indicator_id)     as indicator_id,
  coalesce(p.departamento, c.departamento)     as departamento,
  coalesce(p.canal, c.canal)                   as canal,
  coalesce(p.indicador, c.indicador)           as indicador,
  coalesce(p.unidade, c.unidade)               as unidade,
  coalesce(p.sensivel, c.sensivel)             as sensivel,
  p.e_formula,
  p.menor_e_melhor,
  coalesce(p.ano, c.ano)                       as ano,
  coalesce(p.mes, c.mes)                       as mes,
  coalesce(p.competencia, c.competencia)       as competencia,
  coalesce(p.orcado, c.orcado)                 as orcado,
  coalesce(p.realizado, c.realizado)           as realizado,
  case when p.realizado is not null then 'os' else c.origem end as origem,
  case when p.realizado is null then c.nota end                  as nota
from public.os_painel_mensal p
full join public.os_painel_calculado c
  on c.indicator_id = p.indicator_id and c.competencia = p.competencia;

comment on view public.os_painel_completo is
  'Painel do Takeat OS completo: realizado do OS quando existe; senão o que o Hub calculou (origem hub/hub_parcial/hub_estimado + nota). É o que o Assistente e a Revisão leem.';

grant select on public.os_painel_completo to authenticated;

-- Token da chamada do cron (mesmo padrão das outras funções: lido na hora do disparo).
insert into public.internal_cron_tokens (name, token)
select 'os-indicadores-calcular', gen_random_uuid()::text
where not exists (select 1 from public.internal_cron_tokens where name = 'os-indicadores-calcular');

-- A cópia diária dispara o cálculo no fim, só quando deu certo. pg_net manda depois do commit.
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

    n := n || jsonb_build_object('churn_snapshot', public.os_churn_para_snapshot());
  exception when others then
    insert into public.os_sync_log (ok, erro) values (false, sqlerrm);
    raise warning 'os_sync_refresh falhou, cópias mantidas: %', sqlerrm;
    return;
  end;

  insert into public.os_sync_log (ok, linhas) values (true, n);

  perform public.disparar_automacao(
    'os-indicadores-calcular',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/os-indicadores-calcular',
    jsonb_build_object('trigger', 'os_sync_refresh'),
    'os-indicadores-calcular',
    null,
    null);
end
$function$;

revoke execute on function public.os_sync_refresh() from public, anon, authenticated;
