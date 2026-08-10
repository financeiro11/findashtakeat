/* ============================================================================
 * Recomendações da fatura do cartão — a tela deixa de ser só espelho.
 *
 * A tela de Cartão já dizia O QUE mudou ("SYMPLA +15,8 mil"). O que faltava era
 * o que fazer com isso: quem olha a fatura precisa saber que a Sympla é praça de
 * ingresso e show, e portanto que um pico ali provavelmente é ingresso de evento
 * e a conversa é com o time de Eventos — e precisa saber que o HubSpot é
 * mensalidade que NÃO veio em mai/26, o que costuma ser cartão recusado (e de
 * fato jun/26 veio dobrado, 2,12× a mediana: a cobrança acumulada).
 *
 * A DIVISÃO DE TRABALHO é a mesma das justificativas da DRE:
 *   • O SINAL é determinístico, calculado em código a partir dos lançamentos
 *     (`cartao-recomendar`). Pico, ausência e cobrança dobrada saem de limiares
 *     fixos, calibrados contra as 8 faturas de 2026 — a regra tem de ser a mesma
 *     todo mês, senão "não apareceu nada" não significa nada.
 *   • A IA só REDIGE em cima do sinal: o que o estabelecimento provavelmente é,
 *     e com quem conferir. Ela não escolhe o que virou recomendação e não faz
 *     conta nenhuma — os números chegam prontos e formatados.
 * Por isso a `serie` e os `fatos` ficam salvos ao lado do texto: quem lê confere
 * a hipótese contra o histórico sem sair da tela, e o que for invenção morre ali.
 *
 * ANCORADA NA COMPETÊNCIA, e não no recorte da tela. Esta é a diferença em
 * relação a todo o resto da página (KPIs, matrizes, destaques são calculados na
 * hora, porque o período é um controle da tela). "O HubSpot faltou em mai/26" é
 * fato sobre mai/26 contra a história INTEIRA do fornecedor: continua verdade
 * com qualquer período selecionado. É o que permite guardar o texto sem criar
 * discrepância silenciosa — e é o que permite não pagar a IA duas vezes pela
 * mesma fatura.
 * ========================================================================== */

create table if not exists public.cartao_recomendacoes (
  id              uuid primary key default gen_random_uuid(),
  competencia     date not null references public.cartao_faturas(competencia) on delete cascade,
  estabelecimento text not null,
  -- 'pico'    = recorde histórico muito acima da mediana do próprio fornecedor
  -- 'ausente' = fornecedor mensal que não veio nesta fatura
  -- 'dobrada' = ~2x a mediana com a MESMA quantidade de lançamentos
  sinal           text not null check (sinal in ('pico','ausente','dobrada')),
  nivel           text not null default 'atencao' check (nivel in ('critico','atencao','info')),

  -- Título determinístico, escrito em código. Não é a IA que escreve o cabeçalho:
  -- é ele que a pessoa lê primeiro, e ele não pode ter hipótese dentro.
  titulo          text not null,

  /* Números CONGELADOS na geração. Guardados (e não recalculados na leitura)
     porque é contra eles que o texto foi escrito — se a fatura for reimportada,
     dá para perceber que a recomendação envelheceu em vez de exibi-la como
     atual. */
  valor           numeric,                     -- o que veio nesta fatura (0 no 'ausente')
  valor_referencia numeric,                    -- a mediana do próprio fornecedor
  razao           numeric,                     -- valor / mediana (207.3 = 207x)
  lancamentos     integer,
  /* A prova: [{m:'2026-08-01', v:15878.4, n:5}, …] mês a mês, a história toda.
     É a série que transforma "confie em mim" em "confira". */
  serie           jsonb not null default '[]'::jsonb,
  /* Fatos determinísticos que a IA recebeu — as frases que ELA não escreveu.
     Ficam salvos para dar para saber o que era dado e o que era redação. */
  fatos           jsonb not null default '[]'::jsonb,

  texto           text not null,               -- a leitura consultiva (IA)
  acao            text,                        -- o que fazer, em uma frase (IA)
  com_quem        text,                         -- time/pessoa da Biblioteca (IA)
  confianca       text check (confianca in ('alta','media','baixa')),

  -- Decisão humana. SOBREVIVE à regeração — ver o upsert em `cartao-recomendar`.
  status          text not null default 'novo' check (status in ('novo','aceito','descartado')),
  texto_editado   text,                        -- reescrita da pessoa; vence o `texto`
  editado_por     uuid,
  editado_em      timestamptz,
  -- A recomendação que virou tarefa no quadro. Guardado aqui para o botão não
  -- abrir a mesma tarefa duas vezes e para a tela poder dizer "já é tarefa".
  tarefa_id       uuid references public.tarefas(id) on delete set null,

  modelo          text,                        -- rastro de qual IA escreveu
  gerado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  -- Uma recomendação por (fatura, fornecedor, sinal). Regerar ATUALIZA, não empilha.
  unique (competencia, estabelecimento, sinal)
);

