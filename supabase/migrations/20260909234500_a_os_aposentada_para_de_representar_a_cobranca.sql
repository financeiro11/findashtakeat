/* ============================================================================
 * A OS APOSENTADA PARA DE REPRESENTAR A COBRANÇA
 *
 * A migration anterior (`a_recusada_volta_para_a_esteira`) resolveu METADE do
 * problema — e a medição mostrou qual metade. Das 289 recusadas drenáveis:
 *
 *   • 33 têm carimbo `pay_…` (nasceram aqui). Nessas, renomear o `cCodIntOS` no
 *     Omie já basta: a cobrança volta a não ter OS aos olhos de todo o módulo.
 *   • 256 têm carimbo VAZIO — são as OS que o fluxo do n8n criou. Nelas não há
 *     carimbo a ceder, e o que prende a cobrança não está no Omie: está AQUI,
 *     no casamento HEURÍSTICO por CNPJ + valor + mês.
 *
 * QUEM PRENDE AS 256, nome por nome, é a SOMBRA 3 da `notas_fiscais_fila_emissao`:
 *
 *     não existe OS sem carimbo, do mesmo CNPJ e valor, no mesmo mês, JÁ FATURADA
 *
 * E ela está certa. Foi ela que parou o laço de 323 tentativas em 19 cobranças,
 * justamente porque a pergunta certa é "esta OS ainda pode ser faturada?" e não
 * "já existe nota?" — faturada COM RECUSA era o caso que escapava e reemitia
 * para sempre. Remover a guarda recriaria o laço.
 *
 * O QUE MUDA, então, é uma coisa só: a guarda passa a respeitar uma
 * APOSENTADORIA EXPLÍCITA. `carimbo_liberado_em is not null` quer dizer "uma
 * pessoa olhou esta OS recusada e decidiu que ela não representa mais esta
 * cobrança". Sem a marca, tudo segue exatamente como está — o laço continua
 * impossível para as milhares de OS que ninguém aposentou.
 *
 * É por isso que a marca é a mesma coluna nos dois casos, com e sem carimbo. O
 * ato é o mesmo ("esta OS morreu"); o que muda é se sobra algo a renomear no
 * Omie. Duas colunas para o mesmo fato virariam duas regras, e a que ninguém
 * revisa é sempre a automática.
 *
 * ONDE A MARCA PRECISA SER LIDA — as três leituras que decidem se a cobrança tem
 * OS. Menos do que isto deixa a cobrança presa; mais do que isto não existe:
 *   1. `notas_fiscais_fila_emissao`  → a fila do cron (o `os` lateral e a SOMBRA 3)
 *   2. `notas_fiscais_candidatas`    → o lote manual e o botão de massa
 *   3. `notas_fiscais_painel`        → o que a tela chama de "tem nota?"
 * ========================================================================== */


/* ---------------------------------------------------------------------------
 * 1) A lista drenável, com a cobrança já resolvida
 * ---------------------------------------------------------------------------
 * A edge function precisa saber DE QUAL COBRANÇA é cada OS recusada — para
 * assinar o diário e para a auditoria depois. Com carimbo isso é trivial; sem
 * carimbo é o mesmo casamento heurístico que a `notas_fiscais_candidatas` faz, e
 * ele fica aqui para não ser reescrito em TypeScript. Duas versões da mesma
 * regra de casamento é como se emite nota para o cliente errado.
 *
 * Não é uma segunda definição de "drenável": a situação continua vindo inteira
 * da `nfse_recusas_a_tratar`, a MESMA que a tela mostra. Aqui só se acrescenta a
 * cobrança e se filtra pelas duas situações que a máquina sabe resolver.
 * ------------------------------------------------------------------------- */
create or replace function public.nfse_recusas_reemitiveis(p_dias integer default 120)
returns table(
  n_cod_os bigint, id_cobranca text, tem_carimbo boolean,
  nome text, valor numeric, situacao text, motivo_curto text
)
language sql
stable
set search_path to 'public'
set statement_timeout to '30s'
as $function$
with r as (
  select * from public.nfse_recusas_a_tratar(p_dias)
  where situacao in ('consertado', 'so_reenviar')
),
os as (
  select o.n_cod_os, o.cnpj_cpf, o.valor, o.data_previsao
  from public.nf_os_omie o
  where o.n_cod_os in (select n_cod_os from r)
),
cli as (
  select c.id_asaas, c.documento as doc
  from public.asaas_cache c where c.tipo = 'customer'
)
select r.n_cod_os,
       -- Com carimbo, ele É a cobrança. Sem carimbo, o que o heurístico achar.
       coalesce(nullif(r.id_cobranca, ''), heur.id_asaas),
       coalesce(nullif(r.id_cobranca, ''), '') <> '',
       r.nome, r.valor, r.situacao, r.motivo_curto
