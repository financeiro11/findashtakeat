-- ============================================================
-- CARGA 4 - contrapartes_alias (item 3 do inventario)
-- REGRA DA SECAO 11.2: so match exato por CNPJ. Nunca por similaridade de nome.
-- Fontes usadas: cadastros alternativos do Omie + sicoob_extrato (CNPJ extraido
-- do proprio texto da contraparte). Asaas fora por decisao do Henrique.
-- Cartao NAO entra: cartao_lancamentos nao tem CNPJ, so nome de lojista.
-- ============================================================

-- ---------- 4.1 Nomes alternativos do mesmo CNPJ no cadastro do Omie ----------
with cli as (
  select distinct on (c->>'codigo') c->>'codigo' as codigo,
    replace(replace(replace(
      coalesce(nullif(btrim(regexp_replace(
        regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
        '\s+\d{11}$', '')), ''), c->>'nome'),
      '&amp;','&'), '&quot;','"'), '&#39;','''') as nome,
    nullif(regexp_replace(coalesce(c->>'cnpj_cpf',''),'[^0-9]','','g'),'') as dn
  from public.omie_cache, lateral jsonb_array_elements(dados) c
  where chave = 'clientes' order by c->>'codigo'
), cand as (
  select distinct on (upper(btrim(regexp_replace(cli.nome,'[[:space:]]+',' ','g'))))
         f.id as fornecedor_id, cli.nome as alias, cli.dn
  from cli join public.lib_fornecedores f on f.documento_norm = cli.dn
  where upper(btrim(cli.nome)) <> upper(btrim(f.nome))
  order by upper(btrim(regexp_replace(cli.nome,'[[:space:]]+',' ','g'))), f.id
)
insert into public.contrapartes_alias (fornecedor_id, alias, fonte, documento_norm, confianca, origem)
select cand.fornecedor_id, cand.alias, 'omie_titulo', cand.dn, 1.0, 'aprendido'
from cand
on conflict (alias_norm, fonte) do nothing;


-- ---------- 4.2 Grafia do extrato Sicoob (CNPJ vem dentro do texto) ----------
with s as (
  select btrim(contraparte_nome) as alias,
         coalesce(
           regexp_replace((regexp_match(contraparte_nome,'\d{2}\.\d{3}\.\d{3}[ /]\d{4}-\d{2}'))[1],'[^0-9]','','g'),
           regexp_replace((regexp_match(contraparte_nome,'\d{3}\.\d{3}\.\d{3}-\d{2}'))[1],'[^0-9]','','g')
         ) as dn
  from public.sicoob_extrato
  where contraparte_nome is not null and btrim(contraparte_nome) <> ''
), cand as (
  select distinct on (upper(btrim(regexp_replace(s.alias,'[[:space:]]+',' ','g'))))
         f.id as fornecedor_id, s.alias, s.dn
  from s join public.lib_fornecedores f on f.documento_norm = s.dn
  where s.dn is not null
  order by upper(btrim(regexp_replace(s.alias,'[[:space:]]+',' ','g'))), f.id
)
insert into public.contrapartes_alias (fornecedor_id, alias, fonte, documento_norm, confianca, origem)
select cand.fornecedor_id, cand.alias, 'sicoob', cand.dn, 1.0, 'aprendido'
from cand
on conflict (alias_norm, fonte) do nothing;;
