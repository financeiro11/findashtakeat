/* ============================================================================
 * cartao_importar: parar de responder "ok" quando nada foi importado.
 *
 * O que aconteceu em 04/08/2026: a skill do OFX gravou os 8 cabeçalhos de fatura
 * e nenhum lançamento — são ~2.900 linhas, e o payload não sobreviveu ao caminho
 * até aqui. A função respondeu `{"ok": true, "faturas": 8, "lancamentos": 0}` e
 * a tela de Governança ficou zerada sem ninguém saber por quê: `coalesce(f->'lancamentos','[]')`
 * trata chave ausente como "fatura sem lançamentos", que é indistinguível de sucesso.
 *
 * Fatura de cartão corporativo em uso não tem mês vazio. Então:
 *   • `lancamentos` ausente ou vazio  → erro, e a transação inteira volta atrás;
 *   • linhas enviadas mas descartadas → erro dizendo quantas e por quê.
 *
 * O ganho real é o segundo caso: descarte parcial é o que acontece quando o
 * emissor do payload erra o nome de um campo, e é justamente o que passava
 * despercebido, porque o total continuava subindo.
 * ========================================================================== */

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
  v_enviados int;
  v_rotulo   text;
  v_total    int := 0;
  v_faturas  int := 0;
  v_meses    text[] := '{}';
begin
  for f in select * from jsonb_array_elements(coalesce(p_payload->'faturas', '[]'::jsonb)) loop
    -- Normaliza para o 1º do mês: a skill pode mandar qualquer dia dentro dele.
    v_comp   := date_trunc('month', (f->>'competencia')::date)::date;
    v_rotulo := coalesce(nullif(btrim(f->>'mes_label'), ''), to_char(v_comp, 'MM/YY'));

    if jsonb_typeof(f->'lancamentos') is distinct from 'array' then
      raise exception
        'Fatura % veio sem a lista de lançamentos (chave "lancamentos" ausente ou não é lista). Nada foi importado.',
        v_rotulo;
    end if;

    v_enviados := jsonb_array_length(f->'lancamentos');
    if v_enviados = 0 then
      raise exception
        'Fatura % veio com 0 lançamentos. Fatura de cartão em uso não tem mês vazio — reprocesse o OFX. Nada foi importado.',
        v_rotulo;
    end if;

    insert into public.cartao_faturas (competencia, mes_label, fechamento, arquivo, importado_em, importado_por)
    values (
      v_comp,
      v_rotulo,
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
    from jsonb_array_elements(f->'lancamentos') l
    where nullif(btrim(l->>'estabelecimento'), '') is not null;

    get diagnostics v_n = row_count;

    -- Descarte silencioso é o modo de falha caro: o payload "funciona", o total
    -- sobe e faltam linhas. Se sobrou alguma no caminho, ninguém importa nada.
    if v_n < v_enviados then
      raise exception
        'Fatura %: % de % lançamentos foram descartados por virem sem "estabelecimento". Nada foi importado.',
        v_rotulo, v_enviados - v_n, v_enviados;
    end if;

    v_total   := v_total + v_n;
    v_faturas := v_faturas + 1;
    v_meses   := v_meses || v_rotulo;
  end loop;

  if v_faturas = 0 then
    raise exception 'Payload sem faturas: esperado { "faturas": [ ... ] }.';
  end if;

  return jsonb_build_object(
    'ok', true, 'faturas', v_faturas, 'lancamentos', v_total, 'meses', to_jsonb(v_meses)
  );
end;
$$;

revoke all on function public.cartao_importar(jsonb) from public;
revoke all on function public.cartao_importar(jsonb) from anon;
grant execute on function public.cartao_importar(jsonb) to authenticated;
grant execute on function public.cartao_importar(jsonb) to service_role;
