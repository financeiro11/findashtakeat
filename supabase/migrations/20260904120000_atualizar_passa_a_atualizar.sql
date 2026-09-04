-- O botão "Atualizar" passa a atualizar de verdade, e a tela diz de quando é o dado.
--
-- O QUE ACONTECEU EM 04/09/2026: as 57 premiações de agosto (R$ 107.809, vencendo
-- 15/09) foram lançadas no Omie e entraram no `omie_cache` às 00:07. A carga da
-- remuneração roda uma vez por dia, às 12:40 UTC. Entre uma coisa e outra, a
-- tela mostrou agosto com R$ 1.178 de variável — e quem clicou em "Atualizar"
-- viu o mesmo número de novo, porque aquele botão só relia a MESMA tabela.
--
-- Um botão chamado "Atualizar" que não atualiza é pior do que não ter botão:
-- quem clica conclui que o dado está certo.
--
-- Duas correções: o botão passa a disparar a carga, e o painel passa a dizer de
-- quando é o dado — inclusive quando o Omie já tem coisa mais nova.

/* ------------------------------------------------------------------ */
/* Quem pode disparar a carga                                          */
/* ------------------------------------------------------------------ */

-- `remuneracao_atualizar` é SECURITY DEFINER porque precisa ler `omie_cache`,
-- que tem RLS sem policy nenhuma. Abrir o execute para `authenticated` sem mais
-- nada daria a qualquer pessoa logada uma porta para mexer nas tabelas de
-- remuneração — por isso a checagem de cargo vai DENTRO da função, onde não dá
-- para contornar.
create or replace function public.remuneracao_atualizar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rh       integer;
  v_fundidas integer;
  v_omie     record;
begin
  -- `current_user = 'postgres'` deixa o cron e a service role passarem: eles
  -- não têm `auth.uid()` e reprovariam na checagem de cargo.
  if auth.uid() is not null and not public.pode_ver_remuneracao() then
    raise exception 'sem permissão para atualizar a remuneração';
  end if;

  v_rh       := public.remuneracao_sincronizar_rh();
  v_fundidas := public.remuneracao_fundir_por_documento();
  select * into v_omie from public.remuneracao_carregar_omie();

  return jsonb_build_object(
    'pessoas_do_rh',   v_rh,
    'fundidas',        v_fundidas,
    'pessoas_do_omie', v_omie.pessoas_novas,
    'lancamentos',     v_omie.lancamentos_gravados,
    'em',              now()
  );
end $$;

revoke all on function public.remuneracao_atualizar() from anon;
grant execute on function public.remuneracao_atualizar() to authenticated;

/* ------------------------------------------------------------------ */
/* De quando é o dado                                                  */
/* ------------------------------------------------------------------ */

-- SECURITY DEFINER para alcançar `omie_cache`. Devolve duas datas e mais nada —
-- nenhum valor, nenhum nome —, e mesmo assim confere o cargo: saber a que horas
-- a folha foi carregada já é informação sobre a folha.
create or replace function public.remuneracao_frescor()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not public.pode_ver_remuneracao() then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    -- A carga toca TODAS as linhas a cada passada (`on conflict do update`
    -- escreve `atualizado_em`), então o maior deles é a hora da última carga.
    'carga_em', (select max(atualizado_em) from public.remuneracao_lancamento),
    'omie_em',  (select atualizado_em from public.omie_cache where chave = 'movimentos')
  );
end $$;

revoke all on function public.remuneracao_frescor() from anon;
grant execute on function public.remuneracao_frescor() to authenticated;
