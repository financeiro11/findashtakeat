-- O CLIENTE QUE PAGA CONTRA NOTA
--
-- Há clientes cujo processo interno é o contrário do nosso: eles precisam da
-- NFS-e para PODER pagar. O Banestes é o caso grande — nota emitida no fim do
-- mês, boleto junto, pagamento no dia 10 do mês seguinte, sem uma exceção desde
-- 2024. Enquanto o Asaas emitia, isso funcionava e ninguém aqui precisou saber:
-- era um campo no `invoiceSettings` da assinatura dele.
--
-- O CORTE DE 01/09/2026 DERRUBOU ISSO EM SILÊNCIO. Das 2.099 assinaturas cujo
-- `invoiceSettings` foi apagado, **2.095 eram `ON_PAYMENT_CONFIRMATION`** — nota
-- depois do pagamento, que é exatamente a régua que o Hub já tinha. Quatro não
-- eram, e essas quatro ficaram órfãs: o Asaas parou de emitir e o Hub nunca
-- emitiria, porque a régua dele começa em "recebida".
--
--   Banestes            sub_xkhoce2tu5h6w8cu  ON_DUE_DATE_MONTH     R$ 52.855,16/mês
--   Gojuice - Taubaté   sub_ly8wlqubuqta73by  ON_PAYMENT_DUE_DATE   R$    300,00/mês
--   New Bowling         sub_ihYJqAuyJ93z      ON_PAYMENT_DUE_DATE   R$    260,00/mês
--   Menu Beach          sub_fZQt27zSAgCi      ON_NEXT_MONTH         R$     50,00/mês
--
-- Não é uma régua afrouxada: é uma régua que já existia e que nós desligamos sem
-- perceber. A foto de cada `invoiceSettings` está em `asaas_nf_desligamento`, e
-- é dela que a lista abaixo nasce — não de digitação.
--
-- QUEM PUXA O GATILHO É UMA PESSOA, e essa é a decisão de desenho (Henrique,
-- 02/09/2026). O Asaas emitia sozinho; aqui não. O motivo é o mesmo que separa a
-- rodada automática da nota avulsa: **numa rodada não há a quem perguntar, num
-- ato há.** E o histórico do próprio Banestes prova que a pergunta é necessária
-- — o valor mudou três vezes em 2026 (R$ 45.285 → 50.800 → 52.588,16 →
-- 52.855,16) e três notas precisaram ser canceladas e refeitas. Emitir sozinho
-- sobre cobrança ainda não paga de R$ 52 mil é escrita fiscal irreversível
-- decidida por um `cron`.
--
-- Então a lista NÃO entra na fila automática. Ela só destrava a LINHA no painel,
-- com selo próprio, para alguém marcar e mandar.

create table if not exists public.nf_nota_antes_do_pagamento (
  doc               text primary key,
  nome              text,
  /* Por que este cliente está aqui. É o campo que impede a lista de virar
     folclore: daqui a um ano ninguém lembra por que o Banestes é exceção. */
  motivo            text not null,
  /* De onde veio a informação, quando veio do Asaas. Vale como prova: não foi
     alguém achando que o cliente paga contra nota, foi a configuração que
     estava em produção até 01/09/2026. */
  assinatura_origem text,
  regra_asaas       text,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  criado_por        text
);

comment on table public.nf_nota_antes_do_pagamento is
  'Clientes cuja NFS-e sai ANTES do pagamento, por exigência do processo deles. '
  'Destrava a linha no painel para emissão manual; NÃO entra na fila automática.';

alter table public.nf_nota_antes_do_pagamento enable row level security;

drop policy if exists nf_nota_antes_leitura on public.nf_nota_antes_do_pagamento;
create policy nf_nota_antes_leitura on public.nf_nota_antes_do_pagamento
  for select to authenticated using (true);

drop policy if exists nf_nota_antes_escrita on public.nf_nota_antes_do_pagamento;
create policy nf_nota_antes_escrita on public.nf_nota_antes_do_pagamento
  for all to authenticated using (true) with check (true);

