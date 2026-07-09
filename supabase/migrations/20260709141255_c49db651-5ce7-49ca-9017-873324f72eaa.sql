
create or replace function public.preview_msg_ajuste(p_id_unico text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.auditoria%rowtype;
  d_gestor_id uuid;
  c_nome text;
  c_tel text;
  v_first text;
  v_msg text;
  v_exige_nf boolean;
  v_valor_fmt text;
  v_comp_fmt text;
  v_dig text;
begin
  select * into a from public.auditoria where id_unico = p_id_unico;
  if not found then
    raise exception 'Lançamento % não encontrado', p_id_unico;
  end if;

  select gestor_id into d_gestor_id
    from public.lib_departamentos
    where lower(nome) = lower(coalesce(a.area,''))
    limit 1;

  if d_gestor_id is not null then
    select nome, telefone into c_nome, c_tel
    from public.lib_colaboradores where id = d_gestor_id;
  end if;

  v_first := nullif(split_part(coalesce(c_nome,''), ' ', 1), '');
  v_exige_nf := coalesce(a.regra ilike '%nota fiscal%' or a.regra ilike '%NF%' or a.categoria ilike '%SEM NF%', false);
  v_valor_fmt := to_char(coalesce(a.valor,0), 'FM999G999G990D00');
  v_comp_fmt := to_char(a.competencia, 'MM/YYYY');
  v_dig := regexp_replace(coalesce(c_tel,''), '\D', '', 'g');

  v_msg :=
    'Olá, ' || coalesce(v_first, 'time') || '! 👋' || E'\n\n' ||
    'Identificamos um lançamento na área *' || coalesce(a.area,'—') || '* que precisa de ajuste:' || E'\n\n' ||
    '• *' || coalesce(a.titulo,'—') || '*' || E'\n' ||
    '• Valor: R$ ' || v_valor_fmt || E'\n' ||
    '• Competência: ' || coalesce(v_comp_fmt,'—') || E'\n' ||
    '• Regra: ' || coalesce(a.regra,'—') || E'\n\n' ||
    case when v_exige_nf then '⚠️ Este lançamento exige anexo da nota fiscal.' || E'\n\n' else '' end ||
    'Poderia revisar e nos retornar? Obrigado!';

  return json_build_object(
    'telefone', c_tel,
    'gestor_nome', coalesce(c_nome, ''),
    'primeiro_nome', coalesce(v_first, ''),
    'area', a.area,
    'mensagem', v_msg,
    'exige_nf', v_exige_nf,
    'telefone_ok', length(v_dig) >= 10
  );
end;
$$;

grant execute on function public.preview_msg_ajuste(text) to authenticated, service_role;
