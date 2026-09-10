-- A FOLHA PARA DE VAZAR PELAS PORTAS DE TRÁS.
--
-- Em 10/09/2026 o painel de Remuneração ganhou recorte por time: o Head de
-- Operações vê 47 pessoas, o de Produto vê 6, e as tabelas `remuneracao_*`
-- recusam leitura direta a quem não tem a folha inteira. Só que o mesmo salário,
-- com o mesmo nome, continuava saindo por outras seis portas. Medido com a
-- sessão do Head de Operações (perfil `lideranca`):
--
--   demonstracoes_lancamentos('dre','Equipe Comercial','Jul-26')
--     → THAYRONE PANITZ DINIZ LTDA  -27.500
--       LUCAS SEGATTO SOARES         -7.000   … a folha do Comercial, por nome
--
--   demonstracoes_contrapartes(...)     → a mesma lista, agrupada
--   demonstracoes_lancamentos_busca(...) → idem, e SEM NENHUMA trava: a função
--                                          não chamava `exigir`, então qualquer
--                                          conta logada lia tudo
--   cac_pessoas                          → 103 pessoas com remuneração, policy `true`
--   cac_celula(...)                      → "Luiza Freitas Pinheiro, R$ 6.000"
--   rescisoes / rescisoes_verbas         → salário-base e verbas, policy `true`
--   folha_*                              → a folha enviada ao Omie, policy `true`
--
-- A decisão do Miguel: **fora do painel de Remuneração, ninguém vê nome e valor
-- de folha sem ter a folha inteira** — nem o próprio time. O TOTAL da linha
-- continua aparecendo (é número da empresa, e a liderança deve vê-lo); o que
-- some é a lista de pessoas. Para o próprio time, o caminho é o painel, e a tela
-- diz isso em vez de mostrar uma lista vazia.
--
-- ---------------------------------------------------------------------------
-- COMO AS FUNÇÕES FORAM FECHADAS
--
-- Por RENOMEAÇÃO, não por reescrita. `alter function ... rename to ..._completo`
-- preserva o corpo byte a byte; um wrapper novo com o nome antigo põe a trava na
-- frente. Reescrever à mão um `with` de 60 linhas para acrescentar um `where` é
-- como se transcreve um erro que ninguém revisa.

-- ─────────────────────── 1. O que é folha ───────────────────────

/* A MESMA REGRA de `vw_remuneracao_omie`, num lugar só.
   É por ela que o painel de Remuneração decide o que é folha, e repeti-la aqui
   com outras palavras faria a DRE esconder um conjunto e o painel mostrar
   outro. Se a lista de categorias mudar, muda aqui e vale nos dois. */
create or replace function public.categoria_e_folha(p_descricao text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_descricao, '') ~* '(Pessoal|Premia[çc][ãa]o|Escala)\s*-'
      or coalesce(p_descricao, '') ~* 'Pro\s*Labore'
      or coalesce(p_descricao, '') ~* 'Diretores\s*-'
$function$;

comment on function public.categoria_e_folha(text) is
  'Esta categoria do Omie é remuneração de pessoa? Mesma regra de '
  'vw_remuneracao_omie — não duplicar noutro lugar.';

/* As rubricas da DRE/DFC que contêm folha, para a TELA saber o que dizer antes
   de pedir a lista. Sem isto o drill-down de uma rubrica de folha voltaria vazio
   e pareceria mês sem lançamento. Devolve só nomes de rubrica: nenhum valor,
   nenhuma pessoa — por isso é aberta a qualquer autenticado. */
create or replace function public.rubricas_de_folha(p_tipo text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct m.rubrica order by m.rubrica), '{}')
    from public.omie_dre_mapa m
   where m.ativo is not false
     and m.demonstrativo in (p_tipo, 'ambos')
     and public.categoria_e_folha(m.codigo_categoria)
$function$;

