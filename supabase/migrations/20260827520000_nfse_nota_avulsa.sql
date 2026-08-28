/* ============================================================================
 * NOTA AVULSA — a emissão que uma pessoa manda, e que vai até a CONFIRMADA.
 *
 * O QUE MUDA. A régua do dinheiro deixa de ser uma só e passa a ser duas, com
 * nomes diferentes e alcances diferentes:
 *
 *   • A RODADA (o cron das 13h) continua exatamente como estava: só emite
 *     RECEIVED/RECEIVED_IN_CASH. Nada aqui a afrouxa, e essa é a metade que
 *     precisa ser dita em voz alta — a decisão de 20/08/26 (a diretoria) foi
 *     sobre o processo que roda SOZINHO, e ela continua de pé.
 *
 *   • A AVULSA é um ato: alguém abre o painel, acha a cobrança, liga a chave e
 *     manda. Essa vai até `CONFIRMED`.
 *
 * POR QUE A CONFIRMADA PODE SAIR NUM ATO E NÃO NUMA RODADA. As duas exigem nota
 * — o fato gerador do ISS é a prestação do serviço, não a liquidação. O que
 * separa as duas não é o direito de emitir, é QUEM RESPONDE se a liquidação não
 * vier: numa rodada automática, ninguém; num ato, quem clicou, e o nome dele
 * fica no diário. Cartão autorizado que não liquida (chargeback, cancelamento,
 * falha na captura) vira nota sobre receita que nunca existiu, e nota não se
 * apaga: cancela-se, com prazo e justificativa. Esperar é barato quando dá para
 * esperar; a avulsa existe para quando não dá — o cliente pediu a nota, o mês
 * está fechando, a competência é esta.
 *
 * O QUE A AVULSA **NÃO** AFROUXA, e não há chave que ligue:
 *   • ESTORNO. As três caras (status, `refunds[]` do parcial, `CHARGEBACK_*`)
 *     barram na avulsa igual barram na rodada. Emitir sobre receita devolvida é
 *     o erro que este módulo inteiro existe para não cometer.
 *   • PENDENTE / VENCIDA / CANCELADA. A avulsa vai até a confirmada e não além:
 *     serviço não cobrado não vira nota por atalho de tela.
 *   • A GUARDA CONTRA DUPLICATA (a sombra, o carimbo `cCodIntOS`, a nota do
 *     Asaas ao vivo). Nenhuma delas é sobre o dinheiro, e nenhuma cede aqui.
 *
 * A DATA. Continua sendo a de vencimento — `montarOS` já usa
 * `data_vencimento ?? data_pagamento`, e a confirmada não TEM data de pagamento
 * (o dinheiro não entrou). Não foi preciso mudar nada para isso: a competência
 * da avulsa é o vencimento porque é a única data que existe.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) A regra do dinheiro, agora com alcance
 * ------------------------------------------------------------------
 * `p_avulsa` entra com DEFAULT FALSE, e o default é a decisão de projeto: quem
 * não pediu a avulsa continua sob a régua estreita. As três chamadas que já
 * existem (a fila da rodada, em duas migrations, e as candidatas) passam três
 * argumentos e caem no default sem serem reescritas.
 *
 * DROP antes do CREATE, e não `create or replace`: acrescentar um parâmetro com
 * default a uma função que já existe com 3 cria um OVERLOAD, e aí a chamada de
 * 3 argumentos da fila vira "function is not unique" — a rodada diária morreria
 * em silêncio no dia seguinte. Uma assinatura só, sempre.
 */
drop function if exists public.nfse_bloqueio_emissao(text, jsonb, boolean);

