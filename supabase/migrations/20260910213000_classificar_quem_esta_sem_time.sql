-- CLASSIFICAR QUEM ESTÁ SEM TIME, EM UMA IDA SÓ.
--
-- São 99 fichas para atribuir. Um `update` por pessoa seriam 99 requisições, e
-- um `upsert` pelo PostgREST exigiria mandar a linha INTEIRA de volta (`chave` e
-- `nome` são obrigatórios no insert) — o que transforma uma classificação em
-- reescrita, com o risco de devolver ao banco uma cópia velha do que estava lá.
--
-- Esta função recebe o mapa `{ "<id>": "<setor>" }` e só toca a coluna `setor`.
-- É DEFINER para poder escrever, e por isso a permissão é a primeira linha do
-- corpo: quem classifica é quem responde pela folha inteira.

create or replace function public.remuneracao_classificar(p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if not public.pode_ver_remuneracao() then
    raise exception 'sem permissão para classificar o time de alguém';
  end if;

  with alvo as (
    -- `#>> '{}'` extrai o texto de um valor jsonb escalar sem as aspas; `value`
    -- direto traria "Suporte" com elas e o setor nunca casaria com nada.
    select (chave)::uuid as id, nullif(btrim(valor #>> '{}'), '') as setor
      from jsonb_each(coalesce(p_itens, '{}'::jsonb)) as t(chave, valor)
  )
  update public.remuneracao_pessoa p
     set setor = a.setor, atualizado_em = now()
    from alvo a
   where p.id = a.id
     -- Não escreve o que já está escrito: `atualizado_em` deve dizer quando o
     -- time mudou, não quando alguém abriu a fila e clicou em salvar.
     and p.setor is distinct from a.setor;

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.remuneracao_classificar(jsonb) from public, anon;
grant execute on function public.remuneracao_classificar(jsonb) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.remuneracao_classificar(jsonb)', 'EXECUTE') then
    raise exception 'remuneracao_classificar continua aberta para anon';
  end if;
end $$;
