/* ============================================================================
 * Notas Fiscais — a cobrança do Asaas e o status de emissão do Omie, lado a lado.
 *
 * O PROBLEMA. A NFS-e da Takeat sai hoje pelo Asaas: 3.017 autorizadas só em
 * jul+ago/26, com município 6203100, item 01.04.01 da LC 116 e ISS de 2%. A
 * emissão vai migrar para o Omie, e a partir daí a pergunta "esta cobrança tem
 * nota?" passa a ter duas respostas possíveis em dois sistemas diferentes —
 * nenhum dos quais sabe da existência do outro. Não existe hoje uma única chave
 * ligando cobrança do Asaas a registro do Omie.
 *
 * ONDE A NOTA MORA NO OMIE. Não em `servicos/nfse` — esse caminho não existe na
 * API (medido: todo método responde "Method not exists"). A NFS-e é um pedaço da
 * ORDEM DE SERVIÇO:
 *
 *     OS na etapa 50  --TrocarEtapaOS(60)-->  OS faturada  ==>  NFS-e emitida
 *
 * e quem conta o que aconteceu é `StatusOS`, que devolve `cFaturada` e a
 * `ListaRpsNfse[]` com número da nota, RPS, status do RPS e o XML. Cuidado com o
 * atalho errado: o `DetalhesNfse` que vem no `ListarOS` está VAZIO em todas as
 * 1.207 OS, faturadas inclusive — ele não é a resposta, e quem parar nele conclui
 * que nenhuma nota foi emitida. Pelo `StatusOS`, 29 de 30 OS faturadas amostradas
 * têm nota autorizada (cStatusRps = '004').
 *
 * O CASAMENTO, em duas camadas e nesta ordem:
 *   1. `c_cod_int_os` = id da cobrança do Asaas. É exato, e é o que o Hub carimba
 *      ao criar a OS. Hoje está vazio nas 1.207 OS existentes — daí a camada 2.
 *   2. CNPJ/CPF do cliente + valor + competência. Aproximado, e serve só para o
 *      histórico que nasceu sem carimbo. Casa por documento e não por nome porque
 *      o Asaas guarda "TAKEAT" onde o Omie guarda a razão social inteira.
 *
 * POR QUE O CORTE. Cobrar nota do Omie para agosto acusaria como "sem nota" três
 * mil cobranças que TÊM nota — só que emitida no Asaas. Antes do corte a nota do
 * Asaas vale; do corte em diante, quem responde é o Omie. A data mora em tabela
 * (não em constante) porque é decisão de negócio e muda sem deploy.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) Espelho das Ordens de Serviço do Omie
 * ------------------------------------------------------------------
 * Uma linha por OS. Os campos de NFS-e são achatados para fora do jsonb porque
 * são exatamente o que a tela filtra e ordena; o resto do registro fica em
 * `dados` para não precisar re-puxar o Omie quando um campo novo virar coluna.
 *
 * `status_lido_em` separa duas coisas que o sync trata de forma diferente: a OS
 * foi LISTADA (barato, 3 páginas para as 1.207) e o status dela foi CONSULTADO
 * (caro, uma chamada por OS). Sem essa marca, todo sync repetiria as 1.207
 * consultas de status — e o Omie recusa chamadas concorrentes do mesmo método.
 */
create table if not exists public.nf_os_omie (
  n_cod_os          bigint primary key,
  c_num_os          text,
  c_cod_int_os      text,          -- carimbo do Hub: id da cobrança do Asaas
  n_cod_cli         bigint,
  cnpj_cpf          text,          -- só dígitos, resolvido do cadastro de clientes
  valor             numeric,
  data_previsao     date,
  etapa             text,          -- '50' = aberta, '60' = faturada
  faturada          boolean not null default false,
  cancelada         boolean not null default false,
  data_faturamento  date,

  -- O que o StatusOS devolve em ListaRpsNfse[0].
  nfse_numero       text,          -- nNfse
  nfse_rps          text,          -- nRps
  nfse_status       text,          -- cStatusRps: '004' = autorizada
  nfse_lote         bigint,
  nfse_xml          text,
  nfse_verificacao  text,          -- cCodVerif
  status_lido_em    timestamptz,

  dados             jsonb,
  atualizado_em     timestamptz not null default now()
);

