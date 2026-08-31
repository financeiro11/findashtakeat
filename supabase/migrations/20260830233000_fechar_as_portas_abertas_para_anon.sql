-- Fechar o que estava aberto para quem não fez login.
--
-- ===========================================================================
-- O QUE ACONTECEU EM 30/08/2026
--
-- Uma pessoa de fora entrou no Hub e avisou por Instagram. A porta principal
-- era a tela de login (senha padrão "123456" preenchida no formulário, e um
-- código de 4 dígitos no bundle que redefinia a senha de qualquer um) — isso
-- foi consertado no front e nas Edge Functions. Esta migração cuida da outra
-- metade, a do banco: o que o papel `anon` alcançava DIRETO pelo PostgREST,
-- sem passar por tela nenhuma.
--
-- `anon` é o papel da chave pública que está no bundle do front. Ele não é
-- "ninguém": é QUALQUER PESSOA DA INTERNET que abriu a página uma vez e copiou
-- a chave. Tudo que `anon` pode fazer, um desconhecido pode fazer com `curl`.
--
-- ===========================================================================
-- POR QUE ISSO ACONTECE SOZINHO, e é a parte que mais importa daqui
--
-- O Postgres do Supabase concede privilégio a `anon` e `authenticated` em TODA
-- tabela nova por padrão (é o `alter default privileges` que vem no projeto).
-- Quem cria tabela e liga RLS fica protegido — a RLS nega por falta de policy.
-- Quem cria tabela e ESQUECE a RLS fica com uma tabela pública para leitura E
-- ESCRITA, sem erro nenhum, sem aviso nenhum. Foi o caso de quatro delas.
--
-- Por isso o fim deste arquivo desliga a concessão automática. Daqui em diante
-- uma tabela nova nasce fechada para `anon`, e esquecer a RLS deixa de ser
-- suficiente para vazar.

/* =================================================== 1. as quatro esquecidas */

-- RLS desligada + grant total para `anon`: qualquer pessoa lia, inseria,
-- alterava e APAGAVA estas quatro tabelas. Ligar a RLS já fecha (sem policy o
-- padrão é negar); a policy de `authenticated` abaixo é para o Hub continuar
-- funcionando igual, e segue o mesmo formato do resto do projeto.

alter table public.agente_obrigacoes        enable row level security;
alter table public.automacao_comando_antigo enable row level security;
alter table public.obra_match               enable row level security;
alter table public.obra_notas_stage         enable row level security;

drop policy if exists agente_obrigacoes_auth on public.agente_obrigacoes;
create policy agente_obrigacoes_auth on public.agente_obrigacoes
  for all to authenticated using (true) with check (true);

drop policy if exists automacao_comando_antigo_auth on public.automacao_comando_antigo;
create policy automacao_comando_antigo_auth on public.automacao_comando_antigo
  for all to authenticated using (true) with check (true);

drop policy if exists obra_match_auth on public.obra_match;
create policy obra_match_auth on public.obra_match
  for all to authenticated using (true) with check (true);

drop policy if exists obra_notas_stage_auth on public.obra_notas_stage;
create policy obra_notas_stage_auth on public.obra_notas_stage
  for all to authenticated using (true) with check (true);

/* ============================= 2. nenhuma tabela responde a quem não entrou */

-- Cinto além do suspensório: as outras tabelas já estavam protegidas pela RLS
-- (nenhuma tem policy para `anon`), mas continuavam com o GRANT pendurado. Um
-- `alter table ... disable row level security` distraído, num dia qualquer, e a
-- tabela vira pública de novo. Sem o grant, não vira.
--
-- Isto não muda nada para o Hub: o app fala como `authenticated`, e as Edge
-- Functions falam como `service_role` — que ignora RLS e não é tocada aqui.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

/* ================================= 3. as funções que `anon` podia executar */

-- Quase cem funções do schema `public` estavam executáveis por `anon`, muitas
-- delas `security definer` — isto é, rodando com os poderes de quem as criou,
-- ignorando RLS por definição. Entre elas coisas que ESCREVEM:
-- `importar_auditoria`, `estornos_conciliar`, `notas_externas_faxina`,
-- `facilities_aplicar_titulo`, `criar_token_e_registrar` (que cunha os tokens
-- dos links públicos — nas mãos de um estranho, fabrica o próprio convite).
--
-- A regra passa a ser: executa quem está logado. As exceções são as SEIS
-- funções que existem justamente para servir quem NÃO tem conta — as telas
-- `/l/<token>` e `/n/<token>`. Elas se defendem sozinhas pelo token, que é o
-- segredo que a pessoa traz na URL.
--
-- Funções de extensão (pg_trgm, unaccent, postgres_fdw) ficam de fora do laço:
-- mexer nos privilégios delas não fecha porta nenhuma e quebra índice.

do $$
declare
  f record;
  publicas text[] := array[
    'resolver_token',                  -- /l/<token>: abre o pedido de justificativa
    'salvar_justificativa_via_token',  -- /l/<token>: grava a resposta
    'registrar_comprovante_via_token', -- /l/<token>: anexa o comprovante
    'validar_token_para_id_unico',     -- /l/<token>: confere o par token × lançamento
    'resolver_nota_publica',           -- /n/<token>: abre a anotação compartilhada
    'comentar_nota_publica'            -- /n/<token>: comenta nela
  ];
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (                       -- pula o que pertence a extensão
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    -- `from public` e não só `from anon`: quando a concessão foi feita ao papel
    -- PUBLIC, `anon` herda dela, e revogar de `anon` não tira nada. Este é o
    -- erro clássico que faz a revogação "não pegar" sem dar erro.
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);

    if f.proname = any(publicas) then
      execute format('grant execute on function %s to anon', f.assinatura);
    end if;
  end loop;
end $$;

/* ================================ 4. e que não volte a acontecer sozinho */

-- A raiz do problema: tabela nova nascia com grant para `anon`. Daqui em
-- diante não nasce mais. Quem criar tabela e esquecer a RLS continua com um
-- descuido — mas o descuido deixa de ser um vazamento.
--
-- Vale para quem cria objeto aqui: o papel corrente e o `postgres`, dono das
-- migrações. `authenticated` não é tocado — é o papel do Hub.
--
-- FALTA UM: `supabase_admin`. O papel com que se aplica migração aqui não tem
-- permissão para mexer nos defaults dele ("permission denied to change default
-- privileges"), e tentar derruba a migração inteira. Objeto criado POR
-- `supabase_admin` — o que na prática significa criado pelo painel do Supabase,
-- não por migração — continua nascendo com grant para `anon`. A defesa nesse
-- caminho segue sendo lembrar da RLS; se um dia isso incomodar, dá para rodar as
-- três linhas equivalentes conectado como `supabase_admin` pelo SQL Editor.

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
