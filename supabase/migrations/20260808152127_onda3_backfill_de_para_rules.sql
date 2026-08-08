-- ============================================================
-- ONDA 3 - BACKFILL (secao 8.3). Unico bloco que escreve dado de negocio.
-- Idempotente pelo nome da regra. Nao apaga a origem.
-- ============================================================

insert into public.regras_decisao (escopo, nome, descricao, condicao, acao,
                                   alcada_resultante, origem, ativa)
select
  'categorizacao',
  'de_para: ' || coalesce(r.keyword, r.id::text),
  coalesce(r.observacao, 'Migrada de de_para_rules em ' || current_date),
  jsonb_strip_nulls(jsonb_build_object(
    'keyword',            r.keyword,
    'tipo',               r.tipo,
    'cliente_fornecedor', r.cliente_fornecedor
  )),
  jsonb_strip_nulls(jsonb_build_object(
    'categoria',    r.categoria,
    'centro_custo', r.centro_custo,
    'conta',        r.conta
  )),
  'amarelo',   -- toda regra migrada comeca em amarelo, sem excecao
  'migrada',
  true
from public.de_para_rules r
where not exists (
  select 1 from public.regras_decisao d
  where d.nome = 'de_para: ' || coalesce(r.keyword, r.id::text)
);

comment on table public.de_para_rules is
  'DEPRECIADA. Substituida por public.regras_decisao. Mantida ate confirmar que nenhum fluxo n8n a le.';
comment on table public.omie_reclassificacoes_regras is
  'DEPRECIADA. Substituida por public.regras_decisao.';;
