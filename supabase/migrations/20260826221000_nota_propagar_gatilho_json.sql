-- O gatilho lê o `cod_titulo` pelo JSON da linha, não pelo nome do campo.
--
-- O DEFEITO. O gatilho servia quatro tabelas com nomes de coluna diferentes
-- (`omie_cod_titulo` em três, `cod_titulo` no Drive) e escolhia com um CASE:
--
--   v_cod := case tg_table_name
--              when 'comprovantes_drive' then new.cod_titulo::text
--              else new.omie_cod_titulo::text end;
--
-- No plpgsql isso NÃO funciona: a expressão inteira é compilada contra a linha
-- de gatilho, e o ramo não tomado também precisa existir. Disparando pela
-- `auditoria_cartao_lancamentos`, quebrava em
--
--   ERROR 42703: record "new" has no field "cod_titulo"
--
-- e derrubava a escrita que o disparou — ou seja, anexar comprovante no cartão
-- passaria a falhar. Apareceu na primeira varredura; se tivesse aparecido só em
-- produção, teria aparecido como "não consigo anexar a nota".
--
-- O CONSERTO: `to_jsonb(new)` transforma a linha num objeto e a busca vira por
-- CHAVE, que simplesmente não existe quando não existe. Tabela nova com outro
-- nome de coluna entra no `coalesce` sem tocar em mais nada.

create or replace function public.nota_propagar_gatilho()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cod text; v_linha jsonb;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_linha := to_jsonb(new);
  v_cod := coalesce(v_linha->>'omie_cod_titulo', v_linha->>'cod_titulo');
  if v_cod is not null and v_cod ~ '^\d+$' then
    perform public.nota_propagar(v_cod);
  end if;
  return null;
end;
$$;
