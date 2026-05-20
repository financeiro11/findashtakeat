## Premissas confirmadas
- Substitui o `/dashboard` atual (arquivado como `/dashboard-legacy` para fallback durante 1 release).
- Mês de referência selecionável (default = último mês com dados, hoje **dez/25**). Mockup mostra "abr/26" mas a base só tem até dez/25 — o seletor cobre os dois cenários quando chegar novo dado.
- Tudo entregue na mesma resposta. Sem mudar fonte de dados; uso `historico_financeiro`, `bp_anual`, `demonstracoes_contabeis` exatamente como já vivem.
- Sem emoji decorativo, sem gradientes em barras de dados, mono nos números, design tokens já existentes (não vou hard-codar #851818 — uso `hsl(var(--primary))` etc).

## Arquitetura

```text
src/pages/Dashboard.tsx                 ← shell + estado do mês + composição
src/pages/dashboard/
  ├─ useFinanceData.ts                  ← hook único: carrega DRE/DFC/BP + memoiza séries
  ├─ metrics.ts                         ← cálculos puros (margem, runway, cashburn, bridge)
  ├─ Greeting.tsx                       ← saudação + botões
  ├─ AskAIBar.tsx                       ← chips + input + atalho ⌘↵ (abre drawer)
  ├─ HealthStrip.tsx                    ← hero status com 3 pulsos
  ├─ KpiRow.tsx                         ← 4 KPIs (Receita / EBITDA / Caixa / Burn+Runway)
  ├─ BridgeWaterfall.tsx                ← 9 colunas waterfall com drill-down
  ├─ InsightsList.tsx                   ← anomalia cards com ações
  ├─ TrendChart.tsx                     ← Receita Líq × EBITDA + margem%
  ├─ BurnRanking.tsx                    ← onde queimamos mais
  ├─ ProjectionChart.tsx                ← realizado + projeção (cenário base/oti/pess)
  ├─ AIDrawer.tsx                       ← drawer lateral com chat streamed
  ├─ ReductionPlanModal.tsx             ← plano de redução
  └─ TweaksPanel.tsx                    ← painel flutuante de configurações

supabase/functions/
  ├─ ai-dashboard-insights/             ← estender: também gera headline do Health Strip
  ├─ ask-finance-ai/                    ← já existe — usado pelo AskAIBar + drawer (streamed)
  ├─ ai-reduction-plan/  (novo)         ← gera sugestões priorizadas com impacto em runway
  └─ ai-forecast-scenarios/ (novo)      ← gera premissas de cada cenário
```

## Estado e dados
- 1 só fetch no mount: `historico_financeiro` (toda janela 24m), `bp_anual` (anos visíveis), `profiles` (nome). Memoizado por mês selecionado.
- `metrics.ts` deriva tudo (sem chamada extra ao banco):
  - Receita Bruta = `Entradas` (ou soma `Receita de Serviços + Receita Markup`)
  - EBITDA = Receita Líq − (Pessoal+Mkt+Custos+Adm) (usando agrupamento já feito em `DRE.tsx`)
  - Saldo de caixa = saldo inicial configurável + Σ FCL
  - Cashburn = FCL excluindo `(+) Novos Empréstimos & Financiamentos`
  - Runway = saldo / |burn médio 3m|
  - Bridge = saldo mês ant + Entradas + cada bloco de saída (sinal correto)
- Tudo derivado vira séries `{ mes: 'mai/25', valor }[]` reutilizadas nos charts.

## Status & cores (Health Strip)
- Vermelho: runway < 3m **ou** margem EBITDA < −30%
- Âmbar: runway 3–6m **ou** margem < −10%
- Verde: caso contrário
- Comunicado também por ícone (CheckCircle / AlertTriangle / AlertOctagon) + texto da pill, não só cor.

## IA — onde pluga e como

| Ponto | Como funciona |
|---|---|
| AskAIBar + AIDrawer | Streama via `ask-finance-ai`. Contexto = JSON enxuto (KPIs do mês + linhas relevantes DRE/DFC + BP). Respostas em markdown com tag `[linha:Eventos e Feiras:abr/26]` que vira link de drill-down |
| Health Strip headline | `ai-dashboard-insights` estendido — retorna `{ headline, sub }`. Cache em `ai_dashboard_cache` por `user_id+periodo` (regenera só ao trocar mês) |
| Plano de redução | Novo `ai-reduction-plan`: recebe top-N rubricas em maior crescimento + saldo + meta runway; devolve `[{categoria, corte_estimado, novo_runway, impacto, justificativa}]` |
| Anomalias | Reaproveita `ai-dashboard-insights` — variação > 1.5σ vs média móvel 6m por rubrica. Ações `vista/investigação/resolvido` salvas em `ai_dashboard_cache.insights[].status` |
| Cenários do forecast | Novo `ai-forecast-scenarios`: 3 premissas (base/oti/pess) com taxas mensais; usuário edita e refaz projeção local sem nova chamada |

## Drill-downs e navegação
- KPI click → `/dre?metrica=...&mes=...` (ou `/dfc` para caixa); rotas existentes já suportam querystring? Se não, adiciono `useSearchParams` no `DRE.tsx`/`DFC.tsx`.
- Bridge coluna click → drawer local com lista de rubricas daquela categoria no mês.
- Citações da IA viram `<button onClick={() => navigate(...)}>`.

## Estados
- Loading: skeleton cinza animado com mesmo layout por card.
- Empty mês: `<EmptyState>` com CTA "Importar tracker" → `/importar-extrato`.
- Erro fetch: pill vermelha + retry.

## Tweaks (painel flutuante)
- Botão flutuante bottom-right → Popover com:
  - Período comparação (mês ant / mesmo mês ano passado / orçado)
  - Janela do gráfico (6/12/24/YTD)
  - Toggle Cashburn vs FCL
  - Modo escuro (já existe `next-themes`)
- Preferências persistidas em `localStorage` (`dashboard:tweaks`).

## Acessibilidade
- Todo SVG com `<title>`, contraste AA, cores sempre + texto/ícone, atalhos com `aria-keyshortcuts`.

## Migrações necessárias
Nenhuma de schema obrigatória. Pode ser preciso adicionar coluna `status` aos objetos de `ai_dashboard_cache.insights` (mas é jsonb — sem migration).

## O que NÃO vou fazer (explicitamente)
- Não vou mudar a fonte de dados, nem agregar novas tabelas sem avisar.
- Não vou tocar sidebar/topo do app além de renomear o item de menu se necessário.
- Não vou adicionar seção fora das 7 listadas.

## Ordem de implementação dentro da entrega
1. `useFinanceData` + `metrics.ts` (base sem UI nova ainda funciona em isolado)
2. Shell (`Dashboard.tsx`) com seletor de mês + Greeting
3. KpiRow + HealthStrip + AskAIBar (sem IA ainda — mock)
4. BridgeWaterfall + drill-down drawer
5. TrendChart + BurnRanking
6. ProjectionChart com cenários (sem IA ainda)
7. Edge functions: estender `ai-dashboard-insights` (headline), criar `ai-reduction-plan` e `ai-forecast-scenarios`
8. AIDrawer streamed + plugar todos os 5 pontos
9. TweaksPanel + estados (loading/empty/error)
10. Smoke test em dez/25, conferir números contra DRE/DFC existentes.

## Riscos
- Volume de código (~2 a 2,5k linhas novas). Vou parcelar arquivos pequenos pra evitar diff gigante.
- Streaming de IA depende do edge function devolver SSE; `ask-finance-ai` hoje pode retornar JSON único — checo ao implementar e adapto.
- Recharts não tem waterfall nativo — implemento com `BarChart` empilhado + offsets calculados.
