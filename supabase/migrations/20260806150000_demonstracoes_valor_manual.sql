/* ============================================================================
 * Valor manual na célula da DRE/DFC.
 *
 * Parte da demonstração nunca vem do Omie nem do tracker: depreciação e
 * amortização, provisão, imposto ainda não lançado, ajuste de fechamento. Isso
 * sempre foi digitado à mão na planilha. No Hub não dava: escrever direto em
 * `demonstracoes_contabeis` dura até a próxima sincronização — o omie-sync
 * reescreve todo mês aberto do zero e o import de tracker zera o mês que traz.
 *
 * Então o número digitado passa a morar AQUI, e o blob vira consequência: no fim
 * de toda escrita (sync, import ou edição pela tela) os manuais são reaplicados
 * por cima. Ver supabase/functions/_shared/valores-manuais.ts.
 *
 * Os dois campos que parecem redundantes (`valor_base` e `valor_aplicado`) são o
 * que impede o valor de dobrar: reaplicar em mês TRAVADO encontra o delta da vez
 * passada ainda na célula e no total. Guardando o que havia antes e o que foi
 * gravado, a reaplicação vira idempotente e o "remover" sabe ao que voltar.
 * ========================================================================== */

create table if not exists public.demonstracoes_valor_manual (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('dre','dfc')),
  rubrica        text not null,              -- rótulo da linha, igual ao da tela
  col_key        text not null,              -- 'Jun-26', a chave de coluna da tela

  -- 'substitui' troca o que veio do Omie/tracker; 'soma' complementa (a rubrica
  -- vem parcial do ERP e o resto é lançado à mão).
  modo           text not null default 'substitui' check (modo in ('substitui','soma')),
  valor          numeric not null,           -- despesa entra NEGATIVA, como no blob

  -- Rastro da última aplicação no blob. `valor_base` null = a célula não existia.
  valor_base     numeric,
  valor_aplicado numeric,

  autor          uuid,
  autor_email    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- Um valor manual por célula. Reeditar ATUALIZA, não empilha.
  unique (tipo, rubrica, col_key)
);

create index if not exists demonstracoes_valor_manual_tela_idx
  on public.demonstracoes_valor_manual (tipo, col_key);

alter table public.demonstracoes_valor_manual enable row level security;

-- Leitura: qualquer pessoa logada — a tela precisa marcar as células manuais.
drop policy if exists "auth read demonstracoes_valor_manual" on public.demonstracoes_valor_manual;
create policy "auth read demonstracoes_valor_manual"
  on public.demonstracoes_valor_manual for select to authenticated using (true);

-- Escrita: só pela service role, na edge function `demonstracoes-valor-manual`.
-- Não é zelo excessivo: gravar a linha sem reaplicar no blob deixaria a tabela
-- dizendo uma coisa e a demonstração mostrando outra. E o número vai para o
-- resultado do mês — precisa de autor registrado.
