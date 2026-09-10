-- QUEM PERGUNTA PELA IA TAMBÉM TEM DE SER CONFERIDO.
--
-- A migration anterior fechou as três funções da DRE com `pode_ver_remuneracao()`.
-- Isso resolve a chamada que vem do NAVEGADOR — mas três Edge Functions chamam as
-- mesmas funções com a SERVICE ROLE, onde `auth.uid()` é nulo e
-- `pode_ver_remuneracao()` devolve `false` para todo mundo:
--
--   assistente-responder    → a bolinha da IA (`lancamentosDaRubrica`,
--                             `contrapartesComparadas`)
--   demonstracoes-perguntar → o chat da célula da DRE
--   demonstracoes-justificar→ a redação das justificativas
--
-- Do jeito que ficou, o Assistente esconderia a folha até do financeiro. E, pior,
-- é por aí que o vazamento voltaria: a Liderança tem a capacidade `assistente`, e
-- perguntar "quem puxou a Equipe Comercial em julho?" recebia contraparte por
-- contraparte, com valor. Esconder a lista na tela e mandá-la pela boca da IA
-- seria trocar a porta da frente pela dos fundos.
--
-- A saída é o parâmetro `p_com_folha`: quem chama com a service role sabe quem
-- perguntou e passa a resposta adiante.
--
-- **O PARÂMETRO SÓ VALE SEM USUÁRIO.** Vindo de uma sessão ele é ignorado —
-- senão bastaria mandar `p_com_folha => true` pelo PostgREST com a própria conta
-- para abrir a folha inteira, e o cadeado viraria enfeite.

create or replace function public.demonstracoes_lancamentos(
  p_tipo text, p_rubrica text, p_mes text, p_com_folha boolean default null
)
returns table (
  data date, vencimento date, titulo text, documento text, contraparte text,
  cnpj_cpf text, categoria_codigo text, categoria_descricao text, grupo text,
  status text, valor numeric, cod_titulo text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_folha boolean := case
    when auth.uid() is null then coalesce(p_com_folha, true)
    else public.pode_ver_remuneracao()
  end;
begin
  if not public.exigir('demonstracoes', 'demonstracoes_lancamentos') then
    return;
  end if;
  return query
    select * from public.demonstracoes_lancamentos_interno(p_tipo, p_rubrica, p_mes) l
     where v_folha or not public.categoria_e_folha(l.categoria_descricao);
end;
$function$;

/* A versão de 3 argumentos sai de cena: com as duas no catálogo, uma chamada sem
   `p_com_folha` fica ambígua para o PostgREST e o front recebe "could not choose
   the best candidate function". */
drop function if exists public.demonstracoes_lancamentos(text, text, text);

revoke all on function public.demonstracoes_lancamentos(text, text, text, boolean) from public, anon;
grant execute on function public.demonstracoes_lancamentos(text, text, text, boolean) to authenticated, service_role;

create or replace function public.demonstracoes_contrapartes(
  p_tipo text, p_meses text[], p_rubrica text, p_com_folha boolean default null
)
returns table (
  rubrica text, mes text, contraparte text, categoria text,
  valor numeric, lancamentos integer, cods text[]
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_folha boolean := case
    when auth.uid() is null then coalesce(p_com_folha, true)
    else public.pode_ver_remuneracao()
  end;
begin
  if not public.exigir('demonstracoes', 'demonstracoes_contrapartes') then
    return;
  end if;
  return query
    select * from public.demonstracoes_contrapartes_completo(p_tipo, p_meses, p_rubrica) c
     where v_folha or not public.categoria_e_folha(c.categoria);
end;
$function$;

drop function if exists public.demonstracoes_contrapartes(text, text[], text);

revoke all on function public.demonstracoes_contrapartes(text, text[], text, boolean) from public, anon;
grant execute on function public.demonstracoes_contrapartes(text, text[], text, boolean) to authenticated, service_role;

create or replace function public.demonstracoes_lancamentos_busca(
  p_tipo text, p_meses text[], p_busca text[], p_limite integer, p_com_folha boolean default null
)
returns table (
  rubrica text, mes text, data date, contraparte text, documento text,
  categoria text, codigo text, grupo text, valor numeric, cod_titulo text,
  observacao text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_folha boolean := case
    when auth.uid() is null then coalesce(p_com_folha, true)
    else public.pode_ver_remuneracao()
  end;
begin
  if not public.exigir('demonstracoes', 'demonstracoes_lancamentos_busca') then
    return;
  end if;
  return query
    select * from public.demonstracoes_lancamentos_busca_completo(p_tipo, p_meses, p_busca, p_limite) b
     where v_folha or not public.categoria_e_folha(b.categoria);
end;
$function$;

drop function if exists public.demonstracoes_lancamentos_busca(text, text[], text[], integer);

revoke all on function public.demonstracoes_lancamentos_busca(text, text[], text[], integer, boolean) from public, anon;
grant execute on function public.demonstracoes_lancamentos_busca(text, text[], text[], integer, boolean) to authenticated, service_role;

/* CONFERÊNCIA: o parâmetro não pode abrir a folha para uma SESSÃO. Faz-se passar
   pelo Head de Operações e pede `p_com_folha => true` — se voltar alguma linha
   de folha, o cadeado é enfeite. */
do $$
declare
  v_uid  uuid;
  v_n    integer;
begin
  select user_id into v_uid from public.profiles where perfil = 'lideranca' limit 1;
  if v_uid is null then
    raise notice 'sem conta de liderança para conferir — pulando';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select count(*) into v_n
    from public.demonstracoes_lancamentos('dre', 'Equipe Comercial', 'Jul-26', true);
  if v_n > 0 then
    raise exception 'o parâmetro p_com_folha abriu a folha para uma sessão (% linhas)', v_n;
  end if;

  select count(*) into v_n
    from public.demonstracoes_contrapartes('dre', array['Jul-26'], 'Equipe Comercial', true);
  if v_n > 0 then
    raise exception 'p_com_folha abriu as contrapartes para uma sessão (% linhas)', v_n;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'p_com_folha é ignorado numa sessão — ok';
end $$;
