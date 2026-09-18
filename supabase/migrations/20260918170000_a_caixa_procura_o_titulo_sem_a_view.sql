-- ---------------------------------------------------------------------------
-- A CAIXA DE NOTAS PROCURA O TÍTULO SEM PASSAR PELA VIEW.
--
-- O achador de título da Caixa (a busca que aparece em cada linha "Sem dono")
-- chamava `cap_notas_titulos` com `p_de = null, p_ate = null`. Dois defeitos:
--
--   1. NUNCA DEVOLVEU NADA. A função filtra `t.competencia between p_de and
--      p_ate`, e `between null and null` é nulo — nenhuma linha passa. A tela
--      dizia "Nenhum lançamento com esse termo" para todo termo, inclusive o
--      CNPJ de um fornecedor que está no CAP.
--   2. CUSTAVA 1,8s MESMO ASSIM. `cap_titulos` é uma view com CTEs
--      MATERIALIZED (ver cap_titulo_resumo, 28/08/2026): monta o contas a pagar
--      inteiro antes de qualquer `where`. Em 18/09/2026 a caixa tinha 99 "sem
--      dono", cada uma disparando a sua busca ao abrir a aba — 99 x 1,8s numa
--      máquina Nano, e as da cauda estouravam o `statement_timeout` de 8s.
--
-- A troca: achar os CÓDIGOS barato (uma passada no jsonb dos movimentos, outra
-- no cadastro, e as tabelas de texto) e só então dar nome a no máximo 60 deles
-- pela `cap_titulo_resumo_interno`, que já é conferida contra a view (apelido e
-- lojista do cartão inclusos). Medido: ~0,19s.
--
-- A busca casa: nº do título; CNPJ/CPF (do movimento ou do cadastro, com ≥ 4
-- dígitos — a mesma trava da `cap_notas_titulos`); nome no cadastro, no
-- favorecido e na observação do título; lojista do cartão; e APELIDO — quem
-- procura "Café dos eventos" acha o título de "JIM.COM GRUPO SOUZA".
-- ---------------------------------------------------------------------------

create or replace function public.caixa_notas_procurar_titulo_interno(p_busca text, p_limite integer default 40)
returns table(cod_titulo bigint, favorecido text, valor numeric, competencia date)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with termo as (
    select btrim(coalesce(p_busca, ''))                          as t,
           regexp_replace(coalesce(p_busca, ''), '\D', '', 'g')  as dig
  ),
  mov as (
    select (((d.value -> 'detalhes') ->> 'nCodTitulo')::bigint)                                  as cod,
           regexp_replace(coalesce((d.value -> 'detalhes') ->> 'cCPFCNPJCliente', ''), '\D', '', 'g') as doc_mov,
           nullif((d.value -> 'detalhes') ->> 'nCodCliente', '')                                 as cod_cliente,
           coalesce(to_date(nullif((d.value -> 'detalhes') ->> 'dDtPagamento', ''), 'DD/MM/YYYY'),
                    to_date(nullif((d.value -> 'detalhes') ->> 'dDtVenc', ''),      'DD/MM/YYYY')) as data
      from public.omie_cache,
           lateral jsonb_array_elements(omie_cache.dados) d
     where omie_cache.chave = 'movimentos'
       and ((d.value -> 'detalhes') ->> 'cGrupo') = 'CONTA_A_PAGAR'
  ),
  cad as (
    select nullif(c.value ->> 'codigo', '')                                    as codigo,
           regexp_replace(coalesce(c.value ->> 'cnpj_cpf', ''), '\D', '', 'g')  as doc,
           nullif(btrim(c.value ->> 'nome'), '')                               as nome
      from public.omie_cache,
           lateral jsonb_array_elements(omie_cache.dados) c
     where omie_cache.chave = 'clientes'
  ),
  ape as (
    select a.chave, a.via
      from public.contraparte_apelido a, termo
     where a.apelido ilike '%' || termo.t || '%'
  ),
  cad_hit as (
    select c.codigo
      from cad c, termo
     where (length(termo.dig) >= 4 and c.doc like '%' || termo.dig || '%')
        or c.nome ilike '%' || termo.t || '%'
        or c.doc in (select chave from ape where via = 'doc')
        or (exists (select 1 from ape where via = 'nome')
            and public.contraparte_chave(c.nome) in (select chave from ape where via = 'nome'))
  ),
  tx_hit as (
    select tx.cod_titulo
      from public.omie_titulo_texto tx, termo
     where tx.favorecido ilike '%' || termo.t || '%'
        or tx.observacao ilike '%' || termo.t || '%'
    union
    select nc.cod_titulo
      from public.omie_titulo_nome_cartao nc, termo
     where nc.lojista ilike '%' || termo.t || '%'
  ),
  cands as (
    select m.cod, max(m.data) as data
      from mov m, termo
     where length(termo.t) >= 3
       and (   m.cod::text = termo.t
            or (length(termo.dig) >= 4 and m.doc_mov like '%' || termo.dig || '%')
            or m.doc_mov in (select chave from ape where via = 'doc')
            or m.cod_cliente in (select codigo from cad_hit)
            or m.cod in (select cod_titulo from tx_hit))
     group by m.cod
  )
  /* O MAIS RECENTE PRIMEIRO, e o teto antes do rótulo: a `cap_titulo_resumo`
     resolve o apelido por lateral e fica cara de novo passando de dezenas. A
     tela reordena por proximidade de valor e data do papel. */
  select r.cod_titulo, r.favorecido, r.valor, r.data as competencia
    from public.cap_titulo_resumo_interno(
           array(select cod from cands
                  order by data desc nulls last
                  limit least(greatest(coalesce(p_limite, 40), 1), 60))) r;
$$;

create or replace function public.caixa_notas_procurar_titulo(p_busca text, p_limite integer default 40)
returns table(cod_titulo bigint, favorecido text, valor numeric, competencia date)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.exigir('conciliacao', 'caixa_notas_procurar_titulo') then return; end if;
  return query select * from public.caixa_notas_procurar_titulo_interno(p_busca, p_limite);
end;
$$;

revoke all on function public.caixa_notas_procurar_titulo_interno(text, integer) from public, anon, authenticated;
revoke all on function public.caixa_notas_procurar_titulo(text, integer) from public, anon;
grant execute on function public.caixa_notas_procurar_titulo(text, integer) to authenticated, service_role;
