
# Diagnóstico — "Bonificação + Recorrência" em /operacional/parceiros

Sem alterações de código. Só investigação.

## 1. Onde o valor é calculado

**100% calculado no front-end**, em `src/pages/Parceiros.tsx`. Não existe coluna, view, RPC nem Edge Function no Supabase que retorne esse total pronto. O banco entrega apenas dados crus (indicações, recorrências e cadastro do embaixador) e o React faz toda a aritmética em `useMemo`s.

Não há função RPC nem Edge Function ligada a essa bonificação. (Existe a Edge Function `upsert-indicacao`, mas ela só insere/atualiza indicações — não calcula bonificação.)

## 2. Tabelas Supabase que alimentam o cálculo

Três tabelas, lidas direto do client (`@/integrations/supabase/client`):

- **`parceiros_indicacoes`** — uma linha por indicação/venda.
  Query (linha 329-332):
  ```ts
  supabase.from("parceiros_indicacoes")
    .select("*")
    .order("data_indicacao", { ascending: false, nullsFirst: false })
  ```
  Colunas usadas: `id`, `id_negocio`, `nome_campanha`, `indicador` (=embaixador), `vendedor`, `nome_negocio`, `mrr`, `valor_total`, `data_indicacao`, `data_venda`, `hubspot_url`, `asaas_url`.

- **`parceiros_recorrencias`** — uma linha por contrato recorrente ativo/inativo.
  Query (linha 378-382):
  ```ts
  supabase.from("parceiros_recorrencias")
    .select("*")
    .order("data_indicacao", { ascending: false, nullsFirst: false })
  ```
  Colunas usadas: `id`, `id_negocio`, `nome_campanha`, `indicador`, `responsavel_takeat`, `nome_negocio`, `mrr`, `recorrencia_valor`, `data_indicacao`, `ativo`, `hubspot_url`, `asaas_url`.

- **`parceiros_cadastro`** — regra do embaixador (tier, campanha e como remunerar).
  Query (linha 373):
  ```ts
  supabase.from("parceiros_cadastro")
    .select("nome,tier,status,campanha,bonificacao,metodo_bonificacao,valor_bonificacao,recorrencia,metodo_recorrencia,valor_recorrencia")
  ```

O join é feito em memória pelo nome do embaixador: `cadastroByNome = Map<lower(nome), cadastro>` (linha 642-646).

## 3. Fórmula passo a passo

O valor exibido no card/linha "Bonificação + Recorrência" do embaixador `X` no período filtrado é:

```
total(X) = bonificacaoTotal(X) + recorrenciaTotal(X)
```

### 3.1 `bonificacaoTotal(X)` — vem de `parceiros_indicacoes`

Para cada linha `r` de `parceiros_indicacoes` que passou nos filtros (mês de `data_venda` = filtro, embaixador, campanha, busca, etc. — `filtered`, linha 675-702):

```
cad = cadastroByNome[lower(r.indicador)]

bonus(r) =
  (r.data_venda existe) e (cad.bonificacao = true) e (cad.valor_bonificacao != null)
    ? cad.metodo_bonificacao === "%"
        ? r.valor_total * (cad.valor_bonificacao / 100)
        : cad.valor_bonificacao              // valor fixo em R$
    : null
```
Função `calcBonificacao` em linha 648-652; aplicação em linha 679.

Depois, agrupa por embaixador (linha 761-775):
```
bonificacaoTotal(X) = Σ bonus(r)  para todas as linhas r com indicador = X
```

### 3.2 `recorrenciaTotal(X)` — vem de `parceiros_recorrencias`

Para cada linha `r` de `parceiros_recorrencias` (memo `recorrencias`, linha 792-844):

```
cad = cadastroByNome[lower(r.indicador)]

calc(r) =
  (cad.recorrencia = true) e (cad.valor_recorrencia != null)
    ? cad.metodo_recorrencia === "%"
        ? r.mrr * (cad.valor_recorrencia / 100)
        : cad.valor_recorrencia
    : r.recorrencia_valor   // fallback para o valor já gravado na linha

// Marca como "Vencida" se data_indicacao + 1 ano < refDate
//   refDate = último dia do mês filtrado (ou hoje, se sem filtro)
vencida(r) = r.ativo && r.data_indicacao && refDate > r.data_indicacao + 1 ano
```
Função `calcRecorrencia` em linha 654-658.

Soma por embaixador (linha 862-870), **excluindo inativos e vencidos**:
```
recorrenciaTotal(X) = Σ calc(r)   para r com r.ativo && !r.vencida && indicador = X
```

### 3.3 Onde aparece o número no card/linha

- Coluna da tabela "Conversões por embaixador": linha 1573
  ```
  soma = c.bonificacaoTotal + recorrenciaPorEmbaixador.get(lower(c.nome))
  ```
- KPI agregado "Bonificação + Recorrência" (linha 1423): `convAgg.soma = bonificacaoTotal + recorrenciaTotal` (linha 873-898), somando todos os embaixadores filtrados.

## 4. RPC / Edge Function

Nenhuma RPC e nenhuma Edge Function participa do cálculo dessa bonificação. As únicas funções relacionadas a parceiros são:

- `upsert-indicacao` (Edge Function) — apenas grava indicação.
- `log_parceiros_campanha_change` (trigger no banco) — só registra mudança de `nome_campanha` em `parceiros_campanha_logs`.

Nenhuma das duas calcula, persiste ou retorna "bonificação + recorrência".

## Resumo executivo

| Pergunta | Resposta |
|---|---|
| Valor gravado no banco? | Não. |
| View/RPC/Edge Function? | Nenhuma. |
| Origem dos dados | Tabelas `parceiros_indicacoes`, `parceiros_recorrencias`, `parceiros_cadastro` |
| Onde é calculado | `src/pages/Parceiros.tsx`, memos `filtered` → `conversoes` (bonificação) e `recorrencias` → `recorrenciaPorEmbaixador` (recorrência) |
| Fórmula final | `Σ bonus(indicação) + Σ recorrência(contrato ativo, não vencido)` por embaixador, no período filtrado |

Posso seguir só com explicações ou prefere que eu prepare um plano para mover esse cálculo para uma view/RPC no Supabase?
