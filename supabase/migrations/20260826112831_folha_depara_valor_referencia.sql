-- Valor de referência por pessoa, para a prévia comparar o RH contra a folha
-- anterior. Separada da migration das tabelas porque foi assim que entrou em
-- produção — o repo espelha o que o banco tem, não uma versão arrumadinha.

/* ------------------------------------------------------------------ */
/* Valor de referência                                                 */
/* ------------------------------------------------------------------ */

-- O último salário que a folha realmente pagou, para a prévia comparar.
--
-- Existe por um caso real: em 26/08/2026 o espelho do RH trazia R$ 24.000 para
-- quem a folha de julho pagou R$ 2.400 — um dígito a mais no cadastro. Eram 23
-- divergências, e o TOTAL das duas folhas quase empatava (490.294 contra
-- 489.460), porque os erros se cancelavam. Conferir o total não pega nada
-- disso; conferir linha a linha, sim.
--
-- Semeado com a folha de julho/2026 e reescrito a cada provisionamento, então
-- a comparação passa a ser sempre contra o mês anterior de verdade.
alter table public.folha_depara
  add column if not exists valor_referencia numeric(14,2),
  add column if not exists valor_referencia_competencia date;

comment on column public.folha_depara.valor_referencia is
  'Último valor mensal efetivamente provisionado. A prévia compara o RH contra ele.';
