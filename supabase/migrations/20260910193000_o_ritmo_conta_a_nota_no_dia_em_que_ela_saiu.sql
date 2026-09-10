/* ---------------------------------------------------------------------------
 * O ritmo conta a nota no dia em que ELA saiu — não no dia da cobrança.
 *
 * DOIS DEFEITOS DA PRIMEIRA VERSÃO, achados ao ler o primeiro resultado
 * (10/09/2026). Os dois davam número plausível, que é o pior tipo de defeito.
 *
 * 1) A COBERTURA COMPARAVA UM MÊS MADURO COM UM MÊS EM CURSO.
 *    O numerador somava a nota no dia da COBRANÇA. Como agosto já teve um mês
 *    para as notas atrasadas saírem e setembro não, a curva de agosto aparecia
 *    inteira no lugar certo e a de setembro aparecia com buraco — 61,3% contra
 *    78,7%, um abismo de 17 pontos que é, em boa parte, só o tempo que ainda não
 *    passou. Agora a nota entra no acumulado no dia em que foi AUTORIZADA
 *    (`data_faturamento` da OS no Omie, `data_efetiva` da nota no Asaas). Assim o
 *    ponto do dia 9 de agosto diz o que se sabia no dia 9 de agosto, que é a
 *    única comparação honesta com o dia 9 de setembro.
 *
 * 2) A SÉRIE `emitidas` NÃO TEM COM QUE COMPARAR AINDA, e dizia isso como se
 *    fosse notícia: 1.607 contra 0. Não é queda nem disparada — a esteira do
 *    Omie só passou a autorizar em **20/08/2026**, então agosto tem zero nos dias
 *    1 a 19 por não existir, e não por ter falhado. Setembro é o primeiro mês
 *    inteiro. O campo `emitidas_ant_confiavel` carrega esse aviso até a tela, em
 *    vez de deixar a interpretação para quem olha o gráfico.
 *
 * A cobertura não sofre do mesmo problema porque conta nota de qualquer origem,
 * e o Asaas emitia normalmente em agosto — ela é a série que compara os dois
 * meses de verdade.
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
/* Cada cobrança do painel com DUAS datas: o dia em que ela entrou (competência,
   que é o eixo do denominador) e o dia em que a nota dela saiu (o eixo do
   numerador). A segunda vem de duas fontes porque as notas vêm de duas: a OS do
   Omie e a nota do Asaas. `least` entre elas resolve o caso raro de existirem as
   duas — vale a que chegou primeiro, que é a que cobriu a cobrança. */
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
         least(os.data_faturamento, nfa.data_efetiva::date) as dia_nota_bruto
  from cru c
  left join public.nf_os_omie os on os.n_cod_os = c.n_cod_os and os.nfse_status = '004'
  left join lateral (
    select max(n.data_efetiva::date) as data_efetiva
    from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = c.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  ) nfa on true
),
/* A nota que saiu ANTES do mês (cliente que paga contra nota) conta no dia 1: ela
   já estava lá quando o mês começou. A que saiu DEPOIS do mês fica fora — dentro
   desta janela ela não existe, e é justamente isso que a curva tem de mostrar. */
pain as (
  select mes,
         dia_cobranca,
         count(*) filter (where exige)::int as exigem
  from datado group by 1, 2
),
cobre as (
  select d.mes,
         greatest(1, least(31, extract(day from d.dia_nota_bruto)::int)) as dia,
         count(*)::int as n
  from datado d, janela j
  where d.exige and d.tem_nota and d.dia_nota_bruto is not null
    and d.dia_nota_bruto <= (case when d.mes = 'atual' then j.fim_atual else j.fim_ant end)
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
/* A esteira do Omie autorizou a primeira nota em 20/08/2026. Comparar setembro
   com um agosto que ainda não existia é comparar com zero e chamar de queda. */
inicio as (
  select min(o.data_faturamento) as primeira
  from public.nf_os_omie o where o.cancelada = false and o.nfse_status = '004'
)
select jsonb_build_object(
  'mes_atual',    to_char((select ini_atual from janela), 'YYYY-MM'),
  'mes_anterior', to_char((select ini_ant   from janela), 'YYYY-MM'),
  'dia_corte',    (select dia_corte from janela),
  'esteira_desde', (select primeira from inicio),
  'emitidas_ant_confiavel', (select primeira from inicio) <= (select ini_ant from janela),
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
