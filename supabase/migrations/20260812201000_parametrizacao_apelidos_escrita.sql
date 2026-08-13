-- Parametrização, parte 2: escrever pela porta antiga.
--
-- A migration anterior transformou `contrapartes_pessoas` (tabela vazia) em view
-- sobre `lib_fornecedores.apelido`. Ler continuou funcionando sozinho — mas
-- `salvarPessoaPJ`/`removerPessoaPJ` (`src/hooks/usePessoasPJ.ts`) fazem INSERT,
-- UPDATE e DELETE, e view não aceita escrita sem quem a traduza.
--
-- Poderia ter reescrito os dois chamadores. O gatilho é melhor porque a promessa
-- feita foi "um cadastro só": o ícone de pessoa no balãozinho da DRE, a aba da
-- Biblioteca e a página de Parametrização passam a gravar todos no MESMO lugar,
-- sem que nenhum deles precise saber disso.
--
-- DELETE aqui APAGA O APELIDO, não o fornecedor. Tirar "Dalber" do de-para não
-- pode sumir com um cadastro que a Biblioteca, o Facilities e o contexto da IA
-- também usam.

create or replace function public.contrapartes_pessoas_escrever()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  uuid;
  v_doc text := nullif(regexp_replace(coalesce(new.documento, ''), '\D', '', 'g'), '');
begin
  if tg_op = 'DELETE' then
    update public.lib_fornecedores
       set apelido = null, o_que_e = null, atualizado_em = now()
     where id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    update public.lib_fornecedores
       set apelido       = nullif(btrim(new.pessoa), ''),
           o_que_e       = new.observacao,
           atualizado_em = now()
     where id = old.id;
    return new;
  end if;

  -- INSERT. O documento manda quando existe: é identidade de verdade, e o nome
  -- é o que sobra (sempre é o caso do cartão, que não tem CNPJ nenhum).
  if v_doc is not null then
    select f.id into v_id
      from public.lib_fornecedores f
     where regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') = v_doc
     limit 1;
  end if;

  if v_id is null then
    select f.id into v_id
      from public.lib_fornecedores f
     where upper(btrim(f.nome)) = upper(btrim(new.nome))
     limit 1;
  end if;

  -- Grafia que ainda não existe no cadastro: nasce fornecedor novo. `origem` diz
  -- que não veio de sync nenhum — foi alguém que digitou.
  if v_id is null then
    insert into public.lib_fornecedores (nome, documento, apelido, o_que_e, origem)
    values (btrim(new.nome), nullif(btrim(new.documento), ''),
            nullif(btrim(new.pessoa), ''), new.observacao, 'manual')
    returning id into v_id;
  else
    update public.lib_fornecedores
       set apelido       = nullif(btrim(new.pessoa), ''),
           o_que_e       = coalesce(new.observacao, o_que_e),
           atualizado_em = now()
     where id = v_id;

    -- Chegou escrito diferente do cadastro? Guarda a grafia, e o mesmo apelido
    -- passa a valer para as duas — é o que impede o mesmo fornecedor de pedir
    -- apelido de novo na próxima fatura, escrito de outro jeito.
    -- `alias_norm` é coluna gerada: informá-la é erro, não redundância.
    insert into public.contrapartes_alias (fornecedor_id, alias, fonte, documento_norm, origem)
    select v_id, btrim(new.nome), 'manual', v_doc, 'manual'
     where upper(btrim(new.nome)) <> (select upper(btrim(f.nome)) from public.lib_fornecedores f where f.id = v_id)
       and not exists (
         select 1 from public.contrapartes_alias a
          where a.fornecedor_id = v_id and upper(btrim(a.alias)) = upper(btrim(new.nome))
       );
  end if;

  new.id := v_id;
  return new;
end;
$$;

comment on function public.contrapartes_pessoas_escrever() is
  'Traduz escrita na view contrapartes_pessoas para lib_fornecedores.apelido. DELETE limpa o apelido, não o fornecedor.';

drop trigger if exists contrapartes_pessoas_escrever_trg on public.contrapartes_pessoas;

create trigger contrapartes_pessoas_escrever_trg
  instead of insert or update or delete on public.contrapartes_pessoas
  for each row execute function public.contrapartes_pessoas_escrever();

revoke all on function public.contrapartes_pessoas_escrever() from public, anon;

grant insert, update, delete on public.contrapartes_pessoas to authenticated;
revoke all on public.contrapartes_pessoas from anon;
grant select, insert, update, delete on public.contrapartes_pessoas to service_role;