from r
join os on os.n_cod_os = r.n_cod_os
left join lateral (
  select p.id_asaas
  from public.asaas_cache p
  join cli on cli.id_asaas = p.cliente_ref
  where coalesce(nullif(r.id_cobranca, ''), '') = ''
    and p.tipo = 'payment'
    and cli.doc = os.cnpj_cpf
    and p.valor = os.valor
    and date_trunc('month', coalesce(p.data_vencimento, p.data_pagamento))
        = date_trunc('month', os.data_previsao)
  /* Mais de uma cobrança do mesmo cliente, valor e mês é comum (assinatura
     mensal parcelada). Fica a mais antiga, que é a que a esteira serviria
     primeiro de qualquer forma — e a segunda volta pelo próprio heurístico
     quando esta virar nota. */
  order by coalesce(p.data_vencimento, p.data_pagamento), p.id_asaas
  limit 1
) heur on true
order by r.valor desc;
$function$;

comment on function public.nfse_recusas_reemitiveis(integer) is
  'As recusas que a maquina sabe resolver sozinha (consertado + so_reenviar), com a cobranca do Asaas ja resolvida — pelo carimbo quando ele existe, pelo casamento CNPJ+valor+mes quando a OS veio do n8n sem carimbo. Alimenta a acao devolver_a_esteira da omie-nfse-sync.';

revoke all on function public.nfse_recusas_reemitiveis(integer) from public, anon;
grant execute on function public.nfse_recusas_reemitiveis(integer) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * 2) A fila do cron para de ver a OS aposentada
 * ---------------------------------------------------------------------------
 * Duas linhas novas, marcadas com "APOSENTADA" abaixo. Todo o resto é cópia
 * fiel do que está no banco — cópia fiel de propósito: é esta função que decide
 * o que vai virar nota fiscal sozinho, e reescrevê-la de memória é como se perde
 * uma guarda sem ninguém perceber.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date,
  data_pagamento date, email text, cnpj_cpf text, n_cod_cli bigint,
  n_cod_os bigint, status_asaas text, estornado boolean
)
language sql
stable
set search_path to 'public'
set statement_timeout to '30s'
as $function$
with cfg as (
  select data_corte, paralelo_asaas, avulsa_sem_asaas_desde
  from public.nf_config where id = 1
),
cli as (
  select id_asaas, documento as doc, dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
passo as materialized (
  select distinct on (id_asaas)
         id_asaas, resultado, criado_em, coalesce(erro, '') as erro
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and criado_em > now() - interval '30 days'
  order by id_asaas, criado_em desc
),
tentativas as materialized (
  select id_asaas, count(*)::int as n
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and resultado = 'erro'
    and criado_em > now() - interval '7 days'
  group by 1
),
cob as (
  select c.id_asaas,
         c.dados->>'description'  as descricao,
         c.dados->>'customer'     as cus,
         c.dados->>'subscription' as assinatura,
         c.valor, c.data_vencimento, c.data_pagamento,
         c.status, c.dados,
         coalesce(c.data_pagamento, c.data_vencimento) as competencia,
         coalesce(c.data_vencimento, c.data_pagamento) as previsao,
         exists (select 1 from public.estornos_asaas e where e.id_pagamento = c.id_asaas) as estorno_registrado
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.valor > 0
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
join public.omie_clientes_doc oc on oc.doc = cli.doc
left join public.asaas_nf_config nfc on nfc.assinatura = cob.assinatura
left join passo p on p.id_asaas = cob.id_asaas
left join tentativas t on t.id_asaas = cob.id_asaas
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  where o.cancelada = false
    and o.c_cod_int_os = cob.id_asaas
    and o.c_cod_int_os <> ''
    -- APOSENTADA: cedeu o carimbo e não representa mais esta cobrança.
    and o.carimbo_liberado_em is null
  order by o.n_cod_os limit 1
) os on true
where length(cli.doc) in (11, 14)
  and public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado) is null
  and (os.n_cod_os is null or os.faturada is not true)
  /* NO FORNO NÃO VOLTA. */
  and not coalesce(p.resultado = 'em_processamento'
                   and p.criado_em > now() - interval '12 hours', false)
  /* CARÊNCIA DEPOIS DO ERRO. */
  and not coalesce(p.resultado = 'erro'
                   and p.criado_em > now() - public.nfse_carencia(p.erro, coalesce(t.n, 0)), false)
  /* O PARALELO. */
  and (
    not (select paralelo_asaas from cfg)
    or (cob.assinatura is not null and nfc.tem_config is false)
    or (cob.assinatura is null
        and (select avulsa_sem_asaas_desde from cfg) is not null
        and cob.competencia >= (select avulsa_sem_asaas_desde from cfg))
  )
  /* SOMBRA 1 — pela COMPETÊNCIA. Nota AUTORIZADA não se aposenta: esta guarda
     não ganha exceção nenhuma, porque a pergunta dela é "já existe nota?" e a
     resposta não muda por decisão de ninguém. */
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* SOMBRA 2 — pela PREVISÃO (a parcelada de cartão). Idem: nota é nota. */
  and not exists (
    select 1 from public.nf_os_omie o3
    where o3.cancelada = false and o3.nfse_status = '004'
      and coalesce(o3.c_cod_int_os, '') = ''
      and o3.cnpj_cpf = cli.doc and o3.valor = cob.valor
      and date_trunc('month', o3.data_previsao) = date_trunc('month', cob.previsao)
  )
  /* SOMBRA 3 — a OS SEM CARIMBO JÁ FATURADA, com qualquer desfecho.
     A pergunta é "esta OS ainda pode ser faturada?" (`faturada`), não "já existe
     nota?" (`nfse_status`) — faturada com RECUSA era o caso que escapava e
     produzia o laço de 323 tentativas em 19 cobranças.

     E é a ÚNICA das três sombras que aceita a aposentadoria, porque é a única
     que fala de uma OS SEM NOTA. Aposentar aqui não libera segunda nota: libera
     a primeira, que a prefeitura recusou. As sombras 1 e 2 olham `nfse_status =
     '004'` — nota que existe —, e essas não cedem a decisão de ninguém. */
  and not exists (
    select 1 from public.nf_os_omie o4
    where o4.cancelada = false and o4.faturada = true
      and coalesce(o4.c_cod_int_os, '') = ''
      and o4.cnpj_cpf = cli.doc and o4.valor = cob.valor
      and date_trunc('month', o4.data_previsao) = date_trunc('month', cob.previsao)
      -- APOSENTADA: recusada, e alguém decidiu que a nota sai por uma OS nova.
      and o4.carimbo_liberado_em is null
  )
  /* A NOTA DO ASAAS — a MESMA régua da porta ao vivo. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and n.status not in ('ERROR', 'CANCELED', 'CANCELLED')
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

revoke all on function public.notas_fiscais_fila_emissao(integer) from public, anon;
grant execute on function public.notas_fiscais_fila_emissao(integer) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * 3) O lote manual também
 * ------------------------------------------------------------------------- */
