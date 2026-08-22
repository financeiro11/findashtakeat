/* ============================================================================
 * NFS-e: só se ENTROU, e nunca se VOLTOU.
 *
 * Duas regras que já existiam meia — uma só na fila automática, a outra só no
 * JavaScript da tela — passam a valer no mesmo lugar e para todo mundo.
 *
 * 1) SÓ RECEBIDA VIRA NOTA. `CONFIRMED` é cartão autorizado cuja liquidação
 *    ainda não caiu; `RECEIVED` é dinheiro disponível. A fila automática já
 *    recusava o confirmado desde 20/08/26 (decisão da diretoria); a emissão
 *    MANUAL continuava aceitando, e a assimetria não se sustenta: a nota que
 *    sai pela tela é tão irreversível quanto a que sai pelo cron. No recorte
 *    jul+ago/26 são 1.572 cobranças confirmadas (R$ 620 mil) contra 4.158
 *    recebidas — e nada se perde, porque a confirmada volta à fila sozinha no
 *    dia em que liquidar.
 *
 * 2) ESTORNADA NÃO VIRA NOTA DE JEITO NENHUM. Emitir sobre receita devolvida
 *    cria imposto sobre dinheiro que voltou ao cliente, e a nota não se apaga:
 *    cancela-se, com prazo e justificativa. O estorno tem TRÊS caras e as três
 *    contam:
 *      • total — o status (`REFUNDED` e as fases do pedido);
 *      • parcial — SEM status próprio: a cobrança segue `RECEIVED` e o dinheiro
 *        devolvido só existe dentro de `refunds[]`. Medido em 22/08/26: 53
 *        cobranças RECEIVED e 8 CONFIRMED nessa condição, invisíveis para
 *        qualquer filtro que olhe só o status;
 *      • contestação — os `CHARGEBACK_*`, que são dinheiro em disputa.
 *
 * ONDE A REGRA MORA. Numa função só, `nfse_bloqueio_emissao`, chamada pela fila
 * automática e pelas candidatas do lote manual. A mesma frase que barra é a que
 * aparece no diário e na tela — antes cada camada tinha a sua, e a da tela
 * (TypeScript) não valia para quem chamasse a Edge Function direto.
 *
 * A SEGUNDA TESTEMUNHA DO ESTORNO. `asaas_cache` é espelho do mês; quem caça
 * estorno é a `estornos-sync` (12:40 e 21:40 UTC), que varre `status=REFUNDED`
 * de todos os tempos e a janela de vencimento — é ela que enxerga o parcial de
 * uma cobrança antiga. Hoje as duas concordam (0 divergências em 1.416
 * cobranças), e é exatamente por isso que cruzar sai de graça: quando
 * discordarem, a discordância é o aviso.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) A regra
 * ------------------------------------------------------------------
 * Devolve o MOTIVO de a cobrança não poder virar nota, ou null quando pode. É
 * motivo e não booleano de propósito: o diário guarda a frase, e "bloqueado"
 * sozinho não explica nada a quem for ler depois.
 */
create or replace function public.nfse_bloqueio_emissao(
  p_status              text,
  p_dados               jsonb   default null,
  p_estorno_registrado  boolean default false
) returns text
language sql immutable
set search_path = public
as $$
select case
  -- O estorno vem primeiro porque é o mais grave: emitir aqui é imposto sobre
  -- receita que não existe. As três caras do estorno, na ordem em que aparecem.
  when coalesce(p_estorno_registrado, false)
    or upper(coalesce(p_status, '')) in (
         'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS',
         'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
    or (jsonb_typeof(p_dados->'refunds') = 'array' and jsonb_array_length(p_dados->'refunds') > 0)
    then 'Cobrança estornada — emitir criaria imposto sobre receita devolvida.'

  when upper(coalesce(p_status, '')) = 'CONFIRMED'
    then 'Cobrança confirmada e ainda não liquidada — a nota sai no dia em que o dinheiro entrar.'

  when upper(coalesce(p_status, '')) not in ('RECEIVED', 'RECEIVED_IN_CASH')
    then 'Cobrança não recebida (' || coalesce(nullif(p_status, ''), 'sem status') || ').'

  else null
end;
$$;

comment on function public.nfse_bloqueio_emissao(text, jsonb, boolean) is
  'Motivo pelo qual a cobranca do Asaas NAO pode virar NFS-e, ou null quando pode. Regra unica da fila automatica e do lote manual: so RECEIVED/RECEIVED_IN_CASH emitem, e qualquer sinal de estorno (status, refunds[] ou registro em estornos_asaas) barra.';

revoke all on function public.nfse_bloqueio_emissao(text, jsonb, boolean) from public, anon;
grant execute on function public.nfse_bloqueio_emissao(text, jsonb, boolean) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 2) A fila automática, agora dizendo o que viu
 * ------------------------------------------------------------------
 * O filtro é o mesmo de antes em efeito — só RECEBIDA, sem refunds — mas escrito
 * pela função acima, e com a segunda testemunha (`estornos_asaas`) somada. As
 * duas colunas novas não mudam quem entra: elas viajam até o diário, para que a
 * linha gravada diga em que estado a cobrança estava no instante da emissão.
 */