create index if not exists nf_os_omie_codint_idx   on public.nf_os_omie (c_cod_int_os) where c_cod_int_os is not null and c_cod_int_os <> '';
create index if not exists nf_os_omie_casamento_idx on public.nf_os_omie (cnpj_cpf, valor, data_previsao);
create index if not exists nf_os_omie_etapa_idx    on public.nf_os_omie (etapa, faturada);
create index if not exists nf_os_omie_previsao_idx on public.nf_os_omie (data_previsao);


/* ------------------------------------------------------------------
 * 2) Parâmetros — uma linha só
 * ------------------------------------------------------------------
 * `teto_lote` não é decoração: a emissão em lote é escrita fiscal irreversível,
 * e um erro de configuração com o lote aberto vira dezenas de notas erradas.
 */
create table if not exists public.nf_config (
  id                 smallint primary key default 1 check (id = 1),
  data_corte         date not null default date '2026-09-01',
  etapa_faturamento  text not null default '60',
  teto_lote          integer not null default 50 check (teto_lote between 1 and 200),
  atualizado_em      timestamptz not null default now()
);

insert into public.nf_config (id) values (1) on conflict (id) do nothing;


/* ------------------------------------------------------------------
 * 3) Diário de emissões — append-only
 * ------------------------------------------------------------------
 * Emitir nota é ato fiscal e não se desfaz com um update. Toda tentativa fica
 * registrada, inclusive a que falhou: quando a Receita ou o contador perguntarem
 * "quem mandou emitir esta nota e quando", a resposta é uma linha daqui, não a
 * memória de quem clicou. Por isso não há UPDATE nem DELETE nas permissões.
 */
create table if not exists public.nf_emissoes (
  id            uuid primary key default gen_random_uuid(),
  id_asaas      text not null,
  n_cod_os      bigint,
  acao          text not null check (acao in ('criar_os','faturar','criar_e_faturar')),
  resultado     text not null check (resultado in ('ok','erro')),
  nfse_numero   text,
  erro          text,
  payload       jsonb,             -- o que foi mandado ao Omie, na íntegra
  usuario       uuid,
  criado_em     timestamptz not null default now()
);

create index if not exists nf_emissoes_asaas_idx on public.nf_emissoes (id_asaas, criado_em desc);
create index if not exists nf_emissoes_data_idx  on public.nf_emissoes (criado_em desc);


/* ------------------------------------------------------------------
 * 4) O painel — uma linha por cobrança do Asaas, com os dois lados
 * ------------------------------------------------------------------
 * SITUAÇÃO, que é o que a tela pinta:
 *   nao_exige         cobrança não recebida (pendente, vencida, cancelada)
 *   emitida_asaas     nota autorizada no Asaas — vale antes do corte
 *   emitida_omie      OS faturada com RPS autorizado (cStatusRps '004')
 *   em_processamento  OS faturada mas o RPS ainda não voltou autorizado
 *   nota_a_cancelar   foi estornada e a nota continua de pé
 *   falta             recebida, sem nota em lugar nenhum
 *
 * O ESTORNO tem duas caras e as duas contam: o total (status REFUNDED, e aí o
 * Asaas LIMPA o paymentDate) e o parcial, que não tem status próprio e só existe
 * dentro de `refunds[]`. Olhar só o status deixaria o parcial passar batido com
 * a nota inteira de pé — ver `estornos-sync`, onde essa mesma armadilha custou o
 * KPI zerado.
 */
