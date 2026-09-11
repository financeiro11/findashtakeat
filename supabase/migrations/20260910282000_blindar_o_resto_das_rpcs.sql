-- Fatia 3: o resto do que devolve dado do negócio.
--
-- ---------------------------------------------------------------------------
-- O CINTO QUE VEM PRIMEIRO
--
-- Existe uma família de funções que é `anon` DE PROPÓSITO: o link que o
-- fornecedor abre sem ter conta (`*_via_token`, `resolver_nota_publica`,
-- `comentar_nota_publica`, `criar_token_e_registrar`). Já houve um estrago aqui
-- em 25/08/2026 — um laço de `revoke` bem-intencionado quebrou o fluxo público.
--
-- Na prática `exigir()` deixaria essas passar, porque quem chega por token não
-- tem `auth.uid()`. Mas contar com isso é fino demais: basta alguém depois
-- resolver que `auth.uid() is null` deve recusar, e o link público morre sem que
-- ninguém ligue uma coisa à outra. Então `blindar_rpc` passa a se RECUSAR a
-- tocar nelas, por nome, e o relatório diz que recusou.
--
-- ---------------------------------------------------------------------------
-- O QUE FICA DE FORA, E POR QUÊ
--
-- Não é esquecimento — é que blindar estas por capacidade quebraria o Hub para
-- todo mundo no dia em que a capacidade virar `bloqueio`:
--
--   sinais_*, sinal_*, avisos_graves_abertos   o sino e o aviso vermelho são
--                                              montados no LAYOUT, em toda tela
--   hub_automacoes, automacoes_para_*          a faixa da esteira, idem
--   agente_*, ia_*                             telemetria da IA, sem dado do
--                                              negócio
--   contraparte_apelido_de,                    helper de exibição de nome,
--   contrapartes_por_documento                 chamado de praticamente toda tela
--   omie_trava_tomar                           trava de concorrência, infra
--   tarefa_*, tarefas_*, fn_resumo_tarefas_*   o kanban, que já é `time`
--
-- Essas seguem abertas a qualquer sessão logada, e é uma decisão consciente: o
-- que elas devolvem é estrutura do Hub, não número do negócio.

-- O cinto, dentro do blindador.
create or replace function public.blindar_rpc(p_nome text, p_cap text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $blindar$
declare
  v_oid       oid;
  v_args      text;
  v_args_id   text;
  v_result    text;
  v_volat     text;
  v_chamada   text;
  v_interno   text := p_nome || '_interno';
  v_n         int;
  v_tem_nome  boolean;
  v_corpo     text;
begin
  -- O LINK PÚBLICO NÃO SE BLINDA. Ver o cabeçalho desta migration.
  if p_nome ~ '(_via_token$|^resolver_|^comentar_nota_publica$|^criar_token_|^validar_token_)' then
    return p_nome || ' — link público, NÃO se blinda';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nome
     and p.prorettype <> 'trigger'::regtype;

  if v_n = 0 then return p_nome || ' — não existe'; end if;
  if v_n > 1 then return p_nome || ' — OVERLOAD, deixei quieto'; end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = v_interno) then
    return p_nome || ' — já blindada';
  end if;

  select p.oid,
         pg_get_function_arguments(p.oid),
         pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid),
         case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
         coalesce(p.proargnames is not null or p.pronargs = 0, false)
    into v_oid, v_args, v_args_id, v_result, v_volat, v_tem_nome
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nome
     and p.prorettype <> 'trigger'::regtype;

  if not v_tem_nome then return p_nome || ' — parâmetro sem nome, deixei quieto'; end if;

  select coalesce(string_agg(quote_ident(t.nome), ', ' order by t.ord), '')
    into v_chamada
    from pg_proc p,
         lateral unnest(
           p.proargnames,
           coalesce(p.proargmodes,
                    array_fill('i'::"char", array[coalesce(cardinality(p.proargnames), 0)]))
         ) with ordinality as t(nome, modo, ord)
   where p.oid = v_oid and t.modo in ('i', 'b', 'v');

  execute format('alter function public.%I(%s) rename to %I', p_nome, v_args_id, v_interno);
  execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_interno, v_args_id);
  execute format('grant execute on function public.%I(%s) to service_role', v_interno, v_args_id);

  if v_result like 'TABLE%' or v_result like 'SETOF%' then
    v_corpo := format(
      'if not public.exigir(%L, %L) then return; end if; return query select * from public.%I(%s);',
      p_cap, p_nome, v_interno, v_chamada);
  elsif lower(btrim(v_result)) = 'void' then
    v_corpo := format(
      'if not public.exigir(%L, %L) then return; end if; perform public.%I(%s); return;',
      p_cap, p_nome, v_interno, v_chamada);
  else
    v_corpo := format(
      'if not public.exigir(%L, %L) then return null; end if; return public.%I(%s);',
      p_cap, p_nome, v_interno, v_chamada);
  end if;

  execute format($f$
    create function public.%I(%s) returns %s
    language plpgsql %s security definer
    set search_path to 'public', 'pg_temp'
    as $casca$
    begin
      %s
    end;
    $casca$
  $f$, p_nome, v_args, v_result, v_volat, v_corpo);

  execute format('revoke all on function public.%I(%s) from public, anon', p_nome, v_args_id);
  execute format('grant execute on function public.%I(%s) to authenticated, service_role', p_nome, v_args_id);

  return p_nome || ' — blindada (' || p_cap || ')';