drop function if exists public.notas_fiscais_fila_emissao(integer);

create function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint,
  status_asaas text, estornado boolean
)
language sql stable security invoker set search_path = public as $$
with cfg as (select data_corte from public.nf_config where id = 1),
cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
omie_cli as (
  -- `min` resolve cadastro duplicado no Omie: dois códigos para o mesmo CNPJ
  -- existem, e sem ele a cobrança viraria duas linhas — duas notas.
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
cob as (
  select c.id_asaas,
         c.dados->>'description' as descricao,
         c.dados->>'customer'    as cus,
         c.valor, c.data_vencimento, c.data_pagamento,
         c.status, c.dados,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
         -- A segunda testemunha do estorno: a varredura da estornos-sync roda às
         -- 12:40, vinte minutos antes da emissão das 13h, e alcança o estorno
         -- parcial de cobrança antiga que o espelho do mês não revisita.
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.valor > 0
    -- Só do corte em diante. Antes disso quem emitiu foi o Asaas.
    and coalesce(c.data_pagamento, c.data_vencimento) >= (select data_corte from cfg)
    and coalesce(c.data_pagamento, c.data_vencimento) <= current_date
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       cob.status,
       cob.estorno_registrado
         or (jsonb_typeof(cob.dados->'refunds') = 'array' and jsonb_array_length(cob.dados->'refunds') > 0)
from cob
join cli on cli.id_asaas = cob.cus
-- `join`, não `left join`: sem documento não há como achar o cadastro no Omie, e
-- sem cadastro no Omie a emissão falharia de todo jeito. Fica de fora da fila em
-- vez de entrar para falhar — e aparece na tela como "sem nota", que é verdade.
join omie_cli oc on oc.doc = cli.doc
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false and o.c_cod_int_os = cob.id_asaas
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  -- A regra do dinheiro, em um lugar só (ver o cabeçalho).
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  -- OS alheia não entra: ou não há OS, ou a que há é nossa e ainda não faturou —
  -- retentativa legítima do que este mesmo processo criou.
  and (os.n_cod_os is null or os.faturada is not true)
  -- A busca-sombra por competência: nota de junho não cobre serviço de setembro.
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
  )
  -- Nota do Asaas autorizada para a mesma cobrança.
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and upper(coalesce(n.status,'')) = 'AUTHORIZED'
  )
-- Mais antiga primeiro: a fila drena em ordem, e o que está esperando há mais
-- tempo é o que mais corre risco de virar competência de outro mês.
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 3) As candidatas do lote manual — com o motivo junto
 * ------------------------------------------------------------------
 * Esta função resolvia cliente e OS e devolvia a cobrança para a Edge Function
 * emitir, SEM UMA PALAVRA sobre o dinheiro: nem status, nem estorno. Quem
 * segurava a cobrança estornada era o `motivoBloqueio` do TypeScript da tela —
 * uma guarda que só existe para quem passa pela tela. Chamar a função
 * `omie-nfse-sync` direto com o id de uma cobrança devolvida emitia a nota.
 *
 * A partir daqui o motivo vem do banco junto com a linha, e é a Edge Function
 * que se recusa. A tela continua bloqueando antes (é ela que explica ao
 * operador por que a caixa não marca), mas deixou de ser a única.
 */
drop function if exists public.notas_fiscais_candidatas(text[]);

