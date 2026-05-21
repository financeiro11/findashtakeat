# Diagramas/Fluxogramas no Playbook

## Visão geral
Adicionar uma terceira aba no Hub do Playbook chamada **Fluxos** (ao lado de Playbooks e Workspace), onde o usuário cria e edita diagramas visuais de processos no estilo das imagens enviadas (caixas, losangos de decisão, swimlanes, setas conectando etapas).

Além disso, permitir **embedar um fluxo dentro de um Playbook ou página do Workspace** como bloco — assim o processo escrito e o diagrama vivem juntos.

## Escolha da biblioteca: **React Flow (@xyflow/react)**

Avaliação rápida:
- **React Flow** ✅ — open-source, mantida, integra perfeitamente com React/Vite/Tailwind, suporta nós customizados (retângulo, losango decisão, start/end, swimlanes), arrastar, conectar, zoom, minimap, export para PNG/SVG. É o padrão de mercado para esse tipo de UI (n8n, Typebot, Stripe usam variantes).
- Mermaid — só renderiza, não permite edição visual drag-and-drop. Bom como export, ruim como editor.
- tldraw / excalidraw — quadro branco livre, ótimo para rabisco, mas não estruturado para "processo de empresa" com nós tipados/exportáveis para automação futura.
- Drawio embed — pesado, iframe, fora do design system.

**Decisão:** React Flow como editor, com opção de **exportar para PNG e Mermaid** (para colar em outros lugares).

## Estrutura do que vou construir

### 1. Banco de dados (nova migration)
Tabela `playbook_flows`:
- `id`, `org_id`, `title`, `description`, `category`, `status` (mesmos enums dos Playbooks)
- `nodes` jsonb — array de nós React Flow
- `edges` jsonb — array de conexões
- `viewport` jsonb — zoom/pan salvos
- `playbook_id` (nullable) — vincular opcionalmente a um Playbook existente
- `owner_name`, `last_edited_by`, `archived`, `created_at`, `updated_at`
- RLS por `org_id` (mesmo padrão das outras tabelas do Playbook)

### 2. Nova aba "Fluxos" no `PlaybookHub.tsx`
Terceiro botão no segmented switcher, ícone `Workflow` ou `GitBranch`.

### 3. Página `src/pages/playbook/flows/Flows.tsx`
Mesmo layout dos Playbooks:
- Sidebar com lista (busca, filtro por categoria/status)
- Detail com o canvas do fluxo
- Header com título editável, status, owner, autosave (debounce 800ms igual ao Playbook)
- Ações: Novo, Duplicar, Excluir, Arquivar, Exportar PNG, Exportar Mermaid, Copiar link

### 4. Componente `FlowEditor.tsx` (React Flow)
- **Paleta lateral (esquerda)** com nós arrastáveis:
  - Início / Fim (pílula)
  - Etapa (retângulo arredondado)
  - Decisão (losango com handles Sim/Não)
  - Subprocesso (retângulo com borda dupla)
  - Anotação / nota adesiva (post-it amarelo)
  - Ator / responsável (chip com avatar)
- **Swimlanes** (raias por responsável: "Diretor", "PM", "Financeiro" — como na imagem 1) via nós-container redimensionáveis
- **Canvas** com grid, snap-to-grid, minimap, controles de zoom, pan
- **Edição inline**: duplo-clique no nó edita o label
- **Conexão**: arrastar das handles cria arestas com setas; arestas editáveis (rótulo "Sim"/"Não" para decisões)
- **Cores por tipo de nó** usando design tokens (sem cores hard-coded)
- **Autosave** com debounce, indicador "Salvando…/Salvo às HH:mm"
- **Atalhos**: Delete remove, Ctrl+D duplica, Ctrl+Z desfaz (built-in React Flow)

### 5. Bloco "Fluxo" no Workspace e Playbook
- No Tiptap (`WorkspaceEditor` e `PlaybookEditor`): nova extensão de nó que aceita um `flowId` e renderiza um preview read-only do fluxo (thumbnail + botão "Abrir fluxo").
- Comando `/fluxo` no SlashCommand do Workspace para inserir.

### 6. Export
- **PNG**: usar `toPng` do `html-to-image` sobre o viewport React Flow.
- **Mermaid**: função utilitária que percorre `nodes`/`edges` e gera `flowchart TD` — útil para colar em chats, README, etc.

## Detalhes técnicos
- Dependências novas: `@xyflow/react`, `html-to-image`
- Tipos de nós custom em `src/pages/playbook/flows/nodes/` (`StepNode.tsx`, `DecisionNode.tsx`, `StartEndNode.tsx`, `LaneNode.tsx`, `NoteNode.tsx`)
- Reusar `PLAYBOOK_CATEGORIES`, `PLAYBOOK_STATUSES`, `STATUS_STYLES` de `constants.ts`
- Bucket de storage `playbook-flows` para PNGs exportados (opcional, se quiser persistir thumbnails)
- Sem cores diretas em componentes — tudo via tokens do `index.css` (`--primary`, `--accent`, novo `--flow-decision`, `--flow-step`, etc.)

## Diagrama da arquitetura

```text
PlaybookHub
 ├── Playbooks   (existente)
 ├── Workspace   (existente)
 └── Fluxos      (NOVO)
      ├── FlowsList (sidebar)
      └── FlowEditor
           ├── NodePalette
           ├── ReactFlow canvas
           │    ├── StepNode
           │    ├── DecisionNode
           │    ├── StartEndNode
           │    ├── LaneNode (swimlane)
           │    └── NoteNode
           └── Toolbar (autosave, export PNG/Mermaid, link)
```

## Perguntas antes de implementar
1. Quer **swimlanes por responsável** (estilo imagem 1 com colunas "Board Member / PM / Project Manager / Financial Director") já no MVP, ou começamos só com nós livres e adicionamos raias depois?
2. Os fluxos devem ficar **vinculados a um Playbook específico** (cada playbook tem seus fluxos) ou são uma biblioteca **independente** com vínculo opcional? Recomendo independente + vínculo opcional.
3. Precisa de **colaboração em tempo real** (vários editando ao mesmo tempo via Supabase Realtime) ou autosave individual já basta?

Posso seguir com defaults razoáveis (swimlanes no MVP, biblioteca independente com vínculo opcional, autosave sem realtime) se preferir não responder agora.
