-- Os três buckets que qualquer pessoa da internet lia.
--
-- ===========================================================================
-- O QUE FOI MEDIDO EM 30/08/2026, e não é hipótese
--
-- Com a chave pública do bundle, sem login nenhum:
--
--   POST /storage/v1/object/list/playbook-assets   → devolveu as pastas
--   GET  /storage/v1/object/public/playbook-assets/<pasta>/attachments/
--        1782936645287-PDI_Julia_FinanceEngineer_v5_1.docx  → HTTP 200, 34.915 bytes
--
-- Ou seja: o PDI de uma colaboradora, baixável por um estranho. Junto dele,
-- playbooks internos, a planilha de Ordens de Serviço do Omie e um comprovante
-- de pagamento em `facilities-contratos`.
--
-- ===========================================================================
-- SÃO DUAS PORTAS, e fechar só uma não resolve — foi o que quase deixei passar
--
--   1. A POLICY de leitura em `storage.objects`. É ela que permite LISTAR.
--      Em `playbook-assets` e `workspace-assets` a policy foi criada sem papel
--      nenhum, o que em Postgres significa o papel PUBLIC — que inclui `anon`.
--      Quem escreveu quis dizer "todo mundo do Hub" e disse "todo mundo".
--
--   2. O FLAG `public` do bucket. Ele libera o endpoint `/object/public/...`,
--      que **não passa por RLS nenhuma**. Enquanto ele estiver ligado, apertar a
--      policy não muda nada para quem já sabe o caminho do arquivo — e o caminho
--      vaza no `content` da página, no histórico do navegador, num print.
--
-- Por isso as duas metades estão neste arquivo. Fechar a policy e deixar o
-- bucket público é a versão do conserto que parece feita e não é.
--
-- ===========================================================================
-- O QUE ISTO QUEBRA, e onde está o conserto
--
-- Bucket privado derruba `getPublicUrl`, e as imagens do Playbook/Workspace
-- estão gravadas como `<img src="<url pública>">` dentro do `content` do TipTap.
-- Elas voltam por URL ASSINADA, em `src/lib/arquivoPrivado.ts` — que reescreve
-- o HTML no carregamento. Sem esse arquivo, este migration deixa as imagens
-- quebradas para quem está logado.
--
-- A ordem foi deliberada: primeiro fecha, depois restaura a exibição. Imagem
-- quebrada por uma hora é problema de conveniência; documento de RH aberto na
-- internet é problema de outra natureza.

/* ================================================= 1. a porta que LISTA */

-- `to authenticated` no lugar do PUBLIC implícito.
drop policy if exists "playbook-assets read"  on storage.objects;
create policy "playbook-assets read" on storage.objects
  for select to authenticated using (bucket_id = 'playbook-assets');

drop policy if exists "workspace-assets read" on storage.objects;
create policy "workspace-assets read" on storage.objects
  for select to authenticated using (bucket_id = 'workspace-assets');

-- Esta era explícita para `anon`: alguém escreveu "public read" de propósito.
-- A policy de `authenticated` já existe ao lado e continua valendo.
drop policy if exists "public read facilities-contratos" on storage.objects;

/* ========================================== 2. a porta que NÃO passa por RLS */

update storage.buckets
   set public = false
 where id in ('playbook-assets', 'workspace-assets', 'facilities-contratos');
