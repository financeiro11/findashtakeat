-- Do memo do OFX para o título do Omie.
--
-- O drill-down da DRE trabalha com `cod_titulo`; o comprovante do Drive casa com
-- uma linha de `cartao_lancamentos`. A ponte entre os dois já existia e é
-- textual: `cartao_lancamentos.descricao` guarda o MEMO CRU do OFX, e o Omie
-- cola esse mesmo memo na observação do título, depois de um `|`.
--
-- Recebe os memos casados de uma vez (uma ida ao banco em vez de 144) e devolve
-- o par. Sem isto a Edge Function teria de baixar `omie_titulo_texto` inteiro.

create or replace function public.titulos_por_memo(p_memos text[])
returns table (memo text, cod_titulo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.memo, min(t.cod_titulo::text) as cod_titulo
  from unnest(p_memos) as m(memo)
  join public.omie_titulo_texto t
    -- `(?s)` porque há quebra de linha antes do `|`, e `.*` guloso pega o
    -- ÚLTIMO, igual ao `lastIndexOf` do `memoDaObservacao`.
    on regexp_replace(coalesce(t.observacao, ''), '(?s)^.*\|', '') = m.memo
  where coalesce(t.observacao, '') <> ''
  group by m.memo
  -- Memo que aponta para dois títulos não serve de ponte: o comprovante
  -- ficaria colado num deles por sorteio.
  having count(distinct t.cod_titulo) = 1;
$$;

comment on function public.titulos_por_memo(text[]) is
  'Memo do OFX -> cod_titulo do Omie, pelo texto da observação. Memo ambíguo (2+ títulos) não volta.';

revoke all on function public.titulos_por_memo(text[]) from public, anon;
grant execute on function public.titulos_por_memo(text[]) to authenticated, service_role;
