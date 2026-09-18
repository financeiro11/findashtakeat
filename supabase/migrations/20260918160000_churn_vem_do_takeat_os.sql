-- O churn do Hub passa a ser o do Takeat OS. A planilha de churn sai de cena.
--
-- Decisão de 18/09/2026: "o que aparece no painel de churn tem de ser o que está no OS".
-- `churn_snapshot` tem seis leitores (aba Churn de /assinaturas, Revisão do Mês, Início do
-- celular, card de churn da DRE e o Assistente), então quem muda é quem ESCREVE: esta
-- função monta a mesma forma de `dados` a partir de `os_painel_mensal` e roda no fim de
-- `os_sync_refresh()`. O cron `churn-sheet-sync-diario` é desligado — senão ele reescreve
-- a planilha por cima uma hora depois.
--
-- O que o OS tem (Operação): Sucesso — cancelados (qtd e R$), reativados (qtd e R$),
-- downsell R$, upsell R$, churn líquido e os dois %; Ativação (= Onboarding) — churn R$ e
-- os dois %; a quantidade só até mar/26. Consolidado — % receita e % clientes, com meta.
--
-- O que NÃO tem, e sai do painel: quebra por qualificação (P/M/G/GG), setor Comercial,
-- quantidade de downsell e de upsell (vão como null).
--
-- Estimado, e marcado em `dados.estimados`:
--   • `onboarding_qtd` — sem a contagem da Ativação, qtd = % Customer Churn × clientes da
--     base (o mesmo denominador que o OS usa: jul/26 2,23% × 2.780 = 62);
--   • `base` — mês sem linha em os_assinaturas (2025 e jan/26): MRR e clientes da base
--     derivados do % do próprio OS (valor ÷ %), com erro de arredondamento do % (~0,3%).
--
-- Conferido contra o OS (jul/26): % churn receita = (23.235,90 + 17.188,89) ÷ 1.080.613,29
-- = 3,74%, o mesmo número da linha "% Churn Revenue Total".

