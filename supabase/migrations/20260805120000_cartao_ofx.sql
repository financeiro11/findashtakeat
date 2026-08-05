/* ============================================================================
 * Cartão corporativo (Sicoob) — evolução das faturas OFX.
 *
 * O OFX da fatura é ilegível a olho nu: o MEMO vem mascarado pelo adquirente
 * ("FACEBK *ADS", "DL*GOOGLE", "EBN*CANVA"), com parcela, cidade e cauda
 * internacional grudadas no nome. Quem sabe desembrulhar isso é a skill
 * "Evolução / Comparativo de Faturas do Cartão (OFX)" rodando no Claude: ela lê
 * os arquivos, normaliza o estabelecimento e classifica cada lançamento.
 *
 * A DIVISÃO DE TRABALHO é a decisão central deste módulo:
 *   • a skill entrega os LANÇAMENTOS já normalizados (é o que o Hub não sabe
 *     fazer — parsear OFX e reconhecer que "EBN*CAPCUT" é a CapCut);
 *   • o Hub calcula TUDO o mais na hora de exibir — KPIs, matrizes, destaques,
 *     leitura rápida.
 *
 * Guardar o texto pronto seria mais simples e estaria errado: recortar o período
 * na tela (de fev/26 a ago/26) muda todo KPI, toda matriz e toda frase da leitura
 * rápida. Texto congelado ao lado de matriz viva é como se cria discrepância
 * silenciosa — e este número vai para o fechamento.
 * ========================================================================== */

/* ------------------------------------------------------------------
 * 1) A fatura (o cabeçalho de cada mês)
 * ------------------------------------------------------------------
 * `competencia` é o 1º dia do MÊS DA FATURA, não do fechamento: o ciclo que
 * fecha em 30/04 é a fatura de maio. Quem decide isso é a skill (ela lê o
 * DTASOF do LEDGERBAL); aqui só se guarda o resultado, junto com a data de
 * fechamento, para dar pra conferir a atribuição depois.
 */
create table if not exists public.cartao_faturas (
  competencia   date primary key,           -- 2026-08-01 → fatura de ago/26
  mes_label     text not null,              -- 'ago/26' — rótulo que a skill usou
  fechamento    date,                       -- DTASOF do LEDGERBAL
  arquivo       text,                       -- nome do .ofx de origem
  importado_em  timestamptz not null default now(),
  importado_por uuid
);

/* ------------------------------------------------------------------
 * 2) Os lançamentos (a matéria-prima de tudo o que a tela mostra)
 * ------------------------------------------------------------------
 * Um registro por <STMTTRN>. `valor` é sempre POSITIVO — o sinal do OFX vira a
 * coluna `tipo`, porque misturar gasto e pagamento no mesmo sinal obrigaria
 * toda consulta a lembrar da convenção.
 */
create table if not exists public.cartao_lancamentos (
  id              uuid primary key default gen_random_uuid(),
  competencia     date not null references public.cartao_faturas(competencia) on delete cascade,
  data            date,                     -- DTPOSTED
  estabelecimento text not null,            -- nome canônico já normalizado pela skill
  categoria       text not null,            -- categoria da skill; o Hub pode sobrepor
  descricao       text,                     -- MEMO original, para auditar a normalização
  parcela         text,                     -- '2/10'
  cidade          text,
  valor           numeric not null,         -- sempre >= 0
  -- 'gasto' = compra/IOF/anuidade; 'pagamento' = PAGAMENTO-BOLETO; 'estorno' =
  -- devolução ou reversão de tarifa. Só 'gasto' entra nas matrizes.
  tipo            text not null default 'gasto' check (tipo in ('gasto','pagamento','estorno')),
  fitid           text                      -- id do OFX, para rastrear a linha na origem
);

create index if not exists cartao_lancamentos_comp_idx on public.cartao_lancamentos (competencia);
create index if not exists cartao_lancamentos_estab_idx on public.cartao_lancamentos (estabelecimento);

/* ------------------------------------------------------------------
 * 3) Marcação — "olha isso aqui"
 * ------------------------------------------------------------------
 * A bandeirinha da coluna REV. Serve para o gasto que está crescendo demais ou
 * que ninguém reconhece: quem fecha o mês marca a linha para não ter de lembrar
 * dela na próxima fatura, e o marcado sobe para o painel de destaques.
 *
 * A marca é por ESTABELECIMENTO, e não por lançamento, porque a pergunta que se
 * faz é sobre o fornecedor ("o que é essa CURSOR?", "por que a META ADS não
 * para de subir?") — e assim ela continua valendo quando a fatura do mês que vem
 * chegar, que é justamente quando a dúvida volta.
 */
create table if not exists public.cartao_marcacoes (
  estabelecimento text primary key,
  nota            text,                     -- o porquê, opcional
  marcado_por     uuid,
  marcado_em      timestamptz not null default now()
);

alter table public.cartao_faturas      enable row level security;
alter table public.cartao_lancamentos  enable row level security;
alter table public.cartao_marcacoes    enable row level security;

drop policy if exists "cartao_faturas_select_auth" on public.cartao_faturas;
create policy "cartao_faturas_select_auth"
  on public.cartao_faturas for select to authenticated using (true);

drop policy if exists "cartao_lancamentos_select_auth" on public.cartao_lancamentos;
create policy "cartao_lancamentos_select_auth"
  on public.cartao_lancamentos for select to authenticated using (true);

drop policy if exists "cartao_marcacoes_select_auth" on public.cartao_marcacoes;
create policy "cartao_marcacoes_select_auth"
  on public.cartao_marcacoes for select to authenticated using (true);