create or replace function public.notas_fiscais_painel(
  p_de   date,
  p_ate  date
)
returns table (
  id_asaas        text,
  descricao       text,
  cliente_asaas   text,
  cnpj_cpf        text,
  valor           numeric,
  data_vencimento date,
  data_pagamento  date,
  status_asaas    text,
  estornado       boolean,
  nf_asaas_status text,
  nf_asaas_numero text,
  n_cod_os        bigint,
  os_etapa        text,
  os_faturada     boolean,
  nfse_numero     text,
  nfse_status     text,
  nfse_xml        text,
  situacao        text
)
language sql
stable
security invoker
set search_path = public
as $$
with cfg as (
  select data_corte from public.nf_config where id = 1
),
-- Cadastro de clientes do Asaas: é ele quem tem o CNPJ; a cobrança traz só
-- `customer: cus_xxx`. Sem esta ponte não há casamento com o Omie.
cli as (
  select id_asaas,
         regexp_replace(coalesce(dados->>'cpfCnpj', ''), '\D', '', 'g') as doc,
         coalesce(dados->>'name', dados->>'company') as nome
  from public.asaas_cache
  where tipo = 'customer'
),
cob as (
  select
    c.id_asaas,
    c.dados->>'description'                       as descricao,
    c.dados->>'customer'                          as cus,
    c.valor,
    c.data_vencimento,
    c.data_pagamento,
    c.status,
    -- Estorno total (o status) OU parcial (só existe dentro de refunds[]).
    (c.status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS')
     or jsonb_typeof(c.dados->'refunds') = 'array'
        and jsonb_array_length(c.dados->'refunds') > 0)   as estornado,
    c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') as recebida
  from public.asaas_cache c
  where c.tipo = 'payment'
    and coalesce(c.data_pagamento, c.data_vencimento) between p_de and p_ate
),
-- Nota do lado do Asaas, ligada à cobrança pelo campo `payment`.
nfa as (
  select distinct on (dados->>'payment')
         dados->>'payment' as pay,
         status,
         dados->>'number'  as numero
  from public.asaas_cache
  where tipo = 'invoice' and dados->>'payment' is not null
  order by dados->>'payment',
           -- Uma cobrança pode ter nota cancelada e nota autorizada; vale a autorizada.
           case upper(status) when 'AUTHORIZED' then 0 when 'ERROR' then 1 else 2 end,
           data_efetiva desc nulls last
)
select
  cob.id_asaas,
  cob.descricao,
  cli.nome,
  cli.doc,
  cob.valor,
  cob.data_vencimento,
  cob.data_pagamento,
  cob.status,
  cob.estornado,
  nfa.status,
  nfa.numero,
  os.n_cod_os,
  os.etapa,
  os.faturada,
  os.nfse_numero,
  os.nfse_status,
  os.nfse_xml,
  case
    when not cob.recebida and not cob.estornado           then 'nao_exige'
    when cob.estornado and (
           os.nfse_status = '004' or upper(coalesce(nfa.status,'')) = 'AUTHORIZED'
         )                                                then 'nota_a_cancelar'
    when not cob.recebida                                 then 'nao_exige'
    when os.nfse_status = '004'                           then 'emitida_omie'
    when os.faturada                                      then 'em_processamento'
    when upper(coalesce(nfa.status,'')) = 'AUTHORIZED'
     and coalesce(cob.data_pagamento, cob.data_vencimento) < (select data_corte from cfg)
                                                          then 'emitida_asaas'
    else 'falta'
  end as situacao
from cob
left join cli on cli.id_asaas = cob.cus
left join nfa on nfa.pay = cob.id_asaas
-- O casamento com o Omie, nas duas camadas: primeiro o carimbo (exato), depois
-- documento + valor + competência (aproximado, para o histórico sem carimbo).
left join lateral (
  select o.*
  from public.nf_os_omie o
  where o.cancelada = false
    and (
      o.c_cod_int_os = cob.id_asaas
      or (
        -- `or` liga mais frouxo que `and`: sem estes parênteses a condição vira
        -- "sem carimbo OU (vazio E documento E valor E mês)" e casa OS de
        -- qualquer cliente que esteja sem carimbo.
        (o.c_cod_int_os is null or o.c_cod_int_os = '')
        and o.cnpj_cpf is not null and o.cnpj_cpf = cli.doc
        and o.valor = cob.valor
        and date_trunc('month', o.data_previsao)
            = date_trunc('month', coalesce(cob.data_vencimento, cob.data_pagamento))
      )
    )
  order by (o.c_cod_int_os = cob.id_asaas) desc, o.n_cod_os
  limit 1
) os on true;
$$;


