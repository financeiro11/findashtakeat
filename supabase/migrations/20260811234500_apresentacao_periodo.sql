/* ============================================================================
 * O período de uma apresentação.
 *
 * A Revisão é de um mês fechado; Conselho fala em trimestre e investidor em ano
 * e em últimos doze meses. Guardar isto na apresentação é o que permite ao mesmo
 * catálogo de cards servir às três plateias.
 *
 * SÓ O TIPO É GUARDADO, não a lista de meses. A janela é derivada na hora
 * (`src/lib/periodo.ts`) a partir do tipo + `mes` + os meses QUE TÊM DADO. Uma
 * lista congelada envelheceria: o 3T26 salvo em agosto com dois meses
 * continuaria com dois depois de setembro fechar, e a apresentação mostraria um
 * trimestre pela metade sem que ninguém percebesse.
 *
 * `mes` continua sendo o mês de FECHAMENTO — o que os cards mensais (cascata,
 * Pareto, DRE contra o orçado) desenham dentro de um período mais largo.
 * ========================================================================== */

alter table public.demonstracoes_apresentacoes
  add column if not exists periodo_tipo text not null default 'mes';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'demonstracoes_apresentacoes_periodo_tipo_check'
  ) then
    alter table public.demonstracoes_apresentacoes
      add constraint demonstracoes_apresentacoes_periodo_tipo_check
      check (periodo_tipo in ('mes','trimestre','semestre','ano','ultimos12'));
  end if;
end $$;

/* `apresentacao_salvar` ganha o período. O parâmetro entra no FIM e com padrão,
   para a assinatura antiga continuar resolvendo — o cliente publicado agora
   ainda chama a versão de cinco argumentos até a próxima carga da página. */
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
    insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, periodo_tipo, criada_por)
    values (
      p_mes, btrim(p_nome),
      coalesce(p_roteiro, '{"folhas":[]}'::jsonb),
      coalesce(p_textos, '{}'::jsonb),
      coalesce(p_periodo_tipo, 'mes'),
      auth.uid()
    )
    returning id into v_id;
    return v_id;
  end if;

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

  if v_id is null then
    raise exception 'Apresentação % não existe.', p_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) from public;
revoke all on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) from anon;
grant execute on function public.apresentacao_salvar(text, text, jsonb, jsonb, uuid, text) to authenticated;

/* A cópia leva o período do original — duplicar é para trocar a plateia, não a
   janela. */
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

  insert into public.demonstracoes_apresentacoes (mes, nome, roteiro, textos, periodo_tipo, criada_por)
  select mes, btrim(p_nome), roteiro, textos, periodo_tipo, auth.uid()
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