create or replace function public.notas_fiscais_candidatas(p_ids text[], p_avulsa boolean default false)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date,
  data_pagamento date, email text, cnpj_cpf text, n_cod_cli bigint,
  n_cod_os bigint, ja_tem_nota boolean, status_asaas text, estornado boolean,
  bloqueio text, antes_pagamento boolean
)
language sql
stable
set search_path to 'public'
set statement_timeout to '30s'
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
    -- APOSENTADA: vale para as duas pontas do OR, o carimbo e o heurístico.
    and o.carimbo_liberado_em is null
    and ( o.c_cod_int_os = cob.id_asaas
       or ( (o.c_cod_int_os is null or o.c_cod_int_os = '')
            and o.cnpj_cpf is not null and o.cnpj_cpf = cli.doc
            and o.valor = cob.valor
            and date_trunc('month', o.data_previsao)
                = date_trunc('month', coalesce(cob.data_vencimento, cob.data_pagamento)) ) )
  order by (o.c_cod_int_os = cob.id_asaas) desc, o.n_cod_os
  limit 1
) os on true
/* A SOMBRA NÃO CEDE, aqui como na fila: ela olha `nfse_status = '004'`, que é
   nota que existe no portal nacional. Aposentadoria é sobre OS recusada. */
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

revoke all on function public.notas_fiscais_candidatas(text[], boolean) from public, anon;
grant execute on function public.notas_fiscais_candidatas(text[], boolean) to authenticated, service_role;