revoke all on function public.rubricas_de_folha(text) from public, anon;
grant execute on function public.rubricas_de_folha(text) to authenticated, service_role;

-- ─────────────────────── 2. O drill-down da DRE/DFC ───────────────────────

/* Já tinha `exigir('demonstracoes')`; ganha a segunda pergunta. O filtro é por
   LINHA e não por rubrica: uma rubrica mista continua mostrando o que não é
   folha, em vez de fechar inteira por causa de uma categoria. */
create or replace function public.demonstracoes_lancamentos(
  p_tipo text, p_rubrica text, p_mes text
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
  v_folha boolean := public.pode_ver_remuneracao();
begin
  if not public.exigir('demonstracoes', 'demonstracoes_lancamentos') then
    return;  -- em bloqueio devolve vazio; em aviso `exigir` já deixou passar
  end if;
  return query
    select * from public.demonstracoes_lancamentos_interno(p_tipo, p_rubrica, p_mes) l
     where v_folha or not public.categoria_e_folha(l.categoria_descricao);
end;
$function$;

revoke all on function public.demonstracoes_lancamentos(text, text, text) from public, anon;
grant execute on function public.demonstracoes_lancamentos(text, text, text) to authenticated, service_role;

-- ─────────────────────── 3. A busca (que não tinha trava nenhuma) ───────────────────────

alter function public.demonstracoes_lancamentos_busca(text, text[], text[], integer)
  rename to demonstracoes_lancamentos_busca_completo;
revoke all on function public.demonstracoes_lancamentos_busca_completo(text, text[], text[], integer)
  from public, anon, authenticated;

create or replace function public.demonstracoes_lancamentos_busca(
  p_tipo text, p_meses text[], p_busca text[], p_limite integer
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
  v_folha boolean := public.pode_ver_remuneracao();
begin
  -- Faltava. A busca lia lançamento a lançamento — contraparte, CNPJ, categoria,
  -- valor e a observação CRUA do título — para QUALQUER conta autenticada,
  -- inclusive a consultoria de fora e o perfil que só vê Parceiros.
  if not public.exigir('demonstracoes', 'demonstracoes_lancamentos_busca') then
    return;
  end if;
  return query
    select * from public.demonstracoes_lancamentos_busca_completo(p_tipo, p_meses, p_busca, p_limite) b
     where v_folha or not public.categoria_e_folha(b.categoria);
end;
$function$;

revoke all on function public.demonstracoes_lancamentos_busca(text, text[], text[], integer) from public, anon;
grant execute on function public.demonstracoes_lancamentos_busca(text, text[], text[], integer) to authenticated, service_role;

-- ─────────────────────── 4. Quem se mexeu (os "drivers") ───────────────────────

alter function public.demonstracoes_contrapartes(text, text[], text)
  rename to demonstracoes_contrapartes_completo;
revoke all on function public.demonstracoes_contrapartes_completo(text, text[], text)
  from public, anon, authenticated;

create or replace function public.demonstracoes_contrapartes(
  p_tipo text, p_meses text[], p_rubrica text
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
  v_folha boolean := public.pode_ver_remuneracao();
begin
  if not public.exigir('demonstracoes', 'demonstracoes_contrapartes') then
    return;
  end if;
  return query
    select * from public.demonstracoes_contrapartes_completo(p_tipo, p_meses, p_rubrica) c
     where v_folha or not public.categoria_e_folha(c.categoria);
end;
$function$;

revoke all on function public.demonstracoes_contrapartes(text, text[], text) from public, anon;
grant execute on function public.demonstracoes_contrapartes(text, text[], text) to authenticated, service_role;

-- ─────────────────────── 5. O que a IA da célula recebe ───────────────────────

/* `_multi` só é chamada pela Edge Function `demonstracoes-perguntar`, que roda
   com a SERVICE ROLE — ou seja, `auth.uid()` é nulo e nenhuma checagem daqui
   alcança quem de fato perguntou. Por isso o parâmetro: quem sabe o perfil de
   quem perguntou é a função, e ela passa a resposta para cá.

   Com `default true` a chamada antiga continua compilando — e é de propósito que
   o default seja o comportamento de hoje: a Edge Function é quem tem de mudar,
   e mudou junto desta migration. */
alter function public.demonstracoes_lancamentos_multi(text, text[], text[])
  rename to demonstracoes_lancamentos_multi_completo;

create or replace function public.demonstracoes_lancamentos_multi(
  p_tipo text, p_rubricas text[], p_meses text[], p_com_folha boolean default true
)
returns table (
  rubrica text, mes text, data date, contraparte text, categoria text,
  valor numeric, cod_titulo text, observacao text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select * from public.demonstracoes_lancamentos_multi_completo(p_tipo, p_rubricas, p_meses) m
   where p_com_folha or not public.categoria_e_folha(m.categoria)
$function$;

revoke all on function public.demonstracoes_lancamentos_multi(text, text[], text[], boolean) from public, anon, authenticated;
grant execute on function public.demonstracoes_lancamentos_multi(text, text[], text[], boolean) to service_role;
revoke all on function public.demonstracoes_lancamentos_multi_completo(text, text[], text[]) from public, anon, authenticated;

-- ─────────────────────── 6. O CAC ───────────────────────

/* O painel do CAC é de `metricas` e a liderança deve continuar vendo o NÚMERO.
   O que sai é o detalhe por pessoa: o cadastro (aba "Pessoas e regras") e a
   lista que abre ao clicar numa célula. */

alter table public.cac_pessoas enable row level security;
drop policy if exists "auth le cac_pessoas" on public.cac_pessoas;
drop policy if exists "auth escreve cac_pessoas" on public.cac_pessoas;
create policy "cac_pessoas é folha" on public.cac_pessoas
  for all to authenticated
  using (public.pode_ver_remuneracao())
  with check (public.pode_ver_remuneracao());

/* MAS O PAINEL PRECISA DO DEPARTAMENTO. `cac_linha_casa` responde "este CNPJ é
   do Comercial?" lendo `cac_pessoas`, e `cac_painel` a chama linha a linha. Como
   ela roda como INVOCADOR, trancar a tabela faria o `exists` devolver falso e o
   painel **zerar calado** para a liderança — exatamente o defeito que já custou
   caro no `cac_pagamentos`. Vira DEFINER: ela devolve um booleano sobre
   departamento e não expõe valor nenhum. */
create or replace function public.cac_linha_casa(
  p_departamentos text[], p_categorias text[], p_cnpj text, p_categoria text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (cardinality(p_departamentos) > 0 or cardinality(p_categorias) > 0)
     and (cardinality(p_categorias) = 0 or p_categoria = any(p_categorias))
     and (cardinality(p_departamentos) = 0 or exists (
           select 1 from public.cac_pessoas p
            where p.ativo and p.cnpj = p_cnpj and p.departamento = any(p_departamentos)))
$function$;

revoke all on function public.cac_linha_casa(text[], text[], text, text) from public, anon;
grant execute on function public.cac_linha_casa(text[], text[], text, text) to authenticated, service_role;

alter function public.cac_celula(integer, integer, uuid) rename to cac_celula_completo;
revoke all on function public.cac_celula_completo(integer, integer, uuid) from public, anon, authenticated;

create or replace function public.cac_celula(p_ano integer, p_mes integer, p_linha_id uuid)
returns table (
  tipo text, cod_titulo bigint, data_pagamento date, cnpj text, pessoa text,
  favorecido text, departamento text, categoria text, categoria_descricao text,
  natureza text, valor numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- Aqui não dá para filtrar linha a linha: a célula do CAC É a folha de um
  -- time. Sem a folha inteira, o detalhe não abre — o valor da célula continua
  -- vindo de `cac_painel`, que é agregado, e a tela explica a diferença.
  if not public.pode_ver_remuneracao() then
    return;
  end if;
  return query select * from public.cac_celula_completo(p_ano, p_mes, p_linha_id);
end;
$function$;

revoke all on function public.cac_celula(integer, integer, uuid) from public, anon;
grant execute on function public.cac_celula(integer, integer, uuid) to authenticated, service_role;

-- ─────────────────────── 7. As tabelas que estavam em `true` ───────────────────────

/* Todas são lidas apenas por telas que já exigem `remuneracao` (Rescisões,
   Colaboradores RH, a prévia da folha) e escritas por Edge Functions com a
   service role, que ignora RLS. O `true` aqui não servia a ninguém — só deixava
   a folha e as verbas de desligamento legíveis por qualquer conta logada. */

drop policy if exists "rescisoes_select_auth" on public.rescisoes;
create policy "rescisoes é folha" on public.rescisoes
  for select to authenticated using (public.pode_ver_remuneracao());

drop policy if exists "rescisoes_verbas_select_auth" on public.rescisoes_verbas;
create policy "rescisoes_verbas é folha" on public.rescisoes_verbas
  for select to authenticated using (public.pode_ver_remuneracao());

drop policy if exists "auth all folha_depara" on public.folha_depara;
create policy "folha_depara é folha" on public.folha_depara
  for all to authenticated
  using (public.pode_ver_remuneracao()) with check (public.pode_ver_remuneracao());

drop policy if exists "auth all folha_envios_omie" on public.folha_envios_omie;
create policy "folha_envios_omie é folha" on public.folha_envios_omie
  for all to authenticated
  using (public.pode_ver_remuneracao()) with check (public.pode_ver_remuneracao());

drop policy if exists "auth all folha_recusas" on public.folha_recusas;
create policy "folha_recusas é folha" on public.folha_recusas
  for all to authenticated
  using (public.pode_ver_remuneracao()) with check (public.pode_ver_remuneracao());

drop policy if exists "auth read folha_ajustes_log" on public.folha_ajustes_log;
create policy "folha_ajustes_log é folha" on public.folha_ajustes_log
  for select to authenticated using (public.pode_ver_remuneracao());

-- ─────────────────────── 8. Conferência ───────────────────────

/* A regra tem de reconhecer as categorias reais, e tem de PARAR nas que não são
   folha. Uma regra que devolve `true` para tudo esconderia a DRE inteira; uma
   que devolve `false` para tudo não esconderia nada, e as duas passariam
   despercebidas até alguém abrir a tela. */
do $$
begin
  if not public.categoria_e_folha('3.1.1.2. Pessoal - Comercial')       then raise exception 'regra não pegou Pessoal'; end if;
  if not public.categoria_e_folha('3.1.1.11 Premiação - Sucesso')       then raise exception 'regra não pegou Premiação'; end if;
  if not public.categoria_e_folha('3.2.7.4 .Escala - Suporte')          then raise exception 'regra não pegou Escala'; end if;
  if not public.categoria_e_folha('3.1.1.1 Pro Labore')                 then raise exception 'regra não pegou Pro Labore'; end if;
  if not public.categoria_e_folha('3.2.22 Diretores - Administrativo')  then raise exception 'regra não pegou Diretores'; end if;

  if public.categoria_e_folha('4.1.1 Receita de Assinaturas') then raise exception 'regra pegou receita'; end if;
  if public.categoria_e_folha('3.3.1 Aluguel')                then raise exception 'regra pegou aluguel'; end if;
  if public.categoria_e_folha(null)                           then raise exception 'regra pegou nulo'; end if;

  if coalesce(array_length(public.rubricas_de_folha('dre'), 1), 0) < 5 then
    raise exception 'poucas rubricas de folha na DRE: %', public.rubricas_de_folha('dre');
  end if;

  raise notice 'rubricas de folha na DRE: %', public.rubricas_de_folha('dre');
end $$;
