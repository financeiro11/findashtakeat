# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Central do Financeiro** (a.k.a. "findash") — an internal finance/operations dashboard for Takeat. Single-page React app (Vite + TypeScript + shadcn/ui) backed by Supabase (Postgres + Auth + Edge Functions). UI is in **Brazilian Portuguese**; keep user-facing strings, route names, and DB column names in pt-BR. Scaffolded with Lovable (`lovable-tagger` runs only in dev; `.lovable/` holds planning notes, not code).

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:8080
npm run build        # production build (build:dev for development-mode build)
npm run lint         # eslint over the repo
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch mode
npx vitest run src/path/to/file.test.ts   # run one test file
npm run typecheck    # tsc --noEmit -p tsconfig.app.json (~5 min)
```

Both `bun.lockb` and `package-lock.json` are present; the scripts above assume npm.

**`npm run build` NÃO checa tipos** — é só `vite build`, e o esbuild descarta os tipos sem
validar. Um nome indefinido (`num is not defined`) passa no build inteiro e só aparece como
tela branca no navegador. Use `npm run typecheck` antes de dar por pronto. E não rode
`npx tsc --noEmit` solto: o `tsconfig.json` da raiz tem `"files": []` com project references,
então esse comando **não checa arquivo nenhum e sai com sucesso** — é preciso apontar o
projeto (`-p tsconfig.app.json`), que é o que o script faz.

Supabase Edge Functions are Deno, not bundled by Vite. There's no local Supabase config for running them here beyond `supabase/config.toml`; they are deployed to the hosted project (`lgcxyxyidoirqmbdlldh`). Edit and deploy them through the Supabase CLI/dashboard.

## Architecture

### Frontend shape
- **Routing** is centralized in [src/App.tsx](src/App.tsx). Every authenticated page renders inside `<AppLayout>` (sidebar + header + AI assistant); `/login` is the only route outside it. When adding a page: create it in `src/pages/`, register the route in `App.tsx`, add its breadcrumb entry to `ROUTE_MAP` in [src/components/PageHeader.tsx](src/components/PageHeader.tsx), and add a nav entry in [src/components/AppSidebar.tsx](src/components/AppSidebar.tsx).
- **Auth & access control** live in [src/hooks/useAuth.tsx](src/hooks/useAuth.tsx) (session + `profiles` row) and are enforced in [src/components/AppLayout.tsx](src/components/AppLayout.tsx): unauthenticated → `/login`; users whose `profile.cargo` is `"parcerias"` are locked to `/operacional/parceiros`. Access to features is thus gated by the `cargo` field on the profile, plus RLS in the DB.
- **Data fetching** is done directly against Supabase from components using `@/integrations/supabase/client` (`supabase.from(...)`, `supabase.functions.invoke(...)`). `@tanstack/react-query` is installed and the provider is mounted, but many pages fetch imperatively in `useEffect`/`useMemo` instead. Match the pattern already in the file you're editing.
- **Business logic frequently lives in the page component**, not the DB. Totals, bonuses, and roll-ups are often computed client-side in `useMemo` over raw rows (see [.lovable/plan.md](.lovable/plan.md) for the "Bonificação + Recorrência" walkthrough — a good model of how data flows: raw tables → in-memory joins by name → `useMemo` aggregation). Don't assume a value is precomputed in Postgres.
- `@` is the path alias for `src/` (configured in both `vite.config.ts` and `vitest.config.ts`).

### Supabase Edge Functions (`supabase/functions/`)
- Each function is a Deno `index.ts`. Shared helpers are in `supabase/functions/_shared/`.
- **All AI runs on Gemini** via [_shared/gemini.ts](supabase/functions/_shared/gemini.ts) — use `generateText`, `generateJSON`, or `streamAsOpenAISSE` (streams are converted to the OpenAI SSE shape so frontend consumers stay compatible). `DEFAULT_MODEL` is `gemini-2.5-flash`. The key is `GEMINI_API_KEY` (server-side only, never exposed to the client).
- [_shared/org-context.ts](supabase/functions/_shared/org-context.ts) (`buildOrgContext`) assembles a markdown "organizational context" block from the `lib_*` and `base_conhecimento` tables and is injected into the system prompt of the AI functions — this is how the AIs know real employees, suppliers, cost centers, and internal policies.
- Every function handles CORS: call `handleCors(req)` first (or return `corsHeaders` on OPTIONS). Return via `jsonResponse` / `errorResponse` from the gemini helper.
- The **"editais"** subsystem (grant/tender radar) is a large cluster: `editais-sync` orchestrates per-source collectors `editais-fonte-*` (BNDES, FINEP, FAPES, SEBRAE, PNCP, gov.br, etc.), which use `_shared/firecrawl-collector.ts`, `dedupe.ts`, `keywords.ts`, `normalize.ts`, and `relevance.ts`. Firecrawl key env var is `CHAVE_API_FIRCRAWL` (falls back to `FIRECRAWL_API_KEY`).
- Server-side functions use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) for admin actions and `SUPABASE_ANON_KEY` when acting as the caller. `verify_jwt = false` is set only for `delete-user` in `config.toml`.

### Database
- Schema evolves through timestamped SQL files in `supabase/migrations/` (60+). Generated TS types are in [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts) — **do not hand-edit**; it's regenerated. When you add a migration that changes tables, the types file needs regenerating (via Supabase CLI) to match.
- Auth is a `profiles` table keyed by `user_id`, plus role/permission tables (`app_role`, `has_role`) referenced in migrations and enforced with RLS.

### Domain naming (pt-BR — helps navigate)
`demonstracoes` = financial statements; `DRE` = income statement; `DFC` = cash flow statement; `balancete` = trial balance; `BP` = balance sheet; `conta-corrente` = checking account; `de_para` / `DE_PARA` = classification mapping table; `parceiros` = partners/ambassadors; `editais` = grants/tenders; `proporcionais` = pro-rata; `recargas` = top-ups; `biblioteca` / `lib_*` = the org "Library" (departments, roles, cost centers, collaborators, suppliers, policies); `orcamento` = budget; `auditoria` = audit.

## Conventions
- **Design system**: colors come from CSS custom properties. `src/styles/tokens.css` defines brand tokens (Takeat red) and neutrals; `src/index.css` maps them onto shadcn's HSL palette (`--primary`, `--background`, etc.) for light and `.dark` themes. Use semantic Tailwind classes (`bg-background`, `text-muted-foreground`, `border-border`) and token-driven colors — avoid hard-coded hex. There's a live `/design-system` page.
- shadcn/ui primitives live in `src/components/ui/` (managed via `components.json` — the "new-york" style). Compose these rather than pulling new UI libraries.
- Toasts: this repo uses **sonner** (`import { toast } from "sonner"`) as the primary toast; a shadcn `use-toast` also exists. Prefer sonner for new code.
- ESLint has `@typescript-eslint/no-unused-vars` turned **off** and `react-refresh/only-export-components` as a warning — don't be surprised by unused vars passing lint.
- Text matching / fuzzy dedup of names uses [src/lib/normalize.ts](src/lib/normalize.ts) (`normalize`, `similarity`) on the client and `_shared/normalize.ts` on the server — reuse these instead of writing new normalizers.
- **Valores abreviados/arredondados sempre mostram o número cheio no hover.** [src/lib/valor.ts](src/lib/valor.ts) (`valorExato`) devolve a string completa e [src/components/ValorExato.tsx](src/components/ValorExato.tsx) (`comValorExato`) embrulha o texto compacto num `<span title=...>`. Convenção nas páginas: o formatador "normal" (`fmtBRL`, `fmtBRLShort`, `brlAbbr`, `fmtCompacto`, ...) devolve **ReactNode** com o hover, e a variante `…Str` devolve **string pura** — use a `…Str` em template literal, `title=`, prompt de IA e `tickFormatter` do Recharts, senão sai `[object Object]`. Em tooltip de gráfico (que já flutua) mostre `valorExato` direto, não o compacto. Props de KPI que recebem valor são tipadas como `React.ReactNode`.
- **Nome de contraparte na tela passa pelo apelido.** O extrato entrega "JIM.COM GRUPO SOUZA"; o cadastro em Configurações › Parametrização (`lib_fornecedores.apelido` + `contrapartes_alias`) devolve "Café dos eventos". Use `apelidoDe`/`nomeExibido` de [src/lib/apelidos.ts](src/lib/apelidos.ts) com o mapa do hook [src/hooks/useApelidos.ts](src/hooks/useApelidos.ts) (cache em nível de módulo — não busque por linha), e `apelidosNoTexto` para trocar nomes dentro de um texto já escrito. Padrão visual: **apelido na linha de cima, nome cru na linha de apoio** — é o nome cru que se procura no Omie. Ao trocar a exibição, **inclua o apelido no texto que a busca varre**, senão a linha some do filtro pelo nome que está escrito nela.
