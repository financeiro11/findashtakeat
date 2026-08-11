/* ============================================================================
 * Apresentações da Revisão do Mês — o roteiro da reunião.
 *
 * A tela da revisão sempre teve cinco blocos fixos, e a reunião não é fixa: numa
 * o assunto é o caixa, na outra o caixa não entra e o churn abre a conversa.
 * Esta tabela guarda O ROTEIRO — quais cards aparecem, em que ordem, em qual
 * folha — sem guardar um só número.
 *
 * POR QUE O ROTEIRO NÃO GUARDA NÚMERO NEM O TEXTO DA IA
 *   Guardar viraria uma segunda verdade envelhecendo em paralelo com a DRE: o
 *   Omie mexe no mês, a DRE muda, e a apresentação continuaria mostrando o
 *   número de anteontem sem avisar ninguém. Enquanto é RASCUNHO, a apresentação
 *   lê os números de agora. Quando é PUBLICADA, aí sim congela (ver `congelado`)
 *   — porque aí ela virou ata, não previsão.
 *
 * VÁRIAS POR MÊS. "Tracker CEO", "Board 3T" e "Sócios" olham os mesmos números
 * com recortes diferentes. É por isso que a chave é (mes, nome) e não só mes,
 * ao contrário de `demonstracoes_revisao`, que é a LEITURA do mês e é uma só.
 * ========================================================================== */

create table if not exists public.demonstracoes_apresentacoes (
  id            uuid primary key default gen_random_uuid(),
  -- Chave de coluna do blob ("Jul-26"), a mesma de `demonstracoes_revisao`.
  mes           text not null,
  nome          text not null,

  /* ---- o roteiro ----
     { folhas: [ { id, titulo, pecas: [ {id, tipo:'card', chave}
                                      | {id, tipo:'texto', titulo, corpo}
                                      | {id, tipo:'serie', titulo, rubrica, meses, formato} ] } ] }
     A forma e as operações moram em `src/lib/apresentacao.ts`, com teste. Aqui
     é jsonb de propósito: a lista de cards do Hub muda toda semana e uma coluna
     por card viraria migration a cada card novo. */
  roteiro       jsonb not null default '{"folhas":[]}'::jsonb,

  /* ---- o texto QUE É DESTA APRESENTAÇÃO ----
     { "porque:Pessoal": "…", "impacto:Marketing": "…" }
     O "por que aconteceu" vem da célula da DRE (`revisao_justificativas`) e
     continua sendo a fonte. Reescrever aqui NÃO volta para a DRE: a mesma
     rubrica pode precisar de uma frase para o CEO e de outra para o board, e o
     comentário do fechamento é da contabilidade, não da plateia. Chave vazia
     (ou ausente) = vale o texto de origem. */
  textos        jsonb not null default '{}'::jsonb,

  status        text not null default 'rascunho' check (status in ('rascunho','publicada')),

  /* ---- a ata ----
     Preenchido no publicar: o HTML de cada peça como ela estava na tela, mais a
     leitura e o sinal do momento. Reabrir uma apresentação publicada mostra o
     que o CEO viu, mesmo que o Omie tenha mexido no mês depois — e a tela
     compara com o número de hoje para dizer "isto mudou".
     { html: {<peçaId>: "<div…>"}, leitura: {...}, sinal: {...}, em: "..." } */
  congelado     jsonb,
  publicada_em  timestamptz,
  publicada_por uuid,

  criada_por    uuid,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),

  unique (mes, nome)
);

create index if not exists demonstracoes_apresentacoes_mes_idx
  on public.demonstracoes_apresentacoes (mes, atualizada_em desc);

alter table public.demonstracoes_apresentacoes enable row level security;

drop policy if exists "demonstracoes_apresentacoes_select_auth" on public.demonstracoes_apresentacoes;
create policy "demonstracoes_apresentacoes_select_auth"
  on public.demonstracoes_apresentacoes for select to authenticated using (true);
-- Escrita só pelas funções abaixo: a apresentação vai para uma reunião com o
-- CEO, então quem mexeu e quando fica registrado.


/* ============================================================
 *  Salvar (criar ou atualizar) — devolve o id
 * ============================================================
 * Um upsert só, em vez de create + update separados: o montador salva a cada
 * mudança e não deveria ter de saber se a apresentação já nasceu.
 *
 * Apresentação PUBLICADA não é editada por engano: salvar por cima dela volta o
 * status para rascunho e APAGA o congelado. Uma ata que muda de conteúdo sem
 * mudar de nome é pior que não ter ata.
 */
create or replace function public.apresentacao_salvar(
  p_mes     text,
  p_nome    text,
  p_roteiro jsonb,
  p_textos  jsonb default '{}'::jsonb,
  p_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'A apresentação precisa de um nome.';
  end if;

  if p_id is null then
    insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, criada_por)
    values (p_mes, btrim(p_nome), coalesce(p_roteiro, '{"folhas":[]}'::jsonb), coalesce(p_textos, '{}'::jsonb), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update public.demonstracoes_apresentacoes
  set nome          = btrim(p_nome),
      roteiro       = coalesce(p_roteiro, roteiro),
      textos        = coalesce(p_textos, textos),
      status        = 'rascunho',
      congelado     = null,
      publicada_em  = null,
      publicada_por = null,
      atualizada_em = now()
  where id = p_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid) from public;
revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid) from anon;
grant execute on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid) to authenticated;


/* ============================================================
 *  Publicar — congela o que foi apresentado
 * ============================================================
 * O congelado chega PRONTO do cliente (o HTML de cada peça já renderizada). O
 * banco não tem como remontar um card do Hub, e reconstituir o número aqui
 * seria uma terceira implementação da DRE — a que sempre diverge.
 */
create or replace function public.apresentacao_publicar(
  p_id        uuid,
  p_congelado jsonb
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
  if p_congelado is null or p_congelado = '{}'::jsonb then
    raise exception 'Sem o congelado não há o que publicar.';
  end if;

  update public.demonstracoes_apresentacoes
  set status        = 'publicada',
      congelado     = p_congelado,
      publicada_em  = now(),
      publicada_por = auth.uid(),
      atualizada_em = now()
  where id = p_id;

  if not found then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
end;
$$;

revoke all on function public.apresentacao_publicar(uuid, jsonb) from public;
revoke all on function public.apresentacao_publicar(uuid, jsonb) from anon;
grant execute on function public.apresentacao_publicar(uuid, jsonb) to authenticated;


/* ============================================================
 *  Duplicar e excluir
 * ============================================================
 * Duplicar é a operação que faz "várias por mês" valer a pena: monta-se o
 * Tracker, duplica-se para o Board e tira-se o que não interessa àquela plateia.
 * A cópia nasce SEMPRE como rascunho, sem o congelado do original.
 */
create or replace function public.apresentacao_duplicar(
  p_id   uuid,
  p_nome text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, criada_por)
  select mes, btrim(p_nome), roteiro, textos, auth.uid()
  from public.demonstracoes_apresentacoes
  where id = p_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.apresentacao_duplicar(uuid, text) from public;
revoke all on function public.apresentacao_duplicar(uuid, text) from anon;
grant execute on function public.apresentacao_duplicar(uuid, text) to authenticated;


create or replace function public.apresentacao_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  delete from public.demonstracoes_apresentacoes where id = p_id;
  if not found then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
end;
$$;

revoke all on function public.apresentacao_excluir(uuid) from public;
revoke all on function public.apresentacao_excluir(uuid) from anon;
grant execute on function public.apresentacao_excluir(uuid) to authenticated;