create or replace function public.os_churn_para_snapshot()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n integer;
  meses text[] := array['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  curtos text[] := array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
begin
  with v as (
    select p.competencia::date as c,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Clientes Cancelados') as s_cq,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Receita Cancelada')   as s_cv,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Clientes Reativados') as s_rq,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Receita Reativada')   as s_rv,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Downsell')            as s_dv,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Upsell')              as s_uv,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Customer Churn')      as s_chq,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = 'Revenue Churn')       as s_chv,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = '% Customer Churn')    as s_pc,
      max(p.realizado) filter (where p.canal = 'Sucesso'  and p.indicador = '% Revenue Churn')     as s_pr,
      max(p.realizado) filter (where p.canal = 'Ativação' and p.indicador = 'Customer Churn')      as a_q,
      max(p.realizado) filter (where p.canal = 'Ativação' and p.indicador = 'Revenue Churn')       as a_v,
      max(p.realizado) filter (where p.canal = 'Ativação' and p.indicador = '% Customer Churn')    as a_pc,
      max(p.realizado) filter (where p.canal = 'Ativação' and p.indicador = '% Revenue Churn')     as a_pr,
      max(p.realizado) filter (where p.canal = 'Consolidado' and p.indicador = '% Churn Revenue Total')  as t_pr,
      max(p.orcado)    filter (where p.canal = 'Consolidado' and p.indicador = '% Churn Revenue Total')  as t_meta,
      max(p.realizado) filter (where p.canal = 'Consolidado' and p.indicador = '% Churn Customer Total') as t_pc
    from public.os_painel_mensal p
    where p.departamento = 'Operação'
    group by 1
  ),
  b as (
    select v.*,
      a.competencia as base_comp, a.mrr_total_assinatura as a_mrr, a.clientes as a_cli, a.perfil as a_perfil,
      coalesce(v.s_chv, v.s_cv + coalesce(v.s_dv, 0) - coalesce(v.s_uv, 0) - coalesce(v.s_rv, 0)) as s_liq_v,
      coalesce(v.s_chq, v.s_cq - coalesce(v.s_rq, 0)) as s_liq_q
    from v
    left join public.os_assinaturas a on a.competencia = (v.c - interval '1 month')::date
    where v.s_cq is not null or v.a_v is not null
  ),
  base as (
    select b.*,
      coalesce(b.a_mrr,
        case when coalesce(b.t_pr, 0) > 0 then (coalesce(b.a_v, 0) + coalesce(b.s_liq_v, 0)) / (b.t_pr / 100) end) as mrr_inicio,
      coalesce(b.a_cli::numeric,
        case when coalesce(b.s_pc, 0) > 0 then round(b.s_liq_q / (b.s_pc / 100)) end) as clientes,
      b.a_mrr is null as base_derivada
    from b
  ),
  k as (
    select base.*,
      coalesce(base.a_q, round(base.a_pc / 100 * base.clientes)) as a_q_final,
      base.a_q is null and base.a_pc is not null as a_q_estimada
    from base
  ),
  kk as (
    select k.*,
      coalesce(k.s_cq, 0) + coalesce(k.a_q_final, 0) as cancel_qtd,
      coalesce(k.s_cv, 0) + coalesce(k.a_v, 0)       as cancel_valor,
      coalesce(k.a_v, 0) + coalesce(k.s_liq_v, 0)    as churn_valor,
      coalesce(k.a_q_final, 0) + coalesce(k.s_liq_q, 0) as churn_qtd
    from k
  ),
  final as (
    select kk.*,
      coalesce(kk.t_pr, case when kk.mrr_inicio > 0 then kk.churn_valor / kk.mrr_inicio * 100 end) as pct_receita,
      coalesce(kk.t_pc, case when kk.clientes > 0 then kk.churn_qtd / kk.clientes * 100 end)     as pct_cliente
    from kk
  ),
  gravar as (
    insert into public.churn_snapshot (competencia, mes_label, dados, sincronizado_em, gerado_em)
    select f.c,
      curtos[extract(month from f.c)::int] || ' ' || to_char(f.c, 'YY'),
      jsonb_build_object(
        'fonte', 'takeat_os',
        'competencia', to_char(f.c, 'YYYY-MM-DD'),
        'mes_label', curtos[extract(month from f.c)::int] || ' ' || to_char(f.c, 'YY'),
        'mes_nome', meses[extract(month from f.c)::int],
        'mes_num', extract(month from f.c)::int,
        'em_andamento', f.c >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date,
        'estimados', to_jsonb(array_remove(array[
            case when f.a_q_estimada then 'onboarding_qtd' end,
            case when f.base_derivada then 'base' end], null)),
        'base', jsonb_build_object(
          'mrr_inicio', f.mrr_inicio,
          'clientes', f.clientes,
          'tm_mrr', case when f.clientes > 0 then f.mrr_inicio / f.clientes end,
          'derivada', f.base_derivada,
          'mix_clientes', case when f.a_perfil is not null then jsonb_build_object(
              'P', (f.a_perfil->'P'->>'count')::numeric, 'M', (f.a_perfil->'M'->>'count')::numeric,
              'G', (f.a_perfil->'G'->>'count')::numeric, 'GG', (f.a_perfil->'GG'->>'count')::numeric) end,
          'mix_nivel', case when f.a_perfil is not null then (
              select jsonb_agg(jsonb_build_object('nivel', t.niv, 'clientes', (f.a_perfil->t.niv->>'count')::numeric,
                                                  'mrr', (f.a_perfil->t.niv->>'mrr')::numeric) order by t.ord)
                from unnest(array['P','M','G','GG']) with ordinality as t(niv, ord)) end,
          'snapshot_recorrencia', case when f.base_comp is not null then jsonb_build_object(
              'competencia', to_char(f.base_comp, 'YYYY-MM-DD'),
              'mes_label', curtos[extract(month from f.base_comp)::int] || ' ' || to_char(f.base_comp, 'YY'),
              'mrr_core', f.a_mrr) end,
          'conferencia', null),
        'kpis', jsonb_build_object(
          'cancel_qtd', f.cancel_qtd, 'cancel_valor', f.cancel_valor,
          'cancel_tm', case when f.cancel_qtd > 0 then f.cancel_valor / f.cancel_qtd else 0 end,
          'downsell_qtd', null, 'downsell_valor', coalesce(f.s_dv, 0),
          'upsell_qtd', null, 'upsell_valor', coalesce(f.s_uv, 0),
          'reativacao_qtd', coalesce(f.s_rq, 0), 'reativacao_valor', coalesce(f.s_rv, 0),
          'churn_qtd', f.churn_qtd, 'churn_valor', f.churn_valor,
          'churn_tm', case when f.churn_qtd <> 0 then f.churn_valor / f.churn_qtd else 0 end,
          'pct_receita_geral', f.pct_receita,
          'pct_receita_onboarding', f.a_pr,
          'pct_receita_sucesso', f.s_pr,
          'pct_cliente_geral', f.pct_cliente,
          'pct_cliente_onboarding', f.a_pc,
          'pct_cliente_sucesso', f.s_pc,
          'meta_pct', f.t_meta,
          'meta_valor', case when f.t_meta is not null then f.t_meta / 100 * f.mrr_inicio end,
          'north_star', case when coalesce(f.pct_receita, 0) > 0 and f.t_meta is not null then f.t_meta / f.pct_receita * 100 end),
        'por_setor', jsonb_build_array(
          jsonb_build_object('setor', 'Onboarding', 'qtd', f.a_q_final, 'valor', coalesce(f.a_v, 0),
            'pct_do_cancelamento', case when f.cancel_valor > 0 then coalesce(f.a_v, 0) / f.cancel_valor * 100 else 0 end,
            'pct_receita', f.a_pr, 'pct_receita_liquido', f.a_pr, 'pct_cliente', f.a_pc),
          jsonb_build_object('setor', 'Sucesso', 'qtd', f.s_cq, 'valor', coalesce(f.s_cv, 0),
            'pct_do_cancelamento', case when f.cancel_valor > 0 then coalesce(f.s_cv, 0) / f.cancel_valor * 100 else 0 end,
            'pct_receita', case when f.mrr_inicio > 0 then coalesce(f.s_cv, 0) / f.mrr_inicio * 100 end,
            'pct_receita_liquido', f.s_pr, 'pct_cliente', f.s_pc)),
        'por_qualificacao', jsonb_build_object('geral', '[]'::jsonb, 'onboarding', '[]'::jsonb, 'sucesso', '[]'::jsonb)
      ),
      now(), now()
    from final f
    on conflict (competencia) do update
      set mes_label = excluded.mes_label, dados = excluded.dados,
          sincronizado_em = excluded.sincronizado_em, gerado_em = excluded.gerado_em
    returning 1
  )
  select count(*) into n from gravar;

  -- O que ficou da planilha sai: dois donos para a mesma tabela é o que deixa a tela
  -- mostrando um número que ninguém sabe de onde veio.
  delete from public.churn_snapshot where coalesce(dados->>'fonte', '') <> 'takeat_os';

  return n;
end
$function$;

revoke execute on function public.os_churn_para_snapshot() from public, anon, authenticated;

-- A cópia diária passa a remontar o churn logo depois de trazer o OS. Dentro do savepoint:
-- se o churn falhar, a cópia inteira volta e a falha fica no log.
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
end
$function$;

revoke execute on function public.os_sync_refresh() from public, anon, authenticated;

-- A planilha não escreve mais no churn. Desligado, não apagado: religar é um alter_job.
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'churn-sheet-sync-diario';
  if j is not null then
    perform cron.alter_job(job_id := j, active := false);
  end if;
end $$;

comment on table public.churn_snapshot is
  'Churn por competência, montado do Takeat OS por os_churn_para_snapshot() (desde 18/09/2026; antes vinha da planilha pela churn-sheet-sync, hoje desligada). dados.estimados lista o que foi derivado: onboarding_qtd, base.';
