-- O número do Hub passa a prevalecer quando o do OS está errado.
--
-- A memória de cálculo (18/09/2026) mostrou que o Takeat OS grava as fórmulas com divisão
-- TRUNCADA: Taxa de Conversão do Inside Sales de ago/26 = 6,56% pela fórmula dele, 0 no
-- banco; Leads por Parceiro 1,63 vira 1 — 46 casos só em mai–ago/26. Decisão do
-- financeiro: o Hub recalcula e mostra o certo. `completarMensal` (em
-- _shared/indicadores-os-calculo.ts) refaz cada fórmula pronta do OS e, se divergir,
-- grava o recalculado em os_painel_calculado com origem 'hub' e o valor do OS na nota.
--
-- Até aqui a view preferia o OS sempre que ele tinha número (coalesce(p.realizado, …)),
-- e a correção não chegaria ao Assistente nem à Revisão. Agora linha calculada vence:
-- ela só existe quando o OS deixou vazio OU quando o Hub provou que o OS errou.

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
  coalesce(c.realizado, p.realizado)           as realizado,
  case when c.indicator_id is not null then c.origem else 'os' end as origem,
  c.nota                                       as nota,
  p.realizado                                  as realizado_os
from public.os_painel_mensal p
full join public.os_painel_calculado c
  on c.indicator_id = p.indicator_id and c.competencia = p.competencia;

comment on view public.os_painel_completo is
  'Painel do Takeat OS completo: o que o Hub calculou (os_painel_calculado) vence — ele só existe quando o OS deixou vazio ou errou a conta (divisão truncada); senão, o número do OS. realizado_os guarda o que o OS gravou, para auditoria.';