create function public.notas_fiscais_candidatas(p_ids text[])
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean,
  status_asaas text, estornado boolean, bloqueio text
)
language sql
stable
security invoker
set search_path = public
as $$
with cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
-- O cache de clientes do Omie é um array jsonb {codigo, nome, cnpj_cpf}. O `min`
-- resolve o cadastro duplicado: dois códigos para o mesmo CNPJ existem, e sem ele
-- a cobrança viraria duas linhas — duas notas.
omie_cli as (
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
cob as (
  select c.id_asaas,
         c.dados->>'description' as descricao,
         c.dados->>'customer'    as cus,
         c.valor, c.data_vencimento, c.data_pagamento,
         c.status, c.dados,
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment' and c.id_asaas = any(p_ids)
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       coalesce(os.nfse_status = '004', false) or coalesce(sombra.existe, false),
       cob.status,
       cob.estorno_registrado
         or (jsonb_typeof(cob.dados->'refunds') = 'array' and jsonb_array_length(cob.dados->'refunds') > 0),
       public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado)
from cob
left join cli on cli.id_asaas = cob.cus
left join omie_cli oc on oc.doc = cli.doc
left join lateral (
  select o.* from public.nf_os_omie o
  where o.cancelada = false
    and ( o.c_cod_int_os = cob.id_asaas
       or ( (o.c_cod_int_os is null or o.c_cod_int_os = '')
            and o.cnpj_cpf is not null and o.cnpj_cpf = cli.doc
            and o.valor = cob.valor
            and date_trunc('month', o.data_previsao)
                = date_trunc('month', coalesce(cob.data_vencimento, cob.data_pagamento)) ) )
  order by (o.c_cod_int_os = cob.id_asaas) desc, o.n_cod_os
  limit 1
) os on true
/* -----------------------------------------------------------------------
 * A GUARDA CONTRA NOTA DUPLICADA — e por que ela ignora a data.
 *
 * As 1.207 OS que o n8n importou trazem em `dDtPrevisao` a DATA DO IMPORT, não
 * a competência da cobrança: 992 delas estão todas em 09/06/2026. O casamento
 * por "mesmo mês" acima, portanto, compara com uma data que não significa nada
 * — só 93 das 1.188 OS de junho ligaram a alguma cobrança.
 *
 * No PAINEL isso é tolerável: a linha aparece como "sem nota", que é uma dúvida
 * honesta. Na EMISSÃO é inaceitável — emitir sobre cobrança que já tem nota
 * cria a segunda nota do mesmo serviço, e nota não se apaga, cancela-se.
 *
 * Por isso esta busca usa só documento + valor, sem data, e é DELIBERADAMENTE
 * mais frouxa que a do painel. A assimetria é intencional: um falso positivo
 * segura uma emissão legítima (chato, reversível, confere-se no Omie); um falso
 * negativo recolhe imposto duas vezes. Medido em jun/26: das 87 cobranças que o
 * painel dava como "sem nota", 2 já tinham nota e foram seguradas aqui.
 * --------------------------------------------------------------------- */
left join lateral (
  select true as existe from public.nf_os_omie o2
  where o2.cancelada = false and o2.nfse_status = '004'
    and o2.cnpj_cpf is not null and o2.cnpj_cpf = cli.doc
    and o2.valor = cob.valor
  limit 1
) sombra on true;
$$;

revoke all on function public.notas_fiscais_candidatas(text[]) from public, anon;
grant execute on function public.notas_fiscais_candidatas(text[]) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 4) O diário aceita o desfecho "não deixei"
 * ------------------------------------------------------------------
 * Recusar emissão é um ato, e ato de processo fiscal que não deixa rastro é
 * indistinguível de esquecimento. `bloqueado` é diferente de `erro` na prática:
 * erro é o Omie recusando (e pede conserto no cadastro), bloqueado é o Hub
 * recusando (e pede que a cobrança mude de estado, ou nunca mais). O motivo vai
 * na coluna `erro`, que é onde a tela já procura a explicação.
 *
 * `notas_fiscais_emitidas_hoje` não precisa mudar: ela conta 'ok' e
 * 'em_processamento', e bloqueada não consome teto — nada foi emitido.
 */
alter table public.nf_emissoes drop constraint if exists nf_emissoes_resultado_check;

alter table public.nf_emissoes
  add constraint nf_emissoes_resultado_check
  check (resultado = any (array['ok'::text, 'erro'::text, 'em_processamento'::text, 'bloqueado'::text]));

/* A rodada também conta quantas barrou. Sem esta coluna, uma rodada que olhou
 * 20 cobranças e recusou as 20 fica igual a uma rodada que não achou nada —
 * `fila: 20, emitidas: 0` sem explicação de para onde foram as 20. */
alter table public.nf_execucoes
  add column if not exists bloqueadas integer not null default 0;

comment on column public.nf_execucoes.bloqueadas is
  'Cobrancas da fila que a conferencia com o Asaas recusou nesta rodada (estornada, nao recebida, ou o Asaas nao respondeu). Nada foi mandado ao Omie por elas.';

comment on column public.nf_emissoes.resultado is
  'ok = o passo deu certo; erro = o Omie recusou; em_processamento = lote disparado e ainda RUNNING (a nota pode nascer depois — nao e para reemitir); bloqueado = o Hub se recusou a emitir (cobranca estornada, nao recebida ou nao confirmada no Asaas) e NADA foi mandado ao Omie.';
