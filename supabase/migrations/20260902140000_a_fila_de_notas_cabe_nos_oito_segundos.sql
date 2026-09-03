-- A FILA DE NOTAS CABE NOS OITO SEGUNDOS
--
-- Medido em 02/09/2026: `notas_fiscais_fila_emissao(20)` levava 11,7 a 12,1s
-- contra o `statement_timeout` de 8s do papel `authenticator` — que vale também
-- para quem chega com a service role, porque o limite é do login e não do SET
-- ROLE. O sintoma no diário: das 26 rodadas do cron desde que a chave voltou
-- para `on` em 01/09, VINTE morreram com
--
--     erro = 'fila: canceling statement due to statement timeout'
--
-- e só quatro emitiram. A esteira não estava lenta: estava fechada. E ninguém
-- via, porque `nf_execucoes` gravava a rodada certinho, com `fila: 0` — que é
-- indistinguível de "não havia nada a emitir".
--
-- A RAIZ É UMA SÓ, e explica os três gargalos de uma vez: o planner estima o
-- `cob` em 286 linhas quando são 20.623 — 72× errado, porque o índice sobre
-- `coalesce(data_pagamento, data_vencimento)` não lhe dá seletividade. Com 286
-- linhas imaginárias, reexecutar uma CTE pequena a cada linha parece barato;
-- com 17 mil reais, não é. Medido no `explain (analyze, buffers)` do corpo
-- inteiro (o `explain` sobre a função esconde tudo atrás de um "Function Scan",
-- e foi por isso que isto passou meses invisível):
--
--   passo (distinct on em nf_emissoes)  loops=1697    5.212.131 buffers  ~4,9s
--   lateral da OS pelo carimbo          loops=1684    1.380.883 buffers  ~1,6s
--   join com os clientes do Omie        115,8M comparações                ~25s
--
-- OS TRÊS CONSERTOS, e por que nenhum muda uma vírgula do resultado:
--
--   1. Os clientes do Omie saem de uma CTE e viram TABELA COM ÍNDICE
--      (`omie_clientes_doc`, abaixo). Era o gargalo dominante e o único
--      estrutural: `jsonb_array_elements` sobre o blob de 7.100 clientes não
--      tem índice possível, então o join só sabia ser nested loop — 6.539 ×
--      17.709 comparações de texto. Com a tabela, é um index scan por linha.
--
--   2. `MATERIALIZED` em `passo` e `tentativas` — CTEs pequenas que estavam
--      sendo recalculadas uma vez por cobrança candidata. É dica de PLANO, não
--      de semântica: numa consulta só de leitura e `STABLE`, materializar não
--      pode mudar o conjunto de linhas devolvido.
--
--   3. `and o.c_cod_int_os <> ''` no lateral da OS, que destrava o índice
--      parcial `nf_os_omie_codint_idx` (`where c_cod_int_os is not null and
--      c_cod_int_os <> ''`). O planner não consegue PROVAR que `cob.id_asaas`
--      nunca é string vazia, então descartava o índice e caía num Seq Scan de
--      2.016 linhas repetido 1.684 vezes. Conferido no banco antes de escrever:
--      `c_cod_int_os = ''` são ZERO linhas (1.207 são NULL, que o `=` já
--      exclui), então a condição é inerte.
--
-- A TENTAÇÃO DE MATERIALIZAR TUDO, e o que ela custou. A primeira versão desta
-- migration marcou também `cob` e `cli`. Medido em produção: **11,7s viraram
-- 112s**, buffers de 6,6M para 63,5M, `temp written=4161` (32 MB derramados em
-- disco). `cob` carrega a coluna `dados` — o jsonb inteiro da cobrança, ~1,5 KB
-- × 20.623 linhas — e materializar obriga a carregar esse peso num tuplestore,
-- além de tirar do planner a chance de empurrar o filtro
-- `nfse_bloqueio_emissao(...)` para dentro do index scan, que descartava 2.872
-- linhas de graça. A regra que fica: **materialize a CTE que é REEXECUTADA e
-- cabe na memória; nunca a que é grande e já está bem filtrada por índice.**
--
-- O resto do corpo das duas funções está reproduzido SEM ALTERAÇÃO, de
-- propósito: cada cláusula abaixo custou um acidente (as três sombras
-- anti-duplicata, a carência depois do erro, o `coalesce(..., false)` que evita
-- o NULL do `left join` reprovar a linha inteira). Mexer no desempenho não é
-- hora de mexer na régua.

