-- O "sensível" do Takeat OS passa a valer também para o que DEPENDE dele.
--
-- O OS marca só Margem de Contribuição e LTV. LTV/CAC e CAC Payback são calculados com
-- eles, e LTV/CAC × CAC (que é aberto) devolve o LTV. A Edge Function
-- os-indicadores-calcular grava `sensivel` já herdado em os_painel_calculado
-- (idsSensiveis, em _shared/indicadores-os-calculo.ts); a view precisa dar preferência a
-- essa marca — antes o coalesce pegava o `false` da linha do OS e o Assistente, que roda
-- com service role e recorta por esta coluna, mostrava LTV/CAC a quem não vê a DRE.

create or replace view public.os_painel_completo
with (security_invoker = true) as
select
  coalesce(p.indicator_id, c.indicator_id)     as indicator_id,
  coalesce(p.departamento, c.departamento)     as departamento,
  coalesce(p.canal, c.canal)                   as canal,
  coalesce(p.indicador, c.indicador)           as indicador,
  coalesce(p.unidade, c.unidade)               as unidade,
  coalesce(p.sensivel, false) or coalesce(c.sensivel, false) as sensivel,
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