/* ------------------------------------------------------------------
 * 5) As candidatas de um lote de emissão
 * ------------------------------------------------------------------
 * O que a `omie-nfse-sync` precisa saber de cada cobrança para emitir: o cliente
 * DO OMIE (resolvido por CNPJ/CPF, nunca por nome) e a OS que porventura já
 * exista. Esta segunda parte não é zelo: o fluxo do n8n que criou as 1.207 OS
 * continua rodando, então procurar OS equivalente ANTES de criar é o que separa
 * "faturar o que já está lá" de "emitir a segunda nota da mesma coisa".
 *
 * É função separada do painel porque responde outra pergunta. O painel classifica
 * o mês inteiro para a tela; esta resolve um punhado de ids para a escrita, e
 * carrega o e-mail do cliente e o código do Omie, que a tela não usa.
 */
create or replace function public.notas_fiscais_candidatas(p_ids text[])
returns table (
  id_asaas text, descricao text, valor numeric,
  data_vencimento date, data_pagamento date, email text,
  cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean
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
         c.valor, c.data_vencimento, c.data_pagamento
  from public.asaas_cache c
  where c.tipo = 'payment' and c.id_asaas = any(p_ids)
)
select cob.id_asaas, cob.descricao, cob.valor, cob.data_vencimento, cob.data_pagamento,
       cli.email, cli.doc, oc.codigo, os.n_cod_os,
       coalesce(os.nfse_status = '004', false) or coalesce(sombra.existe, false)
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


/* ------------------------------------------------------------------
 * 6) Resumo do período — os números do cabeçalho, sem trazer as linhas
 * ------------------------------------------------------------------ */
create or replace function public.notas_fiscais_resumo(
  p_de   date,
  p_ate  date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
select jsonb_build_object(
  'cobrancas',       count(*),
  'valor_total',     coalesce(sum(valor), 0),
  'falta',           count(*) filter (where situacao = 'falta'),
  'valor_falta',     coalesce(sum(valor) filter (where situacao = 'falta'), 0),
  'emitida_omie',    count(*) filter (where situacao = 'emitida_omie'),
  'emitida_asaas',   count(*) filter (where situacao = 'emitida_asaas'),
  'em_processamento', count(*) filter (where situacao = 'em_processamento'),
  'nota_a_cancelar', count(*) filter (where situacao = 'nota_a_cancelar'),
  'nao_exige',       count(*) filter (where situacao = 'nao_exige')
)
from public.notas_fiscais_painel(p_de, p_ate);
$$;


/* ------------------------------------------------------------------
 * 7) Permissões
 * ------------------------------------------------------------------
 * `nf_emissoes` é append-only até para a service_role no caminho normal: o
 * INSERT é o registro do ato, e reescrevê-lo apagaria a trilha. A revogação de
 * `anon` é obrigatória — função nova em `public` nasce chamável sem login pelo
 * grant automático do Supabase, e estas leem faturamento.
 */
grant select on public.nf_os_omie  to authenticated;
grant all    on public.nf_os_omie  to service_role;
grant select on public.nf_config   to authenticated;
grant all    on public.nf_config   to service_role;
grant select on public.nf_emissoes to authenticated;
grant insert, select on public.nf_emissoes to service_role;

alter table public.nf_os_omie  enable row level security;
alter table public.nf_config   enable row level security;
alter table public.nf_emissoes enable row level security;

drop policy if exists "auth_read_nf_os_omie" on public.nf_os_omie;
create policy "auth_read_nf_os_omie" on public.nf_os_omie for select to authenticated using (true);

drop policy if exists "auth_read_nf_config" on public.nf_config;
create policy "auth_read_nf_config" on public.nf_config for select to authenticated using (true);

drop policy if exists "auth_read_nf_emissoes" on public.nf_emissoes;
create policy "auth_read_nf_emissoes" on public.nf_emissoes for select to authenticated using (true);

revoke all on function public.notas_fiscais_painel(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_resumo(date, date) from public, anon;
grant execute on function public.notas_fiscais_resumo(date, date) to authenticated, service_role;

revoke all on function public.notas_fiscais_candidatas(text[]) from public, anon;
grant execute on function public.notas_fiscais_candidatas(text[]) to authenticated, service_role;