-- ---------------------------------------------------------------------------
-- OS CLIENTES DO OMIE, INDEXÁVEIS
--
-- `omie_cache.dados` com `chave = 'clientes'` é UM jsonb com 7.100 objetos
-- dentro, escrito de uma vez pelo `omie-clientes-sync` (semanal, segunda 05h
-- BRT). É a fonte certa e continua sendo — o que não dá é JUNTAR por ela: não
-- existe índice sobre o resultado de `jsonb_array_elements`, e o CNPJ ainda
-- precisa de um `regexp_replace` por elemento.
--
-- Esta tabela é uma PROJEÇÃO, não uma segunda fonte da verdade: quem escreve é
-- só o gatilho, a partir do mesmo blob, na mesma transação em que ele muda.
-- Ninguém precisa lembrar de atualizá-la, que é a única forma de espelho que
-- não apodrece.
--
-- `min(codigo)` por documento reproduz exatamente o que a CTE fazia: o Omie tem
-- documentos repetidos em cadastros diferentes e a escolha do menor código é a
-- que já estava em vigor. Trocá-la aqui mudaria em qual cadastro a nota é
-- emitida — não é conserto de desempenho.
-- ---------------------------------------------------------------------------
create table if not exists public.omie_clientes_doc (
  doc           text primary key,
  codigo        bigint not null,
  atualizado_em timestamptz not null default now()
);

comment on table public.omie_clientes_doc is
  'Projeção indexável de omie_cache/clientes: CNPJ/CPF limpo -> menor código do Omie. '
  'Escrita só pelo gatilho omie_clientes_doc_do_cache. Não editar à mão.';

alter table public.omie_clientes_doc enable row level security;

drop policy if exists omie_clientes_doc_leitura on public.omie_clientes_doc;
create policy omie_clientes_doc_leitura on public.omie_clientes_doc
  for select to authenticated using (true);

revoke all on public.omie_clientes_doc from anon;

create or replace function public.omie_clientes_doc_refazer()
returns void
language sql
security definer
set search_path to 'public'
as $$
  with novo as (
    select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
           min((c->>'codigo')::bigint) as codigo
    from public.omie_cache, jsonb_array_elements(dados) c
    where chave = 'clientes'
      and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
    group by 1
  ),
  apagados as (
    delete from public.omie_clientes_doc d
    where not exists (select 1 from novo n where n.doc = d.doc)
  )
  insert into public.omie_clientes_doc (doc, codigo, atualizado_em)
  select doc, codigo, now() from novo
  on conflict (doc) do update
    set codigo = excluded.codigo, atualizado_em = excluded.atualizado_em
    where public.omie_clientes_doc.codigo is distinct from excluded.codigo;
$$;

/* O GATILHO É O QUE DISPENSA ALGUÉM LEMBRAR.
   `when (new.chave = 'clientes')` para não pagar nada nas outras seis chaves do
   `omie_cache`, que mudam a cada hora (movimentos, contas_pagar). */
create or replace function public.omie_clientes_doc_do_cache()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.omie_clientes_doc_refazer();
  return null;
end;
$$;

drop trigger if exists omie_clientes_doc_do_cache on public.omie_cache;
create trigger omie_clientes_doc_do_cache
  after insert or update of dados on public.omie_cache
  for each row when (new.chave = 'clientes')
  execute function public.omie_clientes_doc_do_cache();

-- A carga inicial: sem isto a fila nasceria vazia e ninguém saberia por quê,
-- porque `join` que não casa não devolve erro — devolve ausência.
select public.omie_clientes_doc_refazer();

