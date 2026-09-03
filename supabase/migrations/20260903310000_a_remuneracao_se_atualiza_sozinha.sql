-- A remuneração passa a se atualizar sozinha, depois da sync do Omie.
--
-- Até aqui `remuneracao_carregar_omie()` só rodava quando alguém chamava à mão,
-- e o vínculo com o espelho do RH tinha sido feito UMA VEZ, no insert de semente
-- da migration que criou as tabelas. As duas coisas juntas davam um buraco que
-- só apareceria daqui a algumas semanas:
--
--   Alguém é contratado. Entra no Portal RH (com `codigo`, cargo, setor, data de
--   início) e, umas semanas depois, recebe o primeiro pagamento no Omie. A carga
--   veria um favorecido novo, criaria a pessoa pela chave do nome — e **sem
--   codigo_rh**. Como a semente não roda mais, o vínculo nunca aconteceria: a
--   pessoa ficaria para sempre sem cargo, sem setor e sem tempo de casa na tela,
--   e ninguém ligaria uma coisa à outra.
--
-- Por isso o passo do RH virou parte da rotina, e não da instalação.

/* ------------------------------------------------------------------ */
/* O espelho do RH entra na rotina                                     */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_sincronizar_rh()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_novas integer := 0;
begin
  -- 1. LIGAR primeiro, inserir depois.
  --
  -- Quem já existe no cadastro por ter aparecido no Omie ganha o `codigo_rh` do
  -- espelho quando o nome normalizado bate. Se esta ordem se invertesse, o
  -- insert bateria no `unique (chave)`, não faria nada, e a pessoa continuaria
  -- sem ficha — que é exatamente o buraco que esta migration fecha.
  --
  -- O `not exists` é obrigatório: `codigo_rh` é UNIQUE, e duas pessoas cujo nome
  -- normaliza igual fariam o update falhar e derrubar a rotina inteira.
  update public.remuneracao_pessoa p
     set codigo_rh = r.codigo
    from (
      select r.codigo, public.contraparte_chave(btrim(r.nome)) as chave
      from public.rh_colaboradores r
      where nullif(btrim(coalesce(r.nome, '')), '') is not null
    ) r
   where p.codigo_rh is null
     and p.chave = r.chave
     and not exists (
       select 1 from public.remuneracao_pessoa q where q.codigo_rh = r.codigo
     );

  -- 2. Quem o espelho conhece e o cadastro ainda não viu — o contratado que
  --    ainda não recebeu o primeiro pagamento. Entra já com cargo e início, e a
  --    tela mostra a pessoa antes do primeiro título.
  with novas as (
    insert into public.remuneracao_pessoa (nome, chave, codigo_rh, doc)
    select distinct on (public.contraparte_chave(btrim(r.nome)))
      btrim(r.nome),
      public.contraparte_chave(btrim(r.nome)),
      r.codigo,
      nullif(regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g'), '')
    from public.rh_colaboradores r
    where nullif(btrim(coalesce(r.nome, '')), '') is not null
      and length(public.contraparte_chave(btrim(r.nome))) >= 4
      and not exists (
        select 1 from public.remuneracao_pessoa q where q.codigo_rh = r.codigo
      )
    order by public.contraparte_chave(btrim(r.nome)), r.codigo
    on conflict (chave) do nothing
    returning 1
  )
  select count(*) into v_novas from novas;

  return v_novas;
end $$;

comment on function public.remuneracao_sincronizar_rh() is
  'Liga o codigo_rh do espelho do RH ao cadastro de remuneração e insere quem ainda não recebeu.';

/* ------------------------------------------------------------------ */
/* A rotina                                                            */
/* ------------------------------------------------------------------ */

-- O que o cron chama. Duas etapas, nesta ordem: o RH primeiro, para que quem
-- chegou pelo Portal já esteja com ficha quando o pagamento aparecer.
create or replace function public.remuneracao_atualizar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rh    integer;
  v_omie  record;
begin
  v_rh := public.remuneracao_sincronizar_rh();
  select * into v_omie from public.remuneracao_carregar_omie();

  return jsonb_build_object(
    'pessoas_do_rh',   v_rh,
    'pessoas_do_omie', v_omie.pessoas_novas,
    'lancamentos',     v_omie.lancamentos_gravados,
    'em',              now()
  );
end $$;

comment on function public.remuneracao_atualizar() is
  'Rotina diária da remuneração: sincroniza o espelho do RH e recarrega o Omie. Idempotente.';

revoke all on function public.remuneracao_sincronizar_rh() from anon, authenticated;
revoke all on function public.remuneracao_atualizar()      from anon, authenticated;

/* ------------------------------------------------------------------ */
/* O agendamento                                                       */
/* ------------------------------------------------------------------ */

-- 12:40 UTC (09:40 em Brasília), DEPOIS de toda a cadeia diária do Omie:
--
--   11:00  omie-orcamento-sync-diario          ─┐ a primeira que roda com o
--   11:20  omie-contas-pagar-sync-diario        │ cache velho é quem regrava
--   12:00  omie-caixa-sync-diario               │ `omie_cache` chave='movimentos'
--   12:20  omie-titulo-texto-varredura-diaria  ─┘ (ver _shared/omie-cache.ts)
--
-- E depois do `sync_rh_colaboradores` das 11:00, para que o espelho do RH já
-- esteja do dia quando a etapa 1 procurar ficha nova.
--
-- Chamada SQL direta, sem `disparar_automacao`: não há Edge Function no meio —
-- é função do banco lendo tabela do banco. Mesmo padrão de `sinais-escalar`,
-- `nota-propagar-varredura` e `ia-orcamento-alerta`. A consequência é que ela
-- não aparece no painel de Automações, que só enxerga o que responde por HTTP;
-- falha fica em `cron.job_run_details`, como nos outros crons de SQL.
select cron.unschedule('remuneracao-atualizar-diaria')
where exists (select 1 from cron.job where jobname = 'remuneracao-atualizar-diaria');

select cron.schedule(
  'remuneracao-atualizar-diaria',
  '40 12 * * *',
  $cron$ select public.remuneracao_atualizar(); $cron$
);
