/* ============================================================================
 * O nome que ainda não existe.
 *
 * `(mes, nome)` é único de propósito: é a trava que impede duas "Revisão de
 * Julho/26" no mesmo mês. Só que a colisão é ROTINA, não erro de quem clicou —
 * a apresentação nasce da primeira mexida, e uma mexida na tela de trabalho
 * quando o mês já tem apresentação caía no INSERT com o nome padrão já tomado.
 * O que chegava na tela era "duplicate key value violates unique constraint
 * demonstracoes_apresentacoes_mes_nome_key", que não ensina nada a ninguém.
 *
 * O cliente já escolhe um nome livre antes de gravar (`nomeLivre`, em
 * `src/lib/apresentacao.ts`). Isto aqui é a rede embaixo: duas abas podem
 * calcular o mesmo nome no mesmo instante, e quem perde a corrida tem de sair
 * com uma apresentação criada, não com um erro do Postgres.
 *
 * O sufixo é " (2)", " (3)" — o mesmo do cliente, e não a hora nem um id,
 * porque o nome vai para o seletor da reunião e alguém vai ter de ler.
 * ========================================================================== */

create or replace function public.apresentacao_nome_livre(p_mes text, p_nome text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select case when g.i = 1 then btrim(p_nome) else btrim(p_nome) || ' (' || g.i || ')' end
       from generate_series(1, 500) as g(i)
      where not exists (
        select 1 from public.demonstracoes_apresentacoes a
         where a.mes = p_mes
           and a.nome = case when g.i = 1 then btrim(p_nome)
                             else btrim(p_nome) || ' (' || g.i || ')' end)
      order by g.i
      limit 1),
    btrim(p_nome));
$$;

revoke all on function public.apresentacao_nome_livre(text, text) from public;
revoke all on function public.apresentacao_nome_livre(text, text) from anon;
grant execute on function public.apresentacao_nome_livre(text, text) to authenticated;


/* ============================================================
 *  Salvar — nascer nunca esbarra no nome
 * ============================================================
 * CRIAR desvia para o nome livre. RENOMEAR, não: ali o nome foi digitado de
 * propósito, e trocá-lo por baixo faria a tela mostrar um nome e o banco guardar
 * outro. O que muda no renomear é só a mensagem — a frase do Postgres vira uma
 * em português.
 */
create or replace function public.apresentacao_salvar(
  p_mes          text,
  p_nome         text,
  p_roteiro      jsonb,
  p_textos       jsonb default '{}'::jsonb,
  p_id           uuid default null,
  p_periodo_tipo text default null
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
  if p_periodo_tipo is not null
     and p_periodo_tipo not in ('mes','trimestre','semestre','ano','ultimos12') then
    raise exception 'Período inválido: %', p_periodo_tipo;
  end if;

  if p_id is null then
    -- Cinco tentativas: o nome livre é calculado e gravado em passos separados,
    -- e entre um e outro outra aba pode ter levado o nome.
    for v_tentativa in 1..5 loop
      begin
        insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, periodo_tipo, criada_por)
        values (
          p_mes,
          public.apresentacao_nome_livre(p_mes, p_nome),
          coalesce(p_roteiro, '{"folhas":[]}'::jsonb),
          coalesce(p_textos, '{}'::jsonb),
          coalesce(p_periodo_tipo, 'mes'),
          auth.uid()
        )
        returning id into v_id;
        return v_id;
      exception when unique_violation then
        null; -- alguém chegou primeiro: recalcula e tenta o próximo sufixo
      end;
    end loop;
    raise exception 'Não consegui um nome livre a partir de "%" em %.', btrim(p_nome), p_mes;
  end if;

  begin
    update public.demonstracoes_apresentacoes
    set nome          = btrim(p_nome),
        roteiro       = coalesce(p_roteiro, roteiro),
        textos        = coalesce(p_textos, textos),
        periodo_tipo  = coalesce(p_periodo_tipo, periodo_tipo),
        status        = 'rascunho',
        congelado     = null,
        publicada_em  = null,
        publicada_por = null,
        atualizada_em = now()
    where id = p_id
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe uma apresentação chamada "%" em %.', btrim(p_nome), p_mes;
  end;

  if v_id is null then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) from public;
revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) from anon;
grant execute on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) to authenticated;


/* ============================================================
 *  Duplicar — a cópia também acha o nome dela
 * ============================================================
 * "Board 3T (cópia)" duas vezes é o caminho normal de quem está experimentando
 * recortes para a mesma plateia. A segunda vira "Board 3T (cópia) (2)".
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
  v_id  uuid;
  v_mes text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;

  select mes into v_mes from public.demonstracoes_apresentacoes where id = p_id;
  if v_mes is null then
    raise exception 'Apresentação % não existe.', p_id;
  end if;

  for v_tentativa in 1..5 loop
    begin
      insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, periodo_tipo, criada_por)
      select mes, public.apresentacao_nome_livre(v_mes, p_nome), roteiro, textos, periodo_tipo, auth.uid()
      from public.demonstracoes_apresentacoes
      where id = p_id
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'Não consegui um nome livre a partir de "%" em %.', btrim(p_nome), v_mes;
end;
$$;

revoke all on function public.apresentacao_duplicar(uuid, text) from public;
revoke all on function public.apresentacao_duplicar(uuid, text) from anon;
grant execute on function public.apresentacao_duplicar(uuid, text) to authenticated;
