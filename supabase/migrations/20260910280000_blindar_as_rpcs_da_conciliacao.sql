-- As RPCs param de furar a trava — começando pela conciliação.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA, DE NOVO
--
-- `security definer` roda como `postgres`, que tem `rolbypassrls`. Uma RPC
-- definer sem guarda devolve o dado inteiro a qualquer sessão logada,
-- independentemente de qualquer policy. Trancar tabela não alcança essas.
--
-- Esta migration cuida do grupo `cap_*` / `cartao_*` / `caixa_notas_*`: contas a
-- pagar título a título, com favorecido, CNPJ, valor e observação; a fatura do
-- cartão com o lojista; a caixa de notas. É o grupo que mais expõe nome de
-- pessoa e de fornecedor, e por isso vem primeiro.
--
-- ---------------------------------------------------------------------------
-- `blindar_rpc` — o mesmo trabalho, 21 vezes, sem 21 cópias
--
-- O padrão manual (renomear para `_interno`, revogar, escrever a casca) foi
-- provado em `demonstracoes_lancamentos`. Repetido à mão vinte vezes, cada
-- cópia é uma chance de trocar um tipo de retorno ou esquecer um `revoke` — e o
-- erro só apareceria quando alguém abrisse a tela. Então o padrão virou função:
-- ela LÊ a assinatura real do catálogo (`pg_get_function_arguments`,
-- `pg_get_function_result`, `provolatile`) e gera a casca a partir dela.
--
-- O que ela NÃO faz, de propósito:
--   • não toca em função com OVERLOAD — duas com o mesmo nome exigem escolha, e
--     escolher errado troca o comportamento de quem chama;
--   • não toca em TRIGGER (`cartao_novo_ganha_dono_e_link`), que não é chamada
--     por gente;
--   • não toca em função com parâmetro sem nome, porque a casca chama a interna
--     POR NOME — posicional aqui seria adivinhação;
--   • não repete o trabalho: se `<nome>_interno` já existe, devolve "já
--     blindada" e sai. É o que torna a migration repetível.
--
-- Ela devolve texto em vez de dar `raise`: o resultado do laço é o relatório do
-- que entrou e do que ficou de fora, e ficar de fora não pode abortar o resto.

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
         -- Parâmetro de ENTRADA sem nome torna a chamada por nome impossível.
         -- (proargnames vem NULL quando NENHUM tem nome; string vazia quando um
         -- deles não tem.)
         coalesce(p.proargnames is not null or p.pronargs = 0, false)
    into v_oid, v_args, v_args_id, v_result, v_volat, v_tem_nome
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nome
     and p.prorettype <> 'trigger'::regtype;

  if not v_tem_nome then return p_nome || ' — parâmetro sem nome, deixei quieto'; end if;

  -- Os nomes dos parâmetros de ENTRADA, na ordem. Em função que devolve TABLE,
  -- `proargnames` traz também os nomes das colunas de saída — daí o filtro por
  -- `proargmodes`, que separa entrada (i/b/v) de saída (o/t).
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

  -- A interna sai do alcance de quem chama pela API. Sem isto bastaria pedir
  -- `<nome>_interno` e pular a checagem — o buraco de sempre, com outro nome.
  execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_interno, v_args_id);
  execute format('grant execute on function public.%I(%s) to service_role', v_interno, v_args_id);

  /* A RECUSA E A ENTREGA MUDAM COM A FORMA DO RETORNO, e plpgsql não perdoa
     nenhuma das três — cada uma recusa as sintaxes das outras duas:

       TABLE/SETOF  `return;` encerra com zero linhas; `return null;` não compila.
       void         nem um nem outro aceitam expressão: é `perform` e `return;`.
       escalar      `return <expr>;`, e `return;` sozinho é "missing expression".

     As duas primeiras tentativas desta migration morreram exatamente aqui, uma
     em cada caso. Como a criação da casca é `execute format(...)`, o erro só
     aparece ao RODAR — não há typecheck que pegue antes. */
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
-- A fatia: contas a pagar, cartão e caixa de notas → `conciliacao`
-- ---------------------------------------------------------------------------

-- Todas nascem em modo `aviso` (é o modo da capacidade `conciliacao`), então
-- NADA muda de comportamento hoje: quem não tem a capacidade continua sendo
-- atendido, e passa a aparecer em `acesso_negado_resumo`. Virar para `bloqueio`
-- é um clique na tela de Perfis de acesso, depois de olhar a lista.
create temp table if not exists blindagem(resultado text);

do $$
declare
  v_nome text;
  v_saida text;
begin
  foreach v_nome in array array[
    -- contas a pagar: favorecido, CNPJ, valor, observação, título a título
    'cap_notas_titulos', 'cap_notas_pistas', 'cap_notas_so_comprovante',
    'cap_notas_resumo', 'cap_notas_facetas', 'cap_notas_diagnostico',
    'cap_anexos_fila', 'cap_anexos_fila_total', 'cap_titulo_resumo',
    'cap_anexo_revisar', 'cap_gravidade',
    -- cartão: a fatura com o lojista e o portador
    'cartao_omie_titulos', 'cartao_omie_lojistas', 'cartao_nome_fila',
    'cartao_acesso', 'cartao_marcar', 'cartao_omie_map_gravar',
    'cartao_recomendacao_decidir', 'cartao_recomendacao_tarefa',
    -- caixa de notas
    'caixa_notas_lista'
  ] loop
    v_saida := public.blindar_rpc(v_nome, 'conciliacao');
    insert into blindagem values (v_saida);
  end loop;
end $$;

-- O relatório: o que entrou e o que ficou de fora, com o motivo. Ler isto é
-- parte de aplicar a migration — "não existe" ou "OVERLOAD" numa linha significa
-- que aquela função continua aberta.
select resultado from blindagem order by resultado;
