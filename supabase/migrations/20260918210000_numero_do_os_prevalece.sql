-- O número do OS prevalece; o erro dele vira aviso, não substituição.
--
-- A migration 20260918200000 fez a view preferir o recalculado do Hub quando a fórmula do
-- OS dava outro número (divisão truncada). O financeiro reviu no mesmo dia: a tela TEM DE
-- BATER COM O OS, e o que estiver errado lá é avisado ao time do OS — que corrige na
-- fonte. `completarMensal` não troca mais número do OS; a divergência sai em
-- `inconsistenciasDoMes` (tela /indicadores, botão "inconsistências no OS").
--
-- A view continua igual na forma: os_painel_calculado agora só tem o que o OS deixou
-- VAZIO, então o coalesce(c.realizado, p.realizado) nunca cobre número do OS.

comment on view public.os_painel_completo is
  'Painel do Takeat OS completo: o número do OS quando ele existe; o que o Hub calculou (os_painel_calculado, origem hub/hub_parcial/hub_estimado + nota) só onde o OS deixou vazio. O Hub não substitui número do OS — divergência vira item de inconsistência para o time do OS. realizado_os guarda o que o OS gravou.';

comment on table public.os_painel_calculado is
  'Realizado que o Takeat OS deixou VAZIO e o Hub calculou com a fórmula do OS (os-indicadores-calcular, após a cópia diária). Nunca contém número que o OS tenha. origem: hub = fórmula completa; hub_parcial = soma só dos canais que lançaram; hub_estimado = estimativa (CAC MKT, churn de Ativação). Ver migrations 20260918180000 e 20260918210000.';
