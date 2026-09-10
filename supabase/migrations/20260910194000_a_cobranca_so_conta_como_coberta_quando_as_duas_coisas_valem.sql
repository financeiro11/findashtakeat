/* ---------------------------------------------------------------------------
 * A cobrança só conta como coberta quando as DUAS coisas já valem.
 *
 * O SINTOMA, no primeiro desenho da curva: **cobertura de 478,6%** no dia 2 de
 * agosto. Número impossível que só apareceu porque o gráfico foi lido antes de
 * ser publicado.
 *
 * A CAUSA é somar dois acumulados independentes e dividir um pelo outro. O
 * denominador crescia por dia de COBRANÇA e o numerador por dia de NOTA — então
 * uma nota emitida no dia 2 para uma cobrança que só vence no dia 20 entrava em
 * cima de um denominador que ainda não a continha. No começo do mês, quando o
 * denominador é pequeno e o Asaas já emitiu o lote inteiro, a razão estoura.
 *
 * A CORREÇÃO é parar de tratar as duas datas como séries separadas. Uma cobrança
 * está coberta a partir do dia em que **as duas condições valem** — ela já
 * entrou E já tem nota:
 *
 *     dia_coberta = greatest(dia_da_cobranca, dia_da_nota)
 *
 * Com isso o numerador nunca ultrapassa o denominador, porque toda cobrança
 * contada em cima já foi contada embaixo. E a leitura passa a ser a que se
 * queria: "no dia 9, que fração do que já tinha entrado já tinha nota".
 *
 * A nota emitida ANTES do mês (os quatro clientes que pagam contra nota) entra
 * no dia 1: quando o mês começou, ela já estava lá. A emitida DEPOIS do fim da
 * janela fica de fora — dentro daquele mês ela não existia, e é isso que a curva
 * tem de mostrar.
 *
 * DE QUEBRA, O AVISO DA OUTRA SÉRIE FICOU CERTO. `emitidas_ant_confiavel` olhava
 * a data da primeira nota que a esteira já autorizou — 02/06/2026 — e concluía
 * que agosto servia de comparação. Não serve: a esteira emitiu em junho, parou, e
 * só voltou em **20/08**. Agosto tem zero nos dias 1 a 19 por não estar rodando,
 * não por ter falhado. Agora o campo conta os DIAS COM EMISSÃO do mês anterior
 * dentro da janela comparada, que é o que responde "há com o que comparar?".
 * ------------------------------------------------------------------------- */

create or replace function public.notas_fiscais_ritmo(p_mes date default null)
returns jsonb
language sql stable security invoker set search_path = public
set statement_timeout to '30s'
as $$
with janela as (
  select ini_atual,
         (ini_atual + interval '1 month - 1 day')::date as fim_atual,
         (ini_atual - interval '1 month')::date         as ini_ant,
         (ini_atual - interval '1 day')::date           as fim_ant,
         case when date_trunc('month', current_date)::date = ini_atual
              then extract(day from current_date)::int
              else extract(day from (ini_atual + interval '1 month - 1 day'))::int
         end as dia_corte
  from (select date_trunc('month', coalesce(p_mes, current_date))::date as ini_atual) r
),
emit as (
  select (case when o.data_faturamento >= j.ini_atual then 'atual' else 'anterior' end) as mes,
         extract(day from o.data_faturamento)::int as dia,
         count(*)::int as n
  from public.nf_os_omie o, janela j
  where o.cancelada = false and o.nfse_status = '004'
    and o.data_faturamento between j.ini_ant and j.fim_atual
  group by 1, 2
),
cru as (
  select 'atual'::text as mes, p.situacao, p.data_pagamento, p.data_vencimento, p.n_cod_os, p.id_asaas
  from janela j, public.notas_fiscais_painel(j.ini_atual, j.fim_atual) p
  union all
  select 'anterior', p.situacao, p.data_pagamento, p.data_vencimento, p.n_cod_os, p.id_asaas
  from janela j, public.notas_fiscais_painel(j.ini_ant, j.fim_ant) p
),
datado as (
  select c.mes,
         extract(day from coalesce(c.data_pagamento, c.data_vencimento))::int as dia_cobranca,
         (c.situacao <> 'nao_exige') as exige,
         (c.situacao in ('emitida_omie','emitida_asaas')) as tem_nota,
         -- `least` das duas origens: quando as duas emitiram, cobriu a primeira.
         least(os.data_faturamento, nfa.data_efetiva) as dia_nota
  from cru c
  left join public.nf_os_omie os on os.n_cod_os = c.n_cod_os and os.nfse_status = '004'
  left join lateral (
    select max(n.data_efetiva::date) as data_efetiva
    from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = c.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  ) nfa on true
),
pain as (
  select mes, dia_cobranca, count(*) filter (where exige)::int as exigem
  from datado group by 1, 2
),
cobre as (
  select d.mes,
         /* O DIA EM QUE AS DUAS COISAS PASSAM A VALER. Nota anterior ao mês vira
            dia 1 (já estava lá na virada); nota posterior à janela é descartada
            no `where`. Sem o `greatest`, o numerador conta cobrança que o
            denominador ainda não contou — foi o 478,6%. */
         greatest(
           d.dia_cobranca,
           case when d.dia_nota < (case when d.mes = 'atual' then j.ini_atual else j.ini_ant end)
                then 1
                else extract(day from d.dia_nota)::int end
         ) as dia,
         count(*)::int as n
  from datado d, janela j
  where d.exige and d.tem_nota and d.dia_nota is not null
    and d.dia_nota <= (case when d.mes = 'atual' then j.fim_atual else j.fim_ant end)
  group by 1, 2
),
dias as (select generate_series(1, 31) as dia),
somado as (
  select d.dia,
         sum(coalesce(ea.n, 0))      over (order by d.dia) as emit_atual,
         sum(coalesce(eb.n, 0))      over (order by d.dia) as emit_ant,
         sum(coalesce(pa.exigem, 0)) over (order by d.dia) as exigem_atual,
         sum(coalesce(pb.exigem, 0)) over (order by d.dia) as exigem_ant,
         sum(coalesce(ca.n, 0))      over (order by d.dia) as nota_atual,
         sum(coalesce(cb.n, 0))      over (order by d.dia) as nota_ant
  from dias d
  left join emit  ea on ea.mes = 'atual'    and ea.dia = d.dia
  left join emit  eb on eb.mes = 'anterior' and eb.dia = d.dia
  left join pain  pa on pa.mes = 'atual'    and pa.dia_cobranca = d.dia
  left join pain  pb on pb.mes = 'anterior' and pb.dia_cobranca = d.dia
  left join cobre ca on ca.mes = 'atual'    and ca.dia = d.dia
  left join cobre cb on cb.mes = 'anterior' and cb.dia = d.dia
),
/* "Há com o que comparar?" — em DIAS COM EMISSÃO do mês anterior dentro da
   janela, não na data da primeira nota de todas. A esteira emitiu em junho,
   parou, e voltou em 20/08: pela pergunta antiga agosto servia de base; pela
   nova, não serve, e é a nova que descreve o gráfico. */