create or replace function public.notas_fiscais_fila_emissao(p_limite integer default 20)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
  email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, status_asaas text, estornado boolean
)
language sql
stable
set search_path to 'public'
as $function$
with cfg as (
  select data_corte, paralelo_asaas, avulsa_sem_asaas_desde
  from public.nf_config where id = 1
),
cli as (
  /* `documento` é a COLUNA GERADA de `asaas_cache`, com exatamente o mesmo
     regexp que estava escrito aqui (`[^0-9]` no lugar de `\D`). Conferido linha
     a linha antes de trocar: 0 divergências em 6.247 clientes. Não
     materializada de propósito — o planner alcança esta CTE pelo
     `asaas_cache_painel_cliente_idx` uma linha por vez, a 0,007ms. */
  select id_asaas, documento as doc, dados->>'email' as email
  from public.asaas_cache where tipo = 'customer'
),
passo as materialized (
  /* Sem `materialized` esta CTE era REEXECUTADA uma vez por cobrança candidata
     — 1.697 vezes, varrendo 2.124 linhas de `nf_emissoes` e refazendo o
     `distinct on` a cada uma: 5.212.131 buffers sozinha. São 863 linhas. */
  select distinct on (id_asaas)
         id_asaas, resultado, criado_em, coalesce(erro, '') as erro
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and criado_em > now() - interval '30 days'
  order by id_asaas, criado_em desc
),
tentativas as materialized (
  -- 130 linhas, reagregadas 1.697 vezes pelo mesmo motivo. Barato, mas de graça.
  select id_asaas, count(*)::int as n
  from public.nf_emissoes
  where acao in ('faturar', 'criar_e_faturar')
    and resultado = 'erro'
    and criado_em > now() - interval '7 days'
  group by 1
),
cob as (
  /* NÃO materializada, e isso é medido: com `materialized` a consulta foi de
     11,7s para 112s, porque ela carrega o `dados` inteiro. Ver o cabeçalho. */
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
-- Era uma CTE desempacotando 7.100 objetos de jsonb, junta por nested loop:
-- 115,8 milhões de comparações. Agora é a chave primária de uma tabela.
join public.omie_clientes_doc oc on oc.doc = cli.doc
left join public.asaas_nf_config nfc on nfc.assinatura = cob.assinatura
left join passo p on p.id_asaas = cob.id_asaas
left join tentativas t on t.id_asaas = cob.id_asaas
left join lateral (
  select o.n_cod_os, o.faturada
  from public.nf_os_omie o
  /* O `<> ''` NÃO É REDUNDANTE, é o que destrava o índice parcial. Ver o
     cabeçalho: zero linhas com `c_cod_int_os = ''`, então é inerte. */
  where o.cancelada = false
    and o.c_cod_int_os = cob.id_asaas
    and o.c_cod_int_os <> ''
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
  /* SOMBRA 1 — pela COMPETÊNCIA. */
  and not exists (
    select 1 from public.nf_os_omie o2
    where o2.cancelada = false and o2.nfse_status = '004'
      and o2.cnpj_cpf = cli.doc and o2.valor = cob.valor
      and date_trunc('month', o2.data_faturamento) = date_trunc('month', cob.competencia)
      and coalesce(o2.c_cod_int_os, '') in ('', cob.id_asaas)
  )
  /* SOMBRA 2 — pela PREVISÃO (a parcelada de cartão). */
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
     produzia o laço de 323 tentativas em 19 cobranças. */
  and not exists (
    select 1 from public.nf_os_omie o4
    where o4.cancelada = false and o4.faturada = true
      and coalesce(o4.c_cod_int_os, '') = ''
      and o4.cnpj_cpf = cli.doc and o4.valor = cob.valor
      and date_trunc('month', o4.data_previsao) = date_trunc('month', cob.previsao)
  )
  /* A NOTA DO ASAAS — a MESMA régua da porta ao vivo.
     `ERROR` e `CANCELED` não existem no portal nacional: não há segunda nota a
     criar, e por isso não barram. Todo o resto (AUTHORIZED, SCHEDULED,
     SYNCHRONIZED, PENDING, PROCESSING_CANCELLATION) barra. */
  and not exists (
    select 1 from public.asaas_cache n
    where n.tipo = 'invoice' and n.pagamento_ref = cob.id_asaas
      and n.status not in ('ERROR', 'CANCELED', 'CANCELLED')
  )
order by coalesce(cob.data_pagamento, cob.data_vencimento), cob.id_asaas
limit greatest(p_limite, 0);
$function$;

-- ---------------------------------------------------------------------------
-- As CANDIDATAS levam o mesmo remédio.
--
-- Elas são a rota do lote MANUAL (`action:"emitir"` com `ids`), e sofrem do
-- mesmo mal por serem irmãs de nascimento: o mesmo `cli`, o mesmo `omie_cli`. A
-- diferença é que a lista de ids restringe o `cob` a algumas dezenas de linhas,
-- então o nested loop nunca doeu o bastante para aparecer — até alguém emitir o
-- mês inteiro em levas de 20 e pagar a fila inteira por leva.
-- ---------------------------------------------------------------------------
create or replace function public.notas_fiscais_candidatas(p_ids text[], p_avulsa boolean default false)
returns table(
  id_asaas text, descricao text, valor numeric, data_vencimento date, data_pagamento date,
  email text, cnpj_cpf text, n_cod_cli bigint, n_cod_os bigint, ja_tem_nota boolean,
  status_asaas text, estornado boolean, bloqueio text
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
       public.nfse_bloqueio_emissao(cob.status, cob.dados, cob.estorno_registrado, coalesce(p_avulsa, false))
from cob
left join cli on cli.id_asaas = cob.cus
left join public.omie_clientes_doc oc on oc.doc = cli.doc
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

-- ---------------------------------------------------------------------------
-- O CINTO, além dos suspensórios.
--
-- Mesmo depois do conserto, esta fila é a consulta mais cara do módulo e vai
-- crescer com o acervo: `data_corte` está em 01/01/2026 e cada mês novo entra
-- inteiro no `cob`. Um `statement_timeout` próprio na função tira a rodada da
-- dependência de um limite que existe para proteger a API do painel, não a
-- esteira — e que ninguém lembra de conferir quando a fila engorda.
--
-- 30s e não mais: passado disso o problema é de desenho, e o certo é o cron
-- falhar alto em vez de segurar uma conexão. O relógio do worker da Edge (150s
-- até a primeira resposta) continua sendo o teto de verdade.
-- ---------------------------------------------------------------------------
alter function public.notas_fiscais_fila_emissao(integer) set statement_timeout = '30s';
alter function public.notas_fiscais_candidatas(text[], boolean) set statement_timeout = '30s';

-- O `revoke from anon` do padrão do repo: `create or replace function` devolve o
-- grant público, e sem isto a fila fica legível sem sessão.
revoke all on function public.notas_fiscais_fila_emissao(integer) from anon;
revoke all on function public.notas_fiscais_candidatas(text[], boolean) from anon;
revoke all on function public.omie_clientes_doc_refazer() from anon;
