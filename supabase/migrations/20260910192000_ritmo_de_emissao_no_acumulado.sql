/* ---------------------------------------------------------------------------
 * RITMO DE EMISSÃO — sempre no acumulado até aquele dia.
 *
 * A PERGUNTA QUE ISTO RESPONDE, feita em 09/09/2026: "senti que poucas notas
 * saíram hoje". A resposta daquele dia — 147 autorizadas, contra 130 na véspera
 * e 540 no dia 3 — mostrou que a comparação certa não é com ontem. A emissão é
 * sazonal dentro do mês porque o vencimento é: setembro recebeu 105, 96, 82 e 97
 * cobranças nos dias 1 a 4 e depois 13, 4 e 16 no fim de semana. Um dia isolado
 * não diz nada; o dia 9 de setembro contra o dia 9 de agosto diz.
 *
 * POR QUE ACUMULADO E NÃO DIÁRIO. Duas séries diárias postas lado a lado sobem e
 * descem por causa de fim de semana, feriado e represamento de fila, e a leitura
 * vira adivinhação. No acumulado, a distância entre as duas linhas É a resposta:
 * uma acima da outra significa que este mês está adiantado, e o tamanho do vão
 * é de quantas notas. Foi a decisão do financeiro, e ela vale para as três
 * séries daqui.
 *
 * SÃO DUAS PERGUNTAS DIFERENTES, e por isso duas séries e não uma:
 *
 *   • `emitidas` — quantas NFS-e a nossa esteira autorizou. É a produção do
 *     motor: sobe quando emitimos, cai quando ele trava.
 *   • `cobertura` — que fração das cobranças que EXIGEM nota já tem uma, de
 *     qualquer origem (Omie ou Asaas). É a que corrige volume de venda: um mês
 *     que vendeu menos emite menos sem estar pior, e só a cobertura enxerga isso.
 *     É a mesma escolha do `sinal_cobertura_notas` — cobertura, não contagem.
 *
 * `nao_exige` fica fora do denominador de propósito: cobrança pendente, vencida
 * ou cancelada não devia ter nota, e contá-la faria o começo do mês parecer
 * descoberto todo mês.
 * ------------------------------------------------------------------------- */

create or replace function public.notas_fiscais_ritmo(p_mes date default null)
returns jsonb
language sql stable security invoker set search_path = public
set statement_timeout to '25s'
as $$
with ref as (
  select date_trunc('month', coalesce(p_mes, current_date))::date as ini_atual
),
janela as (
  select ini_atual,
         (ini_atual + interval '1 month - 1 day')::date            as fim_atual,
         (ini_atual - interval '1 month')::date                    as ini_ant,
         (ini_atual - interval '1 day')::date                      as fim_ant,
         /* O CORTE DO MÊS CORRENTE. Sem ele a linha de setembro desceria até o
            dia 30 desenhando um platô que é só ausência de futuro, e pareceria
            estagnação. Mês passado vai até o fim; mês corrente para hoje. */
         case when date_trunc('month', current_date)::date = ini_atual
              then extract(day from current_date)::int
              else extract(day from (ini_atual + interval '1 month - 1 day'))::int
         end as dia_corte
  from ref
),
-- A produção da esteira: OS do Omie com RPS autorizado, pelo dia em que faturou.
emit as (
  select (case when o.data_faturamento >= j.ini_atual then 'atual' else 'anterior' end) as mes,
         extract(day from o.data_faturamento)::int as dia,
         count(*)::int as n
  from public.nf_os_omie o, janela j
  where o.cancelada = false and o.nfse_status = '004'
    and o.data_faturamento between j.ini_ant and j.fim_atual
  group by 1, 2
),
-- A cobertura: o painel já cruza cobrança × OS × nota do Asaas; aqui só se soma.
pain as (
  select 'atual' as mes,
         extract(day from coalesce(p.data_pagamento, p.data_vencimento))::int as dia,
         count(*) filter (where p.situacao <> 'nao_exige')::int as exigem,
         count(*) filter (where p.situacao in ('emitida_omie','emitida_asaas'))::int as com_nota,
         coalesce(sum(p.valor) filter (where p.situacao <> 'nao_exige'), 0) as valor_exigem
  from janela j, public.notas_fiscais_painel(j.ini_atual, j.fim_atual) p
  group by 1, 2
  union all
  select 'anterior',
         extract(day from coalesce(p.data_pagamento, p.data_vencimento))::int,
         count(*) filter (where p.situacao <> 'nao_exige')::int,
         count(*) filter (where p.situacao in ('emitida_omie','emitida_asaas'))::int,
         coalesce(sum(p.valor) filter (where p.situacao <> 'nao_exige'), 0)
  from janela j, public.notas_fiscais_painel(j.ini_ant, j.fim_ant) p
  group by 1, 2
),
dias as (select generate_series(1, 31) as dia),
somado as (
  select d.dia,
         /* `sum(...) over (order by dia)` é o acumulado, e o `coalesce` dentro
            dele é obrigatório: dia sem movimento tem linha ausente, não zero, e
            sem o zero a janela pula o dia e a curva ganha degrau. */
         sum(coalesce(ea.n, 0))        over (order by d.dia) as emit_atual,
         sum(coalesce(eb.n, 0))        over (order by d.dia) as emit_ant,
         sum(coalesce(pa.exigem, 0))   over (order by d.dia) as exigem_atual,
         sum(coalesce(pb.exigem, 0))   over (order by d.dia) as exigem_ant,
         sum(coalesce(pa.com_nota, 0)) over (order by d.dia) as nota_atual,
         sum(coalesce(pb.com_nota, 0)) over (order by d.dia) as nota_ant
  from dias d
  left join emit ea on ea.mes = 'atual'    and ea.dia = d.dia
  left join emit eb on eb.mes = 'anterior' and eb.dia = d.dia
  left join pain pa on pa.mes = 'atual'    and pa.dia = d.dia
  left join pain pb on pb.mes = 'anterior' and pb.dia = d.dia
)
select jsonb_build_object(
  'mes_atual',    to_char((select ini_atual from janela), 'YYYY-MM'),
  'mes_anterior', to_char((select ini_ant   from janela), 'YYYY-MM'),
  'dia_corte',    (select dia_corte from janela),
  'serie', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dia', s.dia,
      -- Depois do corte a série do mês corrente é NULL, não 0: a linha do
      -- Recharts precisa PARAR, e zero desenharia uma queda a pique.
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
  /* O PLACAR: os dois meses no MESMO dia. É o número que responde a pergunta
     sem que ninguém precise ler o gráfico — e o mês passado é lido no dia de
     corte do mês corrente, nunca no fechamento dele, senão a comparação seria
     de nove dias contra trinta e um. */
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

comment on function public.notas_fiscais_ritmo(date) is
  'Ritmo de emissão do mês contra o anterior, sempre no acumulado até cada dia: notas autorizadas pela esteira e cobertura das cobranças que exigem nota. O placar "hoje" lê o mês passado no MESMO dia do mês, não no fechamento.';

revoke all on function public.notas_fiscais_ritmo(date) from public, anon;
grant execute on function public.notas_fiscais_ritmo(date) to authenticated, service_role;