revoke all on public.nf_nota_antes_do_pagamento from anon;

/* A CARGA VEM DA FOTO, NÃO DA MEMÓRIA DE NINGUÉM.
   `asaas_nf_desligamento` guardou o `invoiceSettings` de cada assinatura antes
   de apagá-lo. Quem não é `ON_PAYMENT_CONFIRMATION` é, por definição, quem
   recebia nota sem depender do pagamento. O documento vem do cliente da
   assinatura — por CNPJ e nunca por nome, que é a regra do módulo inteiro. */
insert into public.nf_nota_antes_do_pagamento (doc, nome, motivo, assinatura_origem, regra_asaas, criado_por)
select cli.documento,
       cli.nome,
       -- Os parênteses em volta do `->>` não são estilo: `||` e `->>` têm a
       -- MESMA precedência e associam à esquerda, então sem eles o Postgres lê
       -- `('texto' || d.config) ->> 'chave'` e morre tentando ler o texto como
       -- json ("Token \"O\" is invalid").
       'O Asaas emitia a nota sem esperar o pagamento (' || (d.config->>'invoiceCreationPeriod') ||
         '). O cliente precisa da NFS-e para pagar. Restaurado no Hub em 02/09/2026, '
         'depois que o desligamento do Asaas em 01/09 deixou esta assinatura sem emissor.',
       d.referencia,
       d.config->>'invoiceCreationPeriod',
       'migration 20260902150000'
from public.asaas_nf_desligamento d
join public.asaas_cache s on s.tipo = 'subscription' and s.id_asaas = d.referencia
join public.asaas_cache cli on cli.tipo = 'customer' and cli.id_asaas = s.dados->>'customer'
where d.alvo = 'assinatura' and d.ok = true
  and d.config->>'invoiceCreationPeriod' is not null
  and d.config->>'invoiceCreationPeriod' <> 'ON_PAYMENT_CONFIRMATION'
  and length(coalesce(cli.documento, '')) in (11, 14)
on conflict (doc) do nothing;

-- ---------------------------------------------------------------------------
-- A RÉGUA GANHA UM TERCEIRO ALCANCE.
--
-- São três agora, e a diferença entre elas nunca foi o DIREITO de emitir — o
-- fato gerador do ISS é a prestação do serviço, não a liquidação. O que muda é
-- quem responde se o dinheiro não vier:
--
--   estreita (rodada)          RECEIVED, RECEIVED_IN_CASH
--   avulsa   (ato)             + CONFIRMED — alguém assinou a espera
--   antes do pagamento (ato)   + PENDING, OVERDUE — o cliente exige a nota
--                                para pagar, e isso está na lista, com motivo
--
-- `OVERDUE` entra junto com `PENDING` de propósito: nesse fluxo a nota nasce
-- ANTES do vencimento, então cobrança vencida sem nota é cobrança que ficou sem
-- o documento que a destrava — recusar aqui seria manter o cliente impedido de
-- pagar. O que NENHUM dos três alcança continua igual: estorno nas três caras
-- (status, `refunds[]` e o registro da estornos-sync) e as guardas de
-- duplicata, que respondem "esta nota já saiu?" — outra pergunta.
--
-- O `drop` antes do `create` não é zelo: `create or replace` com uma assinatura
-- NOVA deixaria a antiga de quatro argumentos viva ao lado, e toda chamada com
-- quatro passaria a ser ambígua. É a armadilha de [[migrations-nao-batem-com-o-banco]].
-- ---------------------------------------------------------------------------
drop function if exists public.nfse_bloqueio_emissao(text, jsonb, boolean, boolean);

