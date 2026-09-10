-- A FOLHA FECHA A PORTA DO ANON.
--
-- `revoke execute ... from anon` é a instrução que roda sem erro e não muda
-- nada quando o EXECUTE chega por PUBLIC — e chega, porque toda função nova em
-- `public` neste projeto nasce com a entrada `=X/postgres` no ACL. A varredura
-- em massa de 30/08/2026 fechou ~100 funções; estas cinco nasceram DEPOIS dela,
-- com o painel de Remuneração (03/09) e com o recorte do líder (10/09), e
-- passaram por baixo.
--
-- Medido antes desta migration, com a anon key (que está no bundle do front):
--
--   remuneracao_painel()            anon=true   (era `language sql`: a RLS
--                                                segurava, mas hoje é DEFINER)
--   remuneracao_frescor()           anon=true   devolvia a hora da última carga
--   remuneracao_atualizar()         anon=true   DISPARAVA A CARGA DO OMIE, porque
--                                                a guarda dela é `auth.uid() is
--                                                not null` e anon não tem uid
--   remuneracao_setores()           anon=true
--   pode_ver_remuneracao_do_time()  anon=true
--
-- O `remuneracao_painel` já se defende sozinho desde a migration anterior (sem
-- uid, nenhuma das duas permissões responde e ele levanta exceção). As outras
-- não se defendiam. Fechar o ACL é a trava que não depende de cada função ter
-- lembrado de perguntar.
--
-- Cada revoke em sua própria instrução, e `from public, anon` nos dois — ver a
-- lição das `facilities_nf_*` em 22/08/2026.

revoke all on function public.remuneracao_painel()            from public, anon;
revoke all on function public.remuneracao_frescor()           from public, anon;
revoke all on function public.remuneracao_atualizar()         from public, anon;
revoke all on function public.remuneracao_setores()           from public, anon;
revoke all on function public.pode_ver_remuneracao_do_time()  from public, anon;
revoke all on function public.remuneracao_fundir(uuid, uuid, text) from public, anon;

grant execute on function public.remuneracao_painel()            to authenticated, service_role;
grant execute on function public.remuneracao_frescor()           to authenticated, service_role;
grant execute on function public.remuneracao_atualizar()         to authenticated, service_role;
grant execute on function public.remuneracao_setores()           to authenticated, service_role;
grant execute on function public.pode_ver_remuneracao_do_time()  to authenticated, service_role;
-- `remuneracao_fundir` não vai para `authenticated`: quem funde duas fichas é o
-- financeiro pela rotina, e o ACL dela já era só postgres + service_role.
grant execute on function public.remuneracao_fundir(uuid, uuid, text) to service_role;

/* CONFERIR DE VERDADE, não ler o ACL. `has_function_privilege` é o que responde
   se a anon key abre a porta — o ACL parece fechado e não está sempre que a
   entrada de PUBLIC sobrou. */
do $$
declare
  v_abertas text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_abertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('remuneracao_painel', 'remuneracao_frescor', 'remuneracao_atualizar',
                       'remuneracao_setores', 'pode_ver_remuneracao_do_time', 'remuneracao_fundir')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_abertas is not null then
    raise exception 'ainda abertas para anon: %', v_abertas;
  end if;
end $$;
