DROP FUNCTION IF EXISTS public.preview_msg_ajuste(text);

CREATE OR REPLACE FUNCTION public.preview_msg_ajuste(p_id_unico text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  a public.auditoria%rowtype;
  c public.auditoria_cartao_lancamentos%rowtype;
  d_gestor_id uuid;
  c_nome text;
  c_tel text;
  v_first text;
  v_msg text;
  v_cta text;
  v_exige_nf boolean;
  v_valor_fmt text;
  v_data_fmt text;
  v_comp_fmt text;
  v_dig text;
  v_regra_low text;
  v_estab text;
  v_card text;
  v_categ text;
  v_motivo text;
  v_obs text;
begin
  select * into a from public.auditoria where id_unico = p_id_unico;
  if not found then
    raise exception 'Lançamento % não encontrado', p_id_unico;
  end if;

  if a.id_transacao is not null then
    select * into c
      from public.auditoria_cartao_lancamentos
     where id_unico = a.id_transacao
        or referencia = a.id_transacao
     limit 1;
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
  v_regra_low := lower(coalesce(a.regra,''));
  v_exige_nf := (v_regra_low like '%nota fiscal%'
                 or v_regra_low like '%sem nf%'
                 or v_regra_low like '% nf%'
                 or lower(coalesce(a.categoria,'')) like '%sem nf%');
  v_valor_fmt := 'R$ ' || public.fmt_brl(coalesce(a.valor,0));
  v_data_fmt := to_char(coalesce(a.data_lancamento, a.competencia), 'DD/MM/YYYY');
  v_comp_fmt := to_char(a.competencia, 'MM/YYYY');
  v_dig := regexp_replace(coalesce(c_tel,''), '\D', '', 'g');

  v_estab  := coalesce(nullif(c.estabelecimento,''), a.titulo, '—');
  v_card   := nullif(c.card_final,'');
  v_categ  := coalesce(nullif(c.categoria_auditoria,''), nullif(c.categoria,''), nullif(a.categoria,''), '—');
  v_motivo := coalesce(nullif(a.descricao,''), nullif(c.observacao,''), '—');
  v_obs    := nullif(c.observacao,'');

  if v_regra_low like '%conferir%' then
    v_cta := 'Poderia conferir manualmente este lançamento (passagem/hospedagem) e confirmar se o valor cobrado bate com o comprovante? Se houver divergência, nos envie o detalhamento.';
  elsif v_exige_nf then
    v_cta := 'Este lançamento está *sem nota fiscal*. Poderia nos enviar a NF (PDF) o quanto antes?';
  elsif v_regra_low like '%comprovante%' then
    v_cta := 'Este lançamento está sem comprovante anexado. Poderia nos enviar o comprovante?';
  elsif v_regra_low like '%categoria%' or v_regra_low like '%classific%' then
    v_cta := 'Precisamos revisar a *categoria* deste lançamento. Poderia validar a classificação correta?';
  else
    v_cta := 'Poderia revisar este lançamento e nos retornar com o ajuste necessário?';
  end if;

  v_msg :=
    'Oi, ' || coalesce(v_first, 'tudo bem') || '! 👋' || E'\n\n' ||
    'Identificamos um lançamento na área *' || coalesce(a.area,'—') || '* que precisa de atenção:' || E'\n\n' ||
    '• *Estabelecimento:* ' || v_estab || E'\n' ||
    '• *Valor:* ' || v_valor_fmt || E'\n' ||
    '• *Data:* ' || v_data_fmt || E'\n' ||
    '• *Competência:* ' || coalesce(v_comp_fmt,'—') || E'\n' ||
    case when v_card is not null then '• *Cartão final:* ' || v_card || E'\n' else '' end ||
    '• *Responsável:* ' || coalesce(a.responsavel,'—') || E'\n' ||
    '• *Categoria:* ' || v_categ || E'\n' ||
    '• *Regra:* ' || coalesce(a.regra,'—') || E'\n' ||
    '• *Motivo:* ' || v_motivo || E'\n' ||
    case when v_obs is not null and v_obs <> v_motivo then '• *Observação:* ' || v_obs || E'\n' else '' end ||
    E'\n' || v_cta || E'\n\n' ||
    'Obrigado! 🙌';

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

GRANT EXECUTE ON FUNCTION public.preview_msg_ajuste(text) TO authenticated, service_role;