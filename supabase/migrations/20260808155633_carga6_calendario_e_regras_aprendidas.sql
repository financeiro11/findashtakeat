-- ============================================================
-- CARGA 6 - calendario_financeiro (item 17) e regras_decisao (item 14, parte derivavel)
-- Calendario: so datas com fonte verificavel no Hub (automacoes_catalogo 13/18/23
--   + crons mensais do Supabase). Os "cortes de caixa 15/20/25" NAO entram:
--   a fonte e uma skill fora do Hub. Decisao do Henrique.
-- Regras: um por fornecedor com categoria 100% consistente e >= 3 titulos.
--   Todas nascem amarelas e com contador zerado.
-- ============================================================

-- ---------- 6.1 Calendario financeiro ----------
insert into public.calendario_financeiro
  (evento, descricao, regra_data, dia, antecedencia_dias, responsavel_id, agente_dono, automacao_id, ativo)
select v.evento, v.descricao, v.regra_data, v.dia, 0, resp.id, 'humano', aut.id, true
from (values
  ('Solicitar extratos bancarios aos gerentes de conta',
   'Todo inicio de mes. Origem: automacao 13 do catalogo ("Solicitador automatico de Extratos").',
   'dia_fixo', 1, 13, 'Julia Paulino Rocon'),
  ('Solicitar extrato das aplicacoes Sicoob',
   'Todo dia 1o. Origem: automacao 18 do catalogo ("Email Automatico <> Aplicacoes Sicoob").',
   'dia_fixo', 1, 18, 'Henrique dos Anjos Moura'),
  ('Solicitar aumento de limite Sicoob (5o dia util)',
   'Origem: automacao 23 do catalogo. O texto cita "todo 5o dia util e dia 15".',
   'dia_util', 5, 23, 'Henrique dos Anjos Moura'),
  ('Solicitar aumento de limite Sicoob (dia 15)',
   'Origem: automacao 23 do catalogo. Segunda data do mesmo lembrete.',
   'dia_fixo', 15, 23, 'Henrique dos Anjos Moura'),
  ('Snapshot de capital de giro',
   'Cron omie-capital-giro-sync-mensal do Supabase, dia 5 as 12h UTC.',
   'dia_fixo', 5, null, 'Henrique dos Anjos Moura'),
  ('Sync mensal de assinaturas',
   'Cron assinaturas-sheet-sync-mensal do Supabase, dia 2 as 12h UTC. Apenas a data do ciclo.',
   'dia_fixo', 2, null, 'Henrique dos Anjos Moura')
) v(evento, descricao, regra_data, dia, ordem_automacao, responsavel)
left join public.automacoes_catalogo aut on aut.ordem = v.ordem_automacao
left join public.lib_colaboradores  resp on resp.nome = v.responsavel
where not exists (select 1 from public.calendario_financeiro x where x.evento = v.evento);


-- ---------- 6.2 Regras de categorizacao aprendidas ----------
with base as (
  select fornecedor_id, categoria_codigo, count(*) as n
  from public.omie_titulos
  where tipo = 'pagar' and fornecedor_id is not null
    and status <> 'cancelado' and categoria_codigo is not null
  group by 1,2
), consistente as (
  select fornecedor_id, min(categoria_codigo) as categoria_codigo, sum(n) as titulos
  from base group by fornecedor_id
  having count(*) = 1 and sum(n) >= 3
), cat as (
  select c->>'codigo' as codigo, c->>'descricao' as descricao
  from public.omie_cache, lateral jsonb_array_elements(dados) c where chave = 'categorias'
)
insert into public.regras_decisao
  (escopo, nome, descricao, fornecedor_id, condicao, acao, alcada_resultante, origem, ativa)
select
  'categorizacao',
  'auto: ' || f.nome,
  'Derivada de ' || k.titulos || ' titulos a pagar, 100% na mesma categoria. '
    || 'Nasce amarela: precisa de liberacao humana ate acumular historico de acerto.',
  f.id,
  jsonb_strip_nulls(jsonb_build_object(
    'documento_norm', f.documento_norm,
    'fornecedor',     f.nome,
    'valor_min',      f.valor_min,
    'valor_max',      f.valor_max
  )),
  jsonb_strip_nulls(jsonb_build_object(
    'categoria_codigo',    k.categoria_codigo,
    'categoria_descricao', cat.descricao,
    'centro_custo',        lcc.codigo
  )),
  'amarelo',
  'aprendida',
  true
from consistente k
join public.lib_fornecedores f on f.id = k.fornecedor_id
left join cat on cat.codigo = k.categoria_codigo
left join public.lib_centros_custo lcc on lcc.id = f.centro_custo_id
where not exists (
  select 1 from public.regras_decisao d where d.nome = 'auto: ' || f.nome
);;
