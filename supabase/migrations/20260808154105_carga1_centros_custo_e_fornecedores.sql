-- ============================================================
-- CARGA 1 - lib_centros_custo (item 11) e lib_fornecedores (item 1)
-- Fonte: orcamento_area_linha + omie_cache('clientes'/'movimentos'). Sem API.
-- Idempotente: so insere o que ainda nao existe.
-- ============================================================

-- ---------- 1.1 Centros de custo: as 6 areas do orcamento ----------
insert into public.lib_centros_custo (codigo, nome, descricao, departamento_id, ativo)
select v.codigo, v.nome,
       'Derivado de orcamento_area_linha (area "' || v.area || '").',
       d.id, true
from (values
  ('COM', 'Comercial',       'Comercial',       'Comercial'),
  ('ADM', 'Corporativo/Adm', 'Corporativo/Adm', 'Administrativo'),
  ('MKT', 'Marketing',       'Marketing',       'Marketing'),
  ('NOV', 'Novos Canais',    'Novos Canais',    'Novos Canais'),
  ('OPE', 'Operações',       'Operações',       'Operações'),
  ('TEC', 'Tecnologia',      'Tecnologia',      'Tecnologia')
) v(codigo, nome, area, departamento)
left join public.lib_departamentos d on d.nome = v.departamento
where not exists (select 1 from public.lib_centros_custo x where x.codigo = v.codigo);


-- ---------- 1.2 Fornecedores: contrapartes de contas a pagar, uma linha por CNPJ ----------
with cli as (
  select distinct on (c->>'codigo')
    c->>'codigo' as codigo,
    -- mesma limpeza de nome que demonstracoes_lancamentos ja aplica, + entidades HTML
    replace(replace(replace(replace(
      coalesce(nullif(btrim(regexp_replace(
        regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
        '\s+\d{11}$', '')), ''), c->>'nome'),
      '&amp;','&'), '&quot;','"'), '&#39;',''''), '&nbsp;',' ') as nome,
    c->>'cnpj_cpf' as doc,
    nullif(regexp_replace(coalesce(c->>'cnpj_cpf',''),'[^0-9]','','g'),'') as dn
  from public.omie_cache, lateral jsonb_array_elements(dados) c
  where chave = 'clientes'
  order by c->>'codigo'
), cap as (
  select e->'detalhes' as det
  from public.omie_cache, jsonb_array_elements(dados) e
  where chave = 'movimentos' and e->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
), alvo as (
  select cli.dn, cli.codigo, cli.nome, cli.doc, count(*) as titulos
  from cap join cli on cli.codigo = cap.det->>'nCodCliente'
  where cli.dn is not null and cli.dn <> '00000000000' and length(cli.dn) in (11,14)
  group by 1,2,3,4
), melhor as (
  -- uma linha por CNPJ: vence o cadastro Omie com mais titulos
  select distinct on (dn) dn, codigo, nome, doc, titulos
  from alvo order by dn, titulos desc, codigo
)
insert into public.lib_fornecedores (nome, documento, omie_id, status, observacao)
select m.nome, m.doc, m.codigo, 'ativo',
       'Importado do Omie (cadastro ' || m.codigo || ') em ' || current_date ||
       '. Contraparte de ' || m.titulos || ' titulo(s) a pagar.'
from melhor m
where not exists (
  select 1 from public.lib_fornecedores f where f.documento_norm = m.dn
);;
