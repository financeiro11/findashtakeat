-- Sinal externo de churn: descobrir que o restaurante fechou antes do
-- cancelamento chegar.
--
-- COMO O HUB SABE DE UM CHURN HOJE. Depois. A aba Churn de /assinaturas lê o
-- snapshot, os estornos se conciliam no fechamento, e o cancelamento entra
-- quando o cliente cancela — quer dizer, quando a decisão já foi tomada e
-- executada. Tudo é medição post-mortem, e boa: o problema é que nenhuma delas
-- é acionável, porque quando o número aparece não há mais nada a fazer.
--
-- O QUE ESTA TABELA GUARDA É OUTRA COISA: um indício público, anterior ao
-- cancelamento, de que o cliente PAROU DE OPERAR. Restaurante que fecha deixa
-- rastro na rua antes de deixar no financeiro — a página no iFood sai do ar, o
-- Google marca "fechado permanentemente", aparece post de despedida. Quem está
-- inadimplente há dois meses e fechou as portas não é uma cobrança a insistir; é
-- um churn que já aconteceu e ainda não foi contabilizado.
--
-- ISTO É UM INDÍCIO, NUNCA UM VEREDITO — e a estrutura da tabela obriga a isso.
-- Não há coluna "fechado": há `sinal` (o que se achou), `evidencia` (onde) e
-- `conferido_por` (quem olhou). Homônimo é comum em nome de restaurante, e uma
-- busca que confunde duas pizzarias com o mesmo nome cancelaria a cobrança de um
-- cliente ativo. A máquina traz o indício; a pessoa decide.
--
-- O CUSTO. Uma busca por cliente, 2 créditos (o Firecrawl cobra 2 a cada 10
-- resultados). A fila é curta de propósito — só quem está inadimplente há mais
-- de 30 dias E tem valor em aberto que justifique a pergunta —, e ninguém é
-- perguntado duas vezes no mesmo trimestre.

create table if not exists public.churn_sinais (
  id            bigserial primary key,
  cliente_ref   text not null,
  cliente_nome  text,
  documento     text,
  procurado_em  timestamptz not null default now(),
  -- 'fechado'   → a busca achou marcação explícita de encerramento
  -- 'indicio'   → algo sugere, mas não afirma (post de despedida, página fora)
  -- 'nada'      → nada público sugere encerramento. É resultado, não fracasso:
  --               registra-se para não perguntar de novo no trimestre.
  -- 'homonimo'  → o que se achou é de outra empresa com nome parecido
  sinal         text not null default 'nada',
  resumo        text,
  -- Os links em que a leitura se baseou. Sem isto o sinal é boato: quem for
  -- decidir precisa poder abrir e ver com os próprios olhos.
  evidencia     jsonb not null default '[]'::jsonb,
  -- Quanto estava em aberto quando a pergunta foi feita. Congelado de propósito:
  -- é o que justifica a prioridade da linha, e muda depois.
  valor_aberto  numeric,
  dias_atraso   integer,
  conferido_em  timestamptz,
  conferido_por text,
  -- O que a pessoa concluiu: 'fechado_mesmo' | 'segue_aberto' | 'nao_sei'
  desfecho      text
);

create index if not exists churn_sinais_cliente on public.churn_sinais (cliente_ref, procurado_em desc);

alter table public.churn_sinais enable row level security;
drop policy if exists churn_sinais_leitura on public.churn_sinais;
create policy churn_sinais_leitura on public.churn_sinais
  for select to authenticated using (true);
drop policy if exists churn_sinais_conferir on public.churn_sinais;
create policy churn_sinais_conferir on public.churn_sinais
  for update to authenticated using (true) with check (true);

/* ================================================================== a fila */

