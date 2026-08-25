-- Quem é o CNPJ do extrato — pelo cadastro da Parametrização e pelo do Omie.
--
-- O Pix de SAÍDA do Sicoob não tem nome nenhum: `contraparte_nome` vem
-- "Pagamento Pix|@46.235.634 0001-24|@", só o rótulo da operação e o documento.
-- São 603 lançamentos assim num mês. Quem sabe traduzir documento em nome é
-- cadastro — e há dois: `lib_fornecedores` (Configurações › Parametrização, onde
-- a contraparte ganha APELIDO) e o cadastro do Omie, que a Edge Function
-- `omie-clientes-sync` guarda em `omie_cache` na chave "clientes" (~7.000
-- linhas, contra as ~300 do primeiro).
--
-- POR QUE UMA FUNÇÃO E NÃO UM SELECT DA TELA: `omie_cache` está com RLS ligado
-- e ZERO policy. Para `authenticated` isso não é erro nem negação — é zero
-- linha, calada. A tela concluiria que o Omie não conhece ninguém. Daí
-- `security definer`, com `search_path` fixo, `stable`, sem SQL dinâmico e sem
-- execute para `anon`. Abrir a tabela com uma policy foi descartado porque a
-- mesma tabela guarda os movimentos financeiros (chave = 'movimentos') — largo
-- demais para liberar a leitura de uma chave.
--
-- Recebe os documentos COMO ELES APARECEM no extrato e devolve o mesmo texto em
-- `doc`, para quem chamou casar de volta sem repetir a normalização. `fonte` diz
-- de onde saiu o nome (apelido > cadastro > omie), e é o que permite à tela ser
-- honesta sobre o que é nome interno e o que é razão social do ERP.

create or replace function public.contrapartes_por_documento(p_docs text[])
returns table (doc text, nome text, fonte text, aproximado boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  pedidos as (
    select distinct
      d as doc,
      regexp_replace(coalesce(d, ''), '\D', '', 'g') as dig,
      position('*' in coalesce(d, '')) > 0 as mascarado
    from unnest(coalesce(p_docs, '{}'::text[])) d
    where coalesce(btrim(d), '') <> ''
  ),
  -- Materializado de propósito: são ~7.000 cadastros dentro de um jsonb, e
  -- varrer o array por documento pedido seria quadrático.
  omie as materialized (
    select distinct on (dig) dig, nome
    from (
      select
        regexp_replace(coalesce(c->>'cnpj_cpf', ''), '\D', '', 'g') as dig,
        -- MEI e autônomo vêm da Receita com o documento embutido na razão
        -- social; mesma limpeza do drill-down da DRE (migration 20260803210000).
        replace(replace(replace(replace(
          coalesce(nullif(btrim(regexp_replace(
            regexp_replace(c->>'nome', '^\s*\d{2}\.\d{3}\.\d{3}(/\d{4}-\d{2})?\s+', ''),
            '\s+\d{11}$', '')), ''), c->>'nome'),
          '&amp;', '&'), '&quot;', '"'), '&#39;', ''''), '&nbsp;', ' ') as nome
      from omie_cache, lateral jsonb_array_elements(dados) c
      where chave = 'clientes'
    ) x
    where length(dig) in (11, 14)
      and coalesce(btrim(nome), '') <> ''
    order by dig, nome
  ),
  forn as (
    select
      regexp_replace(coalesce(documento, ''), '\D', '', 'g') as dig,
      nullif(btrim(apelido), '') as apelido,
      nome
    from lib_fornecedores
    -- Sem corte por `status`: "não é fornecedor" tira a linha da FILA da
    -- Parametrização, não do direito de ter nome na tela.
    where length(regexp_replace(coalesce(documento, ''), '\D', '', 'g')) in (11, 14)
  ),
  -- Um candidato por (documento, fonte). A ordem alfabética de `fonte` É a
  -- ordem de preferência: apelido < cadastro < omie.
  cands as (
    select dig,
           coalesce(apelido, nome) as nome,
           case when apelido is not null then 'apelido' else 'cadastro' end::text as fonte
    from forn
    where coalesce(btrim(coalesce(apelido, nome)), '') <> ''
    union all
    select dig, nome, 'omie'::text from omie
  ),
  exato as (
    select distinct on (p.doc) p.doc, c.nome, c.fonte, false as aproximado
    from pedidos p
    join cands c on c.dig = p.dig
    where not p.mascarado
      and length(p.dig) in (11, 14)
    order by p.doc, c.fonte, c.nome
  ),
  -- O banco devolve o CPF de pessoa física mascarado ("***.086.647-**"): sobram
  -- os seis dígitos do meio, que são as posições 4 a 9 do CPF. Dá para achar
  -- quem é — desde que só uma pessoa do cadastro tenha esses seis dígitos.
  parcial as (
    select p.doc, c.dig, c.nome, c.fonte
    from pedidos p
    join cands c on length(c.dig) = 11 and substr(c.dig, 4, 6) = p.dig
    where p.mascarado
      and length(p.dig) = 6
  ),
  parcial_unico as (
    select distinct on (m.doc) m.doc, m.nome, m.fonte, true as aproximado
    from parcial m
    -- Dois CPFs diferentes com os mesmos seis dígitos do meio: melhor nome
    -- nenhum do que o nome errado.
    where (select count(distinct m2.dig) from parcial m2 where m2.doc = m.doc) = 1
    order by m.doc, m.fonte, m.nome
  )
  select * from exato
  union all
  select * from parcial_unico;
$$;

revoke all on function public.contrapartes_por_documento(text[]) from public, anon;
grant execute on function public.contrapartes_por_documento(text[]) to authenticated;

comment on function public.contrapartes_por_documento(text[]) is
  'CPF/CNPJ do extrato -> nome da contraparte (apelido da Parametrização, cadastro local, cadastro do Omie). Ver 20260825160000.';