create index if not exists cartao_recomendacoes_fatura_idx
  on public.cartao_recomendacoes (competencia);

alter table public.cartao_recomendacoes enable row level security;

drop policy if exists "cartao_recomendacoes_select_auth" on public.cartao_recomendacoes;
create policy "cartao_recomendacoes_select_auth"
  on public.cartao_recomendacoes for select to authenticated using (true);
-- Escrita: geração pela service role (edge function) e decisão pelas funções
-- abaixo. Nada de update solto do cliente — a recomendação vira tarefa de gente,
-- então precisa de autor registrado.


/* ============================================================
 *  1) O insumo do detector: a série de cada fornecedor
 * ============================================================
 * Devolve UM jsonb, e não um conjunto de linhas, de propósito: são ~400
 * fornecedores × 8 faturas e o PostgREST corta a resposta no teto dele sem
 * avisar. Numa lista truncada o detector não erra pouco — ele passa a "não
 * encontrar" fornecedor que existe, o que é exatamente o sinal que ele deveria
 * dar (ver o bug de paginação em Cartao.tsx).
 *
 * Traz também a categoria dominante, um exemplo da descrição CRUA do OFX e a
 * cidade: é com isso que a IA distingue "JIM COM L G DA SILVA" de um SaaS. Sem
 * esse contexto ela inventaria o que o estabelecimento é.
 */
create or replace function public.cartao_series()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by x->>'e', x->>'m'), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'e',  estabelecimento,
             'm',  to_char(competencia, 'YYYY-MM-DD'),
             'v',  round(sum(valor), 2),
             'n',  count(*),
             'c',  (array_agg(categoria order by valor desc))[1],
             'd',  (array_agg(coalesce(descricao, '') order by valor desc))[1],
             'ci', (array_agg(coalesce(cidade, '') order by valor desc))[1]
           ) as x
    from public.cartao_lancamentos
    where tipo = 'gasto'
    group by estabelecimento, competencia
  ) s;
$$;

-- Função nova em `public` nasce chamável pelo `anon` (que é público, está no
-- bundle do front). Revogar do `anon` é o que fecha a porta — `from public` não
-- resolve.
revoke all on function public.cartao_series() from public;
revoke all on function public.cartao_series() from anon;
grant execute on function public.cartao_series() to authenticated;
grant execute on function public.cartao_series() to service_role;


/* ============================================================
 *  2) A decisão humana
 * ============================================================
 * Conferi / descartar / reescrever. Passa por função (e não update direto)
 * porque a recomendação circula como pedido de conferência para outro time:
 * precisa de autor e data, e o cliente não escolhe quem assina.
 *
 * `p_texto`:
 *   • null     → não mexe no texto
 *   • ''       → APAGA a reescrita e volta a valer o rascunho da IA
 *   • qualquer → vira `texto_editado` e passa a vencer o rascunho
 */