-- QUEM MERECE A PERGUNTA.
--
-- São 399 clientes com cobrança vencida. Perguntar por todos seriam ~800
-- créditos, quase um quinto do plano, para descobrir que a imensa maioria só
-- está atrasada — inadimplência de um mês é rotina de cobrança, não sinal de
-- fechamento. O corte de 30 dias é o que separa "esqueceu de pagar" de "parou de
-- pagar", e o valor em aberto ordena o que se pergunta primeiro.
--
-- NINGUÉM É PERGUNTADO DUAS VEZES NO TRIMESTRE. Sem esta cláusula a fila
-- devolveria os mesmos primeiros colocados toda semana — o cliente com maior
-- valor em aberto é, por definição, quem fica no topo — e a rodada gastaria o
-- crédito inteiro reperguntando sobre as mesmas dez empresas.
-- O NOME NÃO ESTÁ NA COBRANÇA. Medido em 27/08/2026: das 465 cobranças vencidas
-- no espelho, ZERO tem `nome` preenchido — a coluna existe na tabela porque
-- `asaas_cache` guarda tipos diferentes na mesma estrutura, e quem a preenche é
-- a linha de CADASTRO (`tipo = 'customer'`), não a de cobrança. A primeira
-- versão desta função agrupava só as cobranças e devolvia a fila inteira sem
-- nome; a rodada de estreia pulou os dois primeiros clientes com "sem nome no
-- cadastro" e não gastou crédito nenhum — falhou barato, mas falhou.
--
-- Daí o `join` com a linha de cadastro, que também é de onde sai o documento
-- (18 das 465 não têm cadastro espelhado; essas ficam de fora, porque sem nome
-- não há o que procurar).
create or replace function public.churn_fila_sinal(p_limite integer default 10)
returns table (
  cliente_ref  text,
  cliente_nome text,
  documento    text,
  valor_aberto numeric,
  dias_atraso  integer,
  cobrancas    integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with vencidas as (
    select
      p.cliente_ref,
      sum(p.valor) as valor_aberto,
      max((current_date - p.data_vencimento))::int as dias_atraso,
      count(*)::int as cobrancas
    from asaas_cache p
    where p.tipo = 'payment'
      and p.status = 'OVERDUE'
      and p.cliente_ref is not null
      and p.data_vencimento < current_date - 30
    group by p.cliente_ref
  )
  select
    v.cliente_ref,
    nullif(coalesce(c.nome, c.dados->>'name', ''), ''),
    nullif(coalesce(c.documento, c.dados->>'cpfCnpj', ''), ''),
    v.valor_aberto, v.dias_atraso, v.cobrancas
  from vencidas v
  join asaas_cache c
    on c.tipo = 'customer' and c.id_asaas = v.cliente_ref
  where not exists (
    select 1 from churn_sinais s
    where s.cliente_ref = v.cliente_ref
      and s.procurado_em > now() - interval '90 days'
  )
    -- Sem nome não há o que procurar, e a busca gastaria o crédito para
    -- pesquisar uma string vazia. Fica de fora da fila, não no fim dela.
    and coalesce(c.nome, c.dados->>'name', '') <> ''
    /* QUEM JÁ SE SABE QUE CANCELOU NÃO PRECISA SER PROCURADO.
     *
     * O time escreve o desfecho no PRÓPRIO NOME do cliente no Asaas —
     * "Romero Pizzaria [CANCELADO 08/26]". Três dos quatro primeiros da fila,
     * na estreia, eram assim: seriam 6 créditos para a internet confirmar o que
     * o cadastro já dizia.
     *
     * E o valor aberto os mantém no topo justamente por serem cancelamentos com
     * dívida — quer dizer, sem este filtro a fila serviria PRIMEIRO os casos
     * mais inúteis, toda semana, até o trimestre virar. */
    and coalesce(c.nome, c.dados->>'name', '') !~* 'cancelad'
  order by v.valor_aberto desc
  limit greatest(coalesce(p_limite, 10), 1);
$$;

revoke all on function public.churn_fila_sinal(integer) from anon, public;
grant execute on function public.churn_fila_sinal(integer) to authenticated, service_role;