/* ---------------------------------------------------------------------------
 * 4) E o painel do mês, para a linha não mostrar a OS morta
 * ---------------------------------------------------------------------------
 * Sem isto a cobrança aposentada continuaria lendo "NFS-e rejeitada" na tela até
 * a nota nova nascer — e "rejeitada" é justamente o rótulo que manda a pessoa
 * ir tratar à mão o que a esteira já pegou de volta. Escondida a OS morta, a
 * linha volta a "Sem nota", que é a verdade enquanto a nova não sai, e vira
 * "No forno" no minuto em que o lote é despachado.
 *
 * Mantém o CTE `forno` da migration das 21h — este arquivo é o estado completo.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_fiscais_painel(p_de date, p_ate date)
returns table(
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text, valor numeric,
  data_vencimento date, data_pagamento date, status_asaas text, estornado boolean,
  nf_asaas_status text, nf_asaas_numero text, n_cod_os bigint, os_etapa text,
  os_faturada boolean, nfse_numero text, nfse_status text, nfse_xml text,
  nfse_chave text, nfse_mensagem text, situacao text
)
language sql
stable
set search_path to 'public'
as $function$
with cob as (
  select c.id_asaas,
         c.descricao,
         c.cliente_ref as cus,
         c.valor, c.data_vencimento, c.data_pagamento, c.status,
         (c.status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS')
          or c.estornos > 0) as estornado,
         (c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) as recebida,
         date_trunc('month', coalesce(c.data_vencimento, c.data_pagamento))::date as mes
  from public.asaas_cache c
  where c.tipo = 'payment'
    and coalesce(c.data_pagamento, c.data_vencimento) between p_de and p_ate
),
cli as (
  select c.id_asaas, c.documento as doc, c.nome
  from public.asaas_cache c
  where c.tipo = 'customer'
    and c.id_asaas in (select cus from cob where cus is not null)
),
nfa as (
  select distinct on (n.pagamento_ref)
         n.pagamento_ref as pay, n.status, n.nota_numero as numero
  from public.asaas_cache n
  where n.tipo = 'invoice'
    and n.pagamento_ref in (select id_asaas from cob)
  order by n.pagamento_ref,
           case upper(n.status) when 'AUTHORIZED' then 0 when 'ERROR' then 1 else 2 end,
           n.data_efetiva desc nulls last
),
os_exato as (
  select c_cod_int_os, n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false and c_cod_int_os is not null and c_cod_int_os <> ''
    and carimbo_liberado_em is null   -- APOSENTADA
),
os_heur as (
  select distinct on (cnpj_cpf, valor, date_trunc('month', data_previsao))
         cnpj_cpf, valor,
         date_trunc('month', data_previsao)::date as mes,
         n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false
    and (c_cod_int_os is null or c_cod_int_os = '')
    and cnpj_cpf is not null and data_previsao is not null
    and carimbo_liberado_em is null   -- APOSENTADA
  order by cnpj_cpf, valor, date_trunc('month', data_previsao), n_cod_os
),
/* O FORNO, LIDO DO DIÁRIO — o que está na rua e o espelho ainda não sabe. */
forno as (
  select id_asaas
  from (
    select distinct on (e.id_asaas) e.id_asaas, e.resultado
    from public.nf_emissoes e
    where e.criado_em >= now() - interval '2 hours'
      and e.acao in ('faturar', 'criar_e_faturar', 'refazer')
    order by e.id_asaas, e.criado_em desc
  ) ultimo
  where ultimo.resultado = 'em_processamento'
)
select cob.id_asaas, cob.descricao, cli.nome, cli.doc, cob.valor,
       cob.data_vencimento, cob.data_pagamento, cob.status, cob.estornado,
       nfa.status, nfa.numero,
       coalesce(oe.n_cod_os, oh.n_cod_os),
       coalesce(oe.etapa, oh.etapa),
       coalesce(oe.faturada, oh.faturada),
       coalesce(oe.nfse_numero, oh.nfse_numero),
       coalesce(oe.nfse_status, oh.nfse_status),
       coalesce(oe.nfse_xml, oh.nfse_xml),
       coalesce(oe.nfse_verificacao, oh.nfse_verificacao),
       coalesce(oe.nfse_mensagem, oh.nfse_mensagem),
       case
         when cob.estornado and (coalesce(oe.nfse_status, oh.nfse_status) = '004'
              or upper(coalesce(nfa.status,'')) = 'AUTHORIZED') then 'nota_a_cancelar'
         when coalesce(oe.nfse_status, oh.nfse_status) = '004' then 'emitida_omie'
         when coalesce(oe.faturada, oh.faturada)
          and coalesce(oe.nfse_mensagem, oh.nfse_mensagem) is not null then 'nota_rejeitada'
         when coalesce(oe.faturada, oh.faturada) then 'em_processamento'
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED' then 'emitida_asaas'
         when forno.id_asaas is not null then 'em_processamento'
         when not cob.recebida then 'nao_exige'
         else 'falta'
       end
from cob
left join cli on cli.id_asaas = cob.cus
left join nfa on nfa.pay = cob.id_asaas
left join os_exato oe on oe.c_cod_int_os = cob.id_asaas
left join os_heur  oh on oe.n_cod_os is null
                     and oh.cnpj_cpf = cli.doc
                     and oh.valor = cob.valor
                     and oh.mes = cob.mes
left join forno on forno.id_asaas = cob.id_asaas;
$function$;

revoke all on function public.notas_fiscais_painel(date, date) from anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;