create or replace function public.cartao_recomendacao_decidir(
  p_id     uuid,
  p_status text default null,
  p_texto  text default null
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
  if p_status is not null and p_status not in ('novo','aceito','descartado') then
    raise exception 'Status inválido: %', p_status;
  end if;

  update public.cartao_recomendacoes
  set
    status        = coalesce(p_status, status),
    texto_editado = case
                      when p_texto is null     then texto_editado
                      when btrim(p_texto) = '' then null
                      else btrim(p_texto)
                    end,
    editado_por   = case when p_texto is null then editado_por else auth.uid() end,
    editado_em    = case when p_texto is null then editado_em  else now() end,
    atualizado_em = now()
  where id = p_id;

  if not found then
    raise exception 'Recomendação não encontrada.';
  end if;
end;
$$;

revoke all on function public.cartao_recomendacao_decidir(uuid, text, text) from public;
revoke all on function public.cartao_recomendacao_decidir(uuid, text, text) from anon;
grant execute on function public.cartao_recomendacao_decidir(uuid, text, text) to authenticated;


/* ============================================================
 *  3) Virar tarefa no quadro
 * ============================================================
 * "Conferir com o time de Eventos quais ingressos são" só vale se alguém tiver
 * de responder. Aqui a recomendação sai da tela do cartão e entra em /tarefas,
 * com o texto e os números no corpo — quem abrir a tarefa não precisa voltar
 * para entender.
 *
 * IDEMPOTENTE: chamar duas vezes devolve a MESMA tarefa. A ligação fica na
 * própria recomendação (`tarefa_id`), então o botão pode virar "ver tarefa" em
 * vez de abrir a terceira cópia do mesmo pedido. Se a tarefa foi apagada no
 * quadro, o `on delete set null` limpa o vínculo e uma nova pode ser criada.
 */
create or replace function public.cartao_recomendacao_tarefa(
  p_id          uuid,
  p_responsavel text default null,
  p_prazo       date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.cartao_recomendacoes;
  v_titulo   text;
  v_obs      text;
  v_ordem    int;
  v_tarefa   uuid;
  v_label    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select * into r from public.cartao_recomendacoes where id = p_id;
  if not found then
    raise exception 'Recomendação não encontrada.';
  end if;
  if r.tarefa_id is not null then
    return r.tarefa_id;   -- já virou tarefa; não duplica
  end if;

  select mes_label into v_label from public.cartao_faturas where competencia = r.competencia;
  v_label := coalesce(v_label, to_char(r.competencia, 'MM/YYYY'));

  -- O título é o pedido, não o diagnóstico: é ele que aparece no card do quadro.
  v_titulo := 'Cartão ' || v_label || ' — ' || r.estabelecimento || ': '
              || coalesce(nullif(btrim(r.acao), ''), 'conferir o lançamento');

  v_obs := coalesce(nullif(btrim(r.texto_editado), ''), r.texto)
           || case when r.com_quem is not null then E'\nConferir com: ' || r.com_quem else '' end
           || E'\n' || r.titulo
           || E'\nAberta da recomendação automática em Governança › Cartão (fatura de ' || v_label || ').';

  select coalesce(max(ordem), 0) + 1 into v_ordem from public.tarefas;

  insert into public.tarefas (
    ordem, titulo, responsavel, status, prioridade, prazo, observacao,
    subtarefas, cat_natureza, cat_area, cat_origem
  ) values (
    v_ordem,
    v_titulo,
    nullif(btrim(coalesce(p_responsavel, '')), ''),
    'Backlog',
    case when r.nivel = 'critico' then 'Alta' else 'Média' end,
    -- Prazo no fuso de quem lê: às 22h de Brasília o banco (UTC) já virou o dia
    -- e o prazo cairia um dia adiante do combinado.
    coalesce(p_prazo, (now() at time zone 'America/Sao_Paulo')::date + 3),
    v_obs,
    '[]'::jsonb,
    'Operacional',
    'Auditoria',
    'auto'
  )
  returning id into v_tarefa;

  -- Mesmo log da aba "Histórico" de /tarefas. Aqui o autor É conhecido (foi um
  -- clique de gente na tela do cartão), diferente do gatilho do Facilities.
  insert into public.tarefas_log (tarefa_id, tarefa_titulo, acao, descricao, usuario_id)
  values (v_tarefa, v_titulo, 'criada', 'Criada da recomendação do cartão: ' || r.titulo, auth.uid());

  update public.cartao_recomendacoes
     set tarefa_id = v_tarefa, atualizado_em = now()
   where id = p_id;

  return v_tarefa;
end;
$$;

revoke all on function public.cartao_recomendacao_tarefa(uuid, text, date) from public;
revoke all on function public.cartao_recomendacao_tarefa(uuid, text, date) from anon;
grant execute on function public.cartao_recomendacao_tarefa(uuid, text, date) to authenticated;
