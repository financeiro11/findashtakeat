/* ============================================================================
 * Texto do título do Omie (observação, documento, NF, favorecido), por título.
 *
 * POR QUE EXISTE: no drill-down da DRE/DFC, todo gasto de cartão aparece com a
 * mesma contraparte — "Lancamento Fatura Cartao" — porque é assim que a fatura
 * entra no ERP. Trinta e seis linhas idênticas numa célula, e o que cada uma É
 * fica só na OBSERVAÇÃO do título:
 *
 *   "Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.
 *    |OPENAI *CHATGPT SUBS          OPENAI.COM - R$ 525,00  U$ 102,79  V.DOL 5,1075"
 *
 * Depois do "|" está o MEMO da fatura — o mesmo texto, com as mesmas colunas, que
 * o parser do cartão já sabe ler (src/lib/cartao/ofx.ts).
 *
 * POR QUE UMA TABELA E NÃO O CACHE: a observação NÃO vem em ListarMovimentos nem
 * em ListarContasPagar — só em `ConsultarContaPagar`, UMA CHAMADA POR TÍTULO
 * (medido em 05/08/2026, ver omie-contas-pagar-sync). Buscar isso a cada abertura
 * do painel seria absurdo, e o cache `omie_cache/contas_pagar` só guarda a janela
 * de dias que o Briefing confere — a DRE olha meses fechados, muito além dela.
 * Aqui o texto de um título é lido UMA vez e vale para sempre: título é imutável
 * nesse campo para efeito de auditoria, e o que muda (valor, status) segue vindo
 * do cache de movimentos.
 *
 * `lido_em` marca "já perguntei ao Omie" mesmo quando a observação volta vazia —
 * senão o mesmo título vazio custaria uma chamada por abertura, para sempre.
 * ========================================================================== */

create table if not exists public.omie_titulo_texto (
  cod_titulo   bigint primary key,          -- nCodTitulo, o mesmo do drill-down
  observacao   text,
  documento    text,
  nota_fiscal  text,
  favorecido   text,                        -- nome da transferência (CNAB)
  lido_em      timestamptz not null default now()
);

alter table public.omie_titulo_texto enable row level security;

-- Leitura: qualquer pessoa logada — é o texto que a auditoria da DRE/DFC mostra.
drop policy if exists "auth read omie_titulo_texto" on public.omie_titulo_texto;
create policy "auth read omie_titulo_texto"
  on public.omie_titulo_texto for select to authenticated using (true);

-- Escrita: só a service role, pela edge function `omie-titulo-texto` (que é quem
-- fala com o Omie). Nenhum caminho do cliente inventa texto de título.