end;
$blindar$;

revoke all on function public.blindar_rpc(text, text) from public, anon, authenticated;
grant execute on function public.blindar_rpc(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- A fatia
-- ---------------------------------------------------------------------------

create temp table if not exists blindagem(resultado text);

do $$
declare v_nome text;
begin
  -- Acervo de notas, notas fiscais e conferência: CNPJ, favorecido, valor.
  foreach v_nome in array array[
    'notas_externas_acervo', 'notas_externas_acervo_resumo', 'notas_externas_achados',
    'notas_externas_arquivo_resumo', 'notas_externas_candidatos', 'notas_externas_casar',
    'notas_externas_facetas', 'notas_externas_faxina', 'notas_externas_motivo_por_regra',
    'notas_externas_para_arquivar', 'notas_externas_por_alvo', 'notas_externas_por_que_parou',
    'notas_externas_enfileirar_automatico',
    'notas_fiscais_auditoria', 'nf_os_orfas', 'nota_fonte_do_titulo',
    'nota_propagar', 'nota_propagar_tudo', 'notas_cambio_lote',
    'auditoria_envio_quase_la', 'caixa_nota_apontar', 'titulos_por_memo',
    'omie_categorias_disponiveis', 'omie_clientes_a_criar', 'omie_titulos_sem_texto',
    'encerrar_cartao', 'reativar_cartao'
  ] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'conciliacao'));
  end loop;

  -- Caixa: o que ainda vai sair e o que o Asaas cobrou de taxa.
  foreach v_nome in array array['pagamentos_previstos', 'asaas_taxas_mes'] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'tesouraria'));
  end loop;

  -- Parametrização mora em Configurações, que é `maquinario`.
  foreach v_nome in array array[
    'parametrizacao_contrapartes', 'parametrizacao_lancamentos', 'parametrizacao_evidencias_auditoria'
  ] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'maquinario'));
  end loop;

  foreach v_nome in array array['facilities_casar_titulo', 'facilities_radar_agenda'] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'facilities'));
  end loop;

  -- Prova de que o cinto morde: estas TÊM de sair como "não se blinda".
  foreach v_nome in array array[
    'resolver_token', 'resolver_nota_publica', 'comentar_nota_publica',
    'registrar_comprovante_via_token', 'salvar_justificativa_via_token'
  ] loop
    insert into blindagem values (public.blindar_rpc(v_nome, 'conciliacao'));
  end loop;
end $$;

select resultado from blindagem order by resultado;