-- Escrita só pelas funções abaixo: a importação vem da skill (service role) e a
-- marcação precisa de autor registrado.


/* ============================================================
 *  Importação — o ponto de entrada da skill
 * ============================================================
 * Uma chamada, um payload, idempotente POR MÊS: reimportar ago/26 troca ago/26
 * inteiro e não encosta nos outros. É o que permite reprocessar um OFX que veio
 * truncado sem ter de refazer o período todo.
 *
 * Payload:
 *   { "faturas": [ {
 *       "competencia": "2026-08-01",     -- 1º dia do mês DA FATURA
 *       "mes_label":   "ago/26",
 *       "fechamento":  "2026-07-30",     -- DTASOF (opcional)
 *       "arquivo":     "ago26.ofx",      -- (opcional)
 *       "lancamentos": [ {
 *           "data": "2026-07-15", "estabelecimento": "META ADS",
 *           "categoria": "Mídia / Tráfego pago", "descricao": "FACEBK *ADS 123",
 *           "parcela": "1/3", "cidade": "SAO PAULO",
 *           "valor": 34600.00,           -- SEMPRE positivo
 *           "tipo": "gasto",             -- gasto | pagamento | estorno
 *           "fitid": "..." } ] } ] }
 */
create or replace function public.cartao_importar(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f          jsonb;
  v_comp     date;
  v_n        int;
  v_total    int := 0;
  v_faturas  int := 0;
  v_meses    text[] := '{}';
begin
  for f in select * from jsonb_array_elements(coalesce(p_payload->'faturas', '[]'::jsonb)) loop
    -- Normaliza para o 1º do mês: a skill pode mandar qualquer dia dentro dele.
    v_comp := date_trunc('month', (f->>'competencia')::date)::date;

    insert into public.cartao_faturas (competencia, mes_label, fechamento, arquivo, importado_em, importado_por)
    values (
      v_comp,
      coalesce(nullif(btrim(f->>'mes_label'), ''), to_char(v_comp, 'MM/YY')),
      nullif(f->>'fechamento', '')::date,
      nullif(btrim(f->>'arquivo'), ''),
      now(),
      auth.uid()
    )
    on conflict (competencia) do update set
      mes_label    = excluded.mes_label,
      -- `coalesce` e não `excluded` direto: reimportar sem o campo não apaga o
      -- que já estava lá.
      fechamento   = coalesce(excluded.fechamento, cartao_faturas.fechamento),
      arquivo      = coalesce(excluded.arquivo,    cartao_faturas.arquivo),
      importado_em = now();

    -- Troca o mês inteiro. O `on delete cascade` não serve aqui (a fatura fica),
    -- então é delete explícito antes do insert.
    delete from public.cartao_lancamentos where competencia = v_comp;

    insert into public.cartao_lancamentos
      (competencia, data, estabelecimento, categoria, descricao, parcela, cidade, valor, tipo, fitid)
    select
      v_comp,
      nullif(l->>'data', '')::date,
      btrim(l->>'estabelecimento'),
      coalesce(nullif(btrim(l->>'categoria'), ''), 'Outros (diversos)'),
      nullif(l->>'descricao', ''),
      nullif(l->>'parcela', ''),
      nullif(l->>'cidade', ''),
      abs((l->>'valor')::numeric),
      coalesce(nullif(l->>'tipo', ''), 'gasto'),
      nullif(l->>'fitid', '')
    from jsonb_array_elements(coalesce(f->'lancamentos', '[]'::jsonb)) l
    where nullif(btrim(l->>'estabelecimento'), '') is not null;

    get diagnostics v_n = row_count;
    v_total   := v_total + v_n;
    v_faturas := v_faturas + 1;
    v_meses   := v_meses || coalesce(f->>'mes_label', to_char(v_comp, 'MM/YY'));
  end loop;

  return jsonb_build_object(
    'ok', true, 'faturas', v_faturas, 'lancamentos', v_total, 'meses', to_jsonb(v_meses)
  );
end;
$$;

revoke all on function public.cartao_importar(jsonb) from public;
revoke all on function public.cartao_importar(jsonb) from anon;
grant execute on function public.cartao_importar(jsonb) to authenticated;
grant execute on function public.cartao_importar(jsonb) to service_role;


/* ============================================================
 *  Marcar / desmarcar para revisão
 * ============================================================
 * `p_marcado = false` apaga a marca (e a nota junto). Marcar de novo com nota
 * diferente sobrescreve — a marca é um estado atual, não um histórico.
 */
create or replace function public.cartao_marcar(
  p_estabelecimento text,
  p_marcado         boolean default true,
  p_nota            text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if nullif(btrim(coalesce(p_estabelecimento, '')), '') is null then
    raise exception 'Estabelecimento obrigatório.';
  end if;

  if not coalesce(p_marcado, true) then
    delete from public.cartao_marcacoes where estabelecimento = btrim(p_estabelecimento);
    return;
  end if;

  insert into public.cartao_marcacoes (estabelecimento, nota, marcado_por, marcado_em)
  values (btrim(p_estabelecimento), nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), now())
  on conflict (estabelecimento) do update set
    nota        = excluded.nota,
    marcado_por = excluded.marcado_por,
    marcado_em  = now();
end;
$$;

revoke all on function public.cartao_marcar(text, boolean, text) from public;
revoke all on function public.cartao_marcar(text, boolean, text) from anon;
grant execute on function public.cartao_marcar(text, boolean, text) to authenticated;
