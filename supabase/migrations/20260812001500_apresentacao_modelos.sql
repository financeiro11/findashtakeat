/* ============================================================================
 * Modelos de apresentação — o deck que se repete.
 *
 * O material do Conselho é o mesmo todo trimestre, com números novos. Montar de
 * novo a cada virada é trabalho que a máquina faz: o MODELO guarda o roteiro
 * SEM período e sem mês, e gerar cria uma apresentação apontando para a janela
 * pedida — os números vêm sozinhos, porque o roteiro guarda chaves de card e
 * não valores.
 *
 * POR QUE TABELA PRÓPRIA, E NÃO UMA FLAG EM `demonstracoes_apresentacoes`
 *   Lá, `mes` é NOT NULL e a chave é `(mes, nome)` — um modelo não tem mês, e
 *   afrouxar isso para caber os dois enfraqueceria a única trava que impede duas
 *   apresentações homônimas no mesmo mês. Modelo também não tem status,
 *   congelado nem publicação: metade das colunas ficaria nula por definição.
 *
 * O QUE O MODELO NÃO GUARDA
 *   Texto de apresentação (o "por que" reescrito para uma plateia) fica na
 *   APRESENTAÇÃO. Ele fala de um mês específico — carregá-lo no modelo faria o
 *   deck do 4T sair explicando o que aconteceu no 3T.
 * ========================================================================== */

create table if not exists public.demonstracoes_apresentacao_modelos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  descricao     text,

  /* Mesma forma do roteiro de uma apresentação (`src/lib/apresentacao.ts`).
     Pode conter peça de card, de texto e de série — a de card é a que se
     atualiza sozinha; texto e série vão junto como estão. */
  roteiro       jsonb not null default '{"folhas":[]}'::jsonb,

  /* A janela que este modelo pede. É o que faz "Conselho Trimestral" nascer
     trimestral sem ninguém ter de lembrar de trocar o seletor depois. */
  periodo_tipo  text not null default 'mes'
                check (periodo_tipo in ('mes','trimestre','semestre','ano','ultimos12')),

  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.demonstracoes_apresentacao_modelos enable row level security;

drop policy if exists "apresentacao_modelos_select_auth" on public.demonstracoes_apresentacao_modelos;
create policy "apresentacao_modelos_select_auth"
  on public.demonstracoes_apresentacao_modelos for select to authenticated using (true);


/* ============================================================
 *  Salvar (criar ou atualizar) — devolve o id
 * ============================================================ */
create or replace function public.modelo_apresentacao_salvar(
  p_nome         text,
  p_roteiro      jsonb,
  p_periodo_tipo text default 'mes',
  p_descricao    text default null,
  p_id           uuid default null
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
    raise exception 'O modelo precisa de um nome.';
  end if;
  if p_periodo_tipo not in ('mes','trimestre','semestre','ano','ultimos12') then
    raise exception 'Período inválido: %', p_periodo_tipo;
  end if;

  if p_id is null then
    insert into public.demonstracoes_apresentacao_modelos (nome, roteiro, periodo_tipo, descricao, criado_por)
    values (btrim(p_nome), coalesce(p_roteiro, '{"folhas":[]}'::jsonb), p_periodo_tipo, p_descricao, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update public.demonstracoes_apresentacao_modelos
  set nome          = btrim(p_nome),
      roteiro       = coalesce(p_roteiro, roteiro),
      periodo_tipo  = p_periodo_tipo,
      descricao     = coalesce(p_descricao, descricao),
      atualizado_em = now()
  where id = p_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Modelo % não existe.', p_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.modelo_apresentacao_salvar(text, jsonb, text, text, uuid) from public;
revoke all on function public.modelo_apresentacao_salvar(text, jsonb, text, text, uuid) from anon;
grant execute on function public.modelo_apresentacao_salvar(text, jsonb, text, text, uuid) to authenticated;


create or replace function public.modelo_apresentacao_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  -- Excluir o modelo NÃO mexe nas apresentações já geradas a partir dele: elas
  -- viraram documento próprio no instante em que nasceram.
  delete from public.demonstracoes_apresentacao_modelos where id = p_id;
  if not found then
    raise exception 'Modelo % não existe.', p_id;
  end if;
end;
$$;

revoke all on function public.modelo_apresentacao_excluir(uuid) from public;
revoke all on function public.modelo_apresentacao_excluir(uuid) from anon;
grant execute on function public.modelo_apresentacao_excluir(uuid) to authenticated;