create function public.nfse_bloqueio_emissao(
  p_status text,
  p_dados jsonb default null,
  p_estorno_registrado boolean default false,
  p_avulsa boolean default false,
  p_antes_pagamento boolean default false
) returns text
language sql
immutable
set search_path to 'public'
as $function$
select case
  -- O estorno vem primeiro porque é o mais grave, e é o único que nenhuma das
  -- três réguas alcança. Emitir aqui é imposto sobre receita que não existe.
  when coalesce(p_estorno_registrado, false)
    or upper(coalesce(p_status, '')) in (
         'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS',
         'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL')
    or (jsonb_typeof(p_dados->'refunds') = 'array' and jsonb_array_length(p_dados->'refunds') > 0)
    then 'Cobrança estornada — emitir criaria imposto sobre receita devolvida.'

  -- A régua do cliente que paga contra nota. Vem antes das outras duas porque é
  -- a mais larga das três, e porque quem está nela está por decisão registrada.
  when coalesce(p_antes_pagamento, false)
   and upper(coalesce(p_status, '')) in (
         'RECEIVED', 'RECEIVED_IN_CASH', 'CONFIRMED', 'PENDING', 'OVERDUE')
    then null

  -- A porta que a avulsa abre, e a única.
  when coalesce(p_avulsa, false) and upper(coalesce(p_status, '')) = 'CONFIRMED'
    then null

  when upper(coalesce(p_status, '')) = 'CONFIRMED'
    then 'Cobrança confirmada e ainda não liquidada — a nota sai no dia em que o dinheiro entrar, '
         || 'ou agora, como avulsa, se alguém assinar a espera.'

  when upper(coalesce(p_status, '')) not in ('RECEIVED', 'RECEIVED_IN_CASH')
    then 'Cobrança não recebida (' || coalesce(nullif(p_status, ''), 'sem status') || ').'
         || case when coalesce(p_antes_pagamento, false)
                 then ' Nem a régua de "nota antes do pagamento" alcança este status.'
            when coalesce(p_avulsa, false)
                 then ' A avulsa vai até a confirmada e não além.' else '' end

  else null
end;
$function$;

revoke all on function public.nfse_bloqueio_emissao(text, jsonb, boolean, boolean, boolean) from anon;

-- ---------------------------------------------------------------------------
-- AS CANDIDATAS PASSAM A DIZER QUEM ESTÁ NA LISTA.
--
-- A rota manual resolve o `antes_pagamento` SOZINHA, a partir da tabela — não é
-- parâmetro da chamada como o `avulsa`. A diferença é o que cada um significa: o
-- `avulsa` é uma decisão tomada NAQUELE clique, e por isso precisa viajar no
-- corpo; a lista é uma decisão tomada uma vez, sobre o cliente, com motivo
-- escrito. Fazer dela um parâmetro permitiria ligá-la para quem não está na
-- lista, que é exatamente o que ela existe para impedir.
--
-- A coluna sai também no retorno porque a porta ao vivo (`conferirNoAsaas`, na
-- Edge) precisa da mesma resposta e não deve descobri-la por conta própria: duas
-- consultas separadas são duas chances de discordar.
--
-- A FILA AUTOMÁTICA NÃO GANHA NADA DISSO, e é o ponto inteiro do desenho: ela
-- chama a régua com três argumentos, o `p_antes_pagamento` fica no `false` do
-- default, e nenhuma cobrança pendente entra numa rodada de cron.
-- ---------------------------------------------------------------------------
drop function if exists public.notas_fiscais_candidatas(text[], boolean);

create function public.notas_fiscais_candidatas(p_ids text[], p_avulsa boolean default false)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
  email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean,
  status_asaas text, estornado boolean, bloqueio text, antes_pagamento boolean
)
language sql
stable
set search_path to 'public'
as $function$
with cli as (
  select id_asaas, documento as doc, dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
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
       public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado,
                                    coalesce(p_avulsa, false), coalesce(antes.na_lista, false)),
       coalesce(antes.na_lista, false)
from cob
left join cli on cli.id_asaas = cob.cus
left join public.omie_clientes_doc oc on oc.doc = cli.doc
left join lateral (
  select true as na_lista from public.nf_nota_antes_do_pagamento a
  where a.doc = cli.doc and a.ativo
) antes on true
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
    and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
    and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  limit 1
) sombra on true;
$function$;

alter function public.notas_fiscais_candidatas(text[], boolean) set statement_timeout = '30s';
revoke all on function public.notas_fiscais_candidatas(text[], boolean) from anon;