create function public.nfse_bloqueio_emissao(
  p_status              text,
  p_dados               jsonb   default null,
  p_estorno_registrado  boolean default false,
  p_avulsa              boolean default false
) returns text
language sql immutable
set search_path = public
as $$
select case
  -- O estorno vem primeiro porque é o mais grave, e é o único que a avulsa não
  -- alcança. Emitir aqui é imposto sobre receita que não existe.
  when coalesce(p_estorno_registrado, false)
    or upper(coalesce(p_status, '')) in (
         'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS',
         'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
    or (jsonb_typeof(p_dados->'refunds') = 'array' and jsonb_array_length(p_dados->'refunds') > 0)
    then 'Cobrança estornada — emitir criaria imposto sobre receita devolvida.'

  -- A porta que a avulsa abre, e a única. `then null` sai do CASE dizendo
  -- "pode": a confirmada deixa de ter motivo de bloqueio quando alguém assina.
  when coalesce(p_avulsa, false) and upper(coalesce(p_status, '')) = 'CONFIRMED'
    then null

  when upper(coalesce(p_status, '')) = 'CONFIRMED'
    then 'Cobrança confirmada e ainda não liquidada — a nota sai no dia em que o dinheiro entrar, '
         || 'ou agora, como avulsa, se alguém assinar a espera.'

  when upper(coalesce(p_status, '')) not in ('RECEIVED', 'RECEIVED_IN_CASH')
    then 'Cobrança não recebida (' || coalesce(nullif(p_status, ''), 'sem status') || ').'
         || case when coalesce(p_avulsa, false)
                 then ' A avulsa vai até a confirmada e não além.' else '' end

  else null
end;
$$;

comment on function public.nfse_bloqueio_emissao(text, jsonb, boolean, boolean) is
  'Motivo pelo qual a cobranca do Asaas NAO pode virar NFS-e, ou null quando pode. p_avulsa=false (o default, e o que a rodada diaria usa) so libera RECEIVED/RECEIVED_IN_CASH. p_avulsa=true e a emissao avulsa, pedida por uma pessoa: libera tambem CONFIRMED, e nada alem disso. Qualquer sinal de estorno (status, refunds[] ou registro em estornos_asaas) barra nos dois modos.';

revoke all on function public.nfse_bloqueio_emissao(text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.nfse_bloqueio_emissao(text, jsonb, boolean, boolean) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 2) As candidatas do lote manual repassam o alcance
 * ------------------------------------------------------------------
 * Só a última linha do `select` muda — `p_avulsa` viaja até a regra. Todo o
 * resto (o casamento do cliente pelo CNPJ, a OS existente, a sombra com
 * competência e carimbo) é cópia fiel do que está no banco hoje, e é cópia
 * fiel de propósito: esta função é a que decide o que vai ao Omie, e reescrevê-la
 * de memória é como se perde uma guarda sem perceber.
 *
 * A SOMBRA NÃO CEDE. `ja_tem_nota` continua exatamente como está: a avulsa
 * afrouxa a régua do DINHEIRO, não a da DUPLICATA. São perguntas diferentes —
 * "esta receita existe?" e "esta nota já saiu?" — e a segunda não tem urgência
 * que a justifique.
 */
drop function if exists public.notas_fiscais_candidatas(text[]);

create function public.notas_fiscais_candidatas(
  p_ids    text[],
  p_avulsa boolean default false
)
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean,
  status_asaas text, estornado boolean, bloqueio text
)
language sql
stable
set search_path = public
as $$
with cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
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
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
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
       public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado, coalesce(p_avulsa, false))
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
left join lateral (
  select true as existe from public.nf_os_omie o2
  where o2.cancelada = false and o2.nfse_status = '004'
    and o2.cnpj_cpf is not null and o2.cnpj_cpf = cli.doc
    and o2.valor = cob.valor
    -- competência (faltava) + carimbo (faltava)
    and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
    and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  limit 1
) sombra on true;
$$;

revoke all on function public.notas_fiscais_candidatas(text[], boolean) from public, anon;
grant execute on function public.notas_fiscais_candidatas(text[], boolean) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 3) O diário diz que foi avulsa
 * ------------------------------------------------------------------
 * Coluna própria, e não mais um valor em `acao`: a lista de ações é fechada de
 * propósito (`criar_os`, `faturar`, `criar_e_faturar`, `previa`, `email`) e
 * descreve O QUE FOI FEITO no Omie. "Avulsa" não é outro passo — é a mesma
 * criação e o mesmo faturamento, sob outra régua. Misturar as duas coisas numa
 * coluna só perderia a informação de qual passo a avulsa executou.
 *
 * É a coluna que responde, meses depois, a pergunta que um contador faz: esta
 * nota saiu antes de o dinheiro entrar? Quem mandou? O `operador`/`usuario` que
 * já viaja na linha responde o resto.
 */
alter table public.nf_emissoes
  add column if not exists avulsa boolean not null default false;

comment on column public.nf_emissoes.avulsa is
  'A emissao foi pedida como AVULSA: uma pessoa ligou a chave no painel e mandou emitir sob a regua larga, que aceita CONFIRMED (cobranca autorizada e ainda nao liquidada) alem de RECEIVED. false = regua estreita, que e a da rodada diaria e o default de tudo. Estorno barra nos dois modos.';


/* ------------------------------------------------------------------
 * 4) O registro de emissões mostra a marca
 * ------------------------------------------------------------------
 * `drop` e não `create or replace` porque o tipo de retorno ganhou coluna, e o
 * Postgres recusa trocar a assinatura de um `returns table` no replace.
 */
drop function if exists public.notas_fiscais_log(integer, integer);

create function public.notas_fiscais_log(p_dias integer default 14, p_limite integer default 300)
returns table (
  criado_em timestamptz, id_asaas text, cliente text, valor numeric,
  acao text, resultado text, nfse_numero text, nfse_chave text,
  motivo text, operador text, n_cod_os bigint, avulsa boolean
)
language sql stable set search_path to 'public'
as $$
select e.criado_em, e.id_asaas,
       coalesce(c.dados->>'name', c.dados->>'company', '—') as cliente,
       p.valor, e.acao, e.resultado, e.nfse_numero,
       case when e.nfse_numero is not null and o.nfse_numero = e.nfse_numero
            then o.nfse_verificacao end,
       e.erro, e.operador, e.n_cod_os, e.avulsa
from public.nf_emissoes e
left join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = e.id_asaas
left join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
left join public.nf_os_omie o on o.n_cod_os = e.n_cod_os
where e.criado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by e.criado_em desc
limit greatest(p_limite, 1);
$$;

revoke all on function public.notas_fiscais_log(integer, integer) from public, anon;
grant execute on function public.notas_fiscais_log(integer, integer) to authenticated, service_role;