base as (
  select count(distinct o.data_faturamento)::int as dias_com_emissao
  from public.nf_os_omie o, janela j
  where o.cancelada = false and o.nfse_status = '004'
    and o.data_faturamento between j.ini_ant
                              and (j.ini_ant + make_interval(days => (select dia_corte from janela) - 1))
)
select jsonb_build_object(
  'mes_atual',    to_char((select ini_atual from janela), 'YYYY-MM'),
  'mes_anterior', to_char((select ini_ant   from janela), 'YYYY-MM'),
  'dia_corte',    (select dia_corte from janela),
  'esteira_desde', (select min(o.data_faturamento) from public.nf_os_omie o
                    where o.cancelada = false and o.nfse_status = '004'),
  'emitidas_ant_dias',       (select dias_com_emissao from base),
  'emitidas_ant_confiavel',  (select dias_com_emissao from base) > 0,
  'serie', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dia', s.dia,
      'emitidas_atual',  case when s.dia <= (select dia_corte from janela) then s.emit_atual end,
      'emitidas_ant',    s.emit_ant,
      'cobertura_atual', case when s.dia <= (select dia_corte from janela) and s.exigem_atual > 0
                              then round(100.0 * s.nota_atual / s.exigem_atual, 1) end,
      'cobertura_ant',   case when s.exigem_ant > 0
                              then round(100.0 * s.nota_ant / s.exigem_ant, 1) end
    ) order by s.dia), '[]'::jsonb)
    from somado s
    where s.dia <= greatest(
      extract(day from (select fim_atual from janela))::int,
      extract(day from (select fim_ant   from janela))::int)
  ),
  'hoje', (
    select jsonb_build_object(
      'dia',             s.dia,
      'emitidas_atual',  s.emit_atual,
      'emitidas_ant',    s.emit_ant,
      'exigem_atual',    s.exigem_atual,
      'exigem_ant',      s.exigem_ant,
      'com_nota_atual',  s.nota_atual,
      'com_nota_ant',    s.nota_ant,
      'cobertura_atual', case when s.exigem_atual > 0 then round(100.0 * s.nota_atual / s.exigem_atual, 1) end,
      'cobertura_ant',   case when s.exigem_ant   > 0 then round(100.0 * s.nota_ant   / s.exigem_ant,   1) end)
    from somado s where s.dia = (select dia_corte from janela)
  )
);
$$;

revoke all on function public.notas_fiscais_ritmo(date) from public, anon;
grant execute on function public.notas_fiscais_ritmo(date) to authenticated, service_role;
