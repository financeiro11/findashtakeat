-- Firecrawl: o orçamento deixa de ser um número solto e vira rateio com dono.
--
-- O QUE HAVIA. Um único freio, `SALDO_MINIMO_RASPAGEM = 150`, escrito em
-- `_shared/radar-precos.ts` e consultado pelo radar de preços. O radar de
-- editais gasta do mesmo pote e não olha freio nenhum. Enquanto foram dois
-- consumidores com um plano de 500 créditos isso bastou: o radar era grande
-- demais para o resto importar.
--
-- POR QUE NÃO BASTA MAIS. Com o plano de 5.000 e cinco consumidores, o freio
-- por saldo global tem um defeito que só aparece quando o pote é disputado: ele
-- protege o CRÉDITO, não a PRIORIDADE. Quem roda primeiro no dia leva o que
-- quiser, e quem roda por último encontra a parede — independentemente de qual
-- dos dois vale mais. Na prática seria a vigilância de páginas de preço (que
-- pode esperar um dia sem prejuízo nenhum) comendo o crédito da conferência do
-- radar (que, parada, deixa anúncio fantasma na tela do Facilities).
--
-- ENTÃO SÃO DOIS FREIOS, e eles respondem perguntas diferentes:
--
--   • TETO MENSAL, por consumidor — "esta função já gastou o quinhão dela?".
--     Mora aqui, no banco, somado do razão abaixo. É o que impede um laço
--     defeituoso de torrar o mês numa madrugada.
--
--   • PISO DE SALDO, por consumidor — "ainda há crédito no plano para gente
--     desta importância?". Compara com o saldo REAL lido da API do Firecrawl
--     (consulta que não gasta crédito). É a escada de prioridade: quanto menor
--     o piso, mais fundo o consumidor pode cavar antes de parar. A conferência
--     do radar para por último (120); a busca de sinal de churn para primeiro
--     (900), porque é a que menos dói adiar.
--
-- O RAZÃO É ESTIMATIVA, E ISSO ESTÁ ASSUMIDO. O Firecrawl cobra 1 crédito por
-- página, 5 quando precisa de proxy stealth, e cobra igual quando o site
-- responde 403. De dentro da função não dá para saber qual dos três aconteceu.
-- Então quem registra grava o que PEDIU (`medido = false`) e, quando consegue
-- medir pela diferença de saldo antes/depois — que é o que o radar já faz —,
-- grava o número real (`medido = true`). A verdade global continua sendo a API;
-- o razão existe para responder de QUEM foi o gasto, que a API não conta.
--
-- Os números de cada quinhão, e a conta que os produziu, estão no `insert` mais
-- abaixo.

/* ========================================================== o razão de gasto */

create table if not exists public.firecrawl_consumo (
  id          bigserial primary key,
  consumidor  text        not null,
  creditos    integer     not null,
  -- false = "foi isto que eu pedi"; true = "foi isto que o saldo caiu".
  medido      boolean     not null default false,
  quando      timestamptz not null default now(),
  detalhe     jsonb       not null default '{}'::jsonb
);

comment on table public.firecrawl_consumo is
  'Razão de créditos de Firecrawl por consumidor. Estimado por padrão; medido quando a rodada consegue ler o saldo antes e depois.';

-- O índice é (consumidor, quando) porque toda leitura é "quanto ESTE gastou
-- DESTE mês para cá" — a consulta que o guarda-corpo faz antes de cada rodada.
create index if not exists firecrawl_consumo_quem_quando
  on public.firecrawl_consumo (consumidor, quando desc);

alter table public.firecrawl_consumo enable row level security;
drop policy if exists firecrawl_consumo_leitura on public.firecrawl_consumo;
create policy firecrawl_consumo_leitura on public.firecrawl_consumo
  for select to authenticated using (true);

/* ============================================================= o rateio */

create table if not exists public.firecrawl_orcamento (
  consumidor  text primary key,
  rotulo      text    not null,
  teto_mes    integer not null,
  piso_saldo  integer not null,
  ativo       boolean not null default true,
  -- Por que este consumidor existe, em uma linha. Aparece no painel: um teto
  -- sem motivo é um número que ninguém sabe se pode mexer.
  para_que    text,
  atualizado_em timestamptz not null default now()
);

alter table public.firecrawl_orcamento enable row level security;
drop policy if exists firecrawl_orcamento_leitura on public.firecrawl_orcamento;
create policy firecrawl_orcamento_leitura on public.firecrawl_orcamento
  for select to authenticated using (true);

-- `on conflict do nothing`: o rateio é editável pela tela, e reaplicar a
-- migração não pode desfazer o ajuste de quem estava olhando o painel.
-- OS NÚMEROS, E DE ONDE SAEM. Nominal é o que o ritmo agendado consome por mês;
-- o teto tem folga sobre ele porque a página que exige proxy stealth custa 5 em
-- vez de 1, e nenhuma função sabe de antemão qual vai exigir.
--
--   consumidor       nominal   teto    a conta
--   radar_varrer      1.200    1.400   4 rodadas × 2 alvos × 5 fontes × 30 dias
--   radar_conferir    ~1.000   1.100   4 rodadas × ~8 anúncios × 30 dias
--   editais           ~1.050   1.100   11 páginas + 8 buscas (2 créd./10 result.)
--                                      + até 8 aprofundamentos, por dia
--   cadastro_cnpj      ~0        400   só quando a BrasilAPI recusa; a fila de
--                                      277 presas é uma rajada, não um ritmo
--   vigilancia          300      350   10 páginas × 1 leitura/dia
--   churn_sinal         ~90      150   ~30 clientes/mês × 2 buscas + 1 leitura
--                     ------   ------
--                      3.640    4.500  de 5.000 do plano
--
-- A SOMA DOS TETOS É MENOR QUE O PLANO DE PROPÓSITO. Os 500 que sobram não são
-- de ninguém: são a margem para o mês em que uma loja passar a exigir stealth e
-- o custo de uma varredura quintuplicar sem aviso.
insert into public.firecrawl_orcamento (consumidor, rotulo, teto_mes, piso_saldo, para_que) values
  ('radar_conferir', 'Radar — conferência',     1100, 120,
     'Abre o anúncio e checa estoque e frete. É o que tira fantasma da tela: para por último.'),
  -- 500 é o gêmeo de `SALDO_MINIMO_RASPAGEM` em `_shared/radar-precos.ts`, que
  -- é o número que a TELA usa para dizer "varredura suspensa". Se os dois se
  -- separarem, existe uma faixa em que o Facilities lê que o radar parou e o
  -- radar continua varrendo — ou o contrário, que é pior.
  ('radar_varrer',   'Radar — varredura',       1400, 500,
     'Lê as vitrines atrás de preço novo. O maior consumidor, e o que mais rende.'),
  ('cadastro_cnpj',  'Cadastro — CNPJ',          400, 250,
     'Endereço oficial quando a BrasilAPI recusa por limite de taxa. Cada crédito aqui destrava uma NFS-e presa.'),
  ('editais',        'Radar de editais',        1100, 600,
     'Coleta as chamadas de fomento e abre as que passaram no filtro para achar prazo e valor.'),
  ('vigilancia',     'Vigilância de páginas',    350, 800,
     'Uma leitura por dia das páginas de preço dos fornecedores. Adiar um dia não custa nada.'),
  ('churn_sinal',    'Sinal externo de churn',   150, 900,
     'Procura sinal público de que o cliente inadimplente fechou as portas. O primeiro a parar.')
on conflict (consumidor) do nothing;

/* ================================================== quanto sobra, por quem */

-- `p_desde` existe porque o ciclo do Firecrawl NÃO é o mês do calendário: ele
-- renova na data da assinatura, e a API devolve isso em `billingPeriodEnd`.
-- Quem sabe a data é a função que acabou de ler o saldo, então ela manda; sem
-- ela, o começo do mês corrente é a aproximação honesta (erra no máximo alguns
-- dias, e sempre para o lado conservador de contar gasto a mais).
create or replace function public.firecrawl_orcamento_status(p_desde timestamptz default null)
returns table (
  consumidor  text,
  rotulo      text,
  para_que    text,
  ativo       boolean,
  teto_mes    integer,
  piso_saldo  integer,
  gasto_ciclo integer,
  resta_ciclo integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with corte as (
    select coalesce(p_desde, date_trunc('month', now() at time zone 'America/Sao_Paulo')
                             at time zone 'America/Sao_Paulo') as desde
  )
  select
    o.consumidor, o.rotulo, o.para_que, o.ativo, o.teto_mes, o.piso_saldo,
    coalesce((select sum(c.creditos)::int from firecrawl_consumo c, corte
               where c.consumidor = o.consumidor and c.quando >= corte.desde), 0) as gasto_ciclo,
    greatest(0, o.teto_mes - coalesce((select sum(c.creditos)::int from firecrawl_consumo c, corte
               where c.consumidor = o.consumidor and c.quando >= corte.desde), 0)) as resta_ciclo
  from firecrawl_orcamento o
  order by o.piso_saldo asc;
$$;

-- Ver `supabase-grant-anon-automatico`: função nova nasce chamável sem login.
revoke all on function public.firecrawl_orcamento_status(timestamptz) from anon, public;
grant execute on function public.firecrawl_orcamento_status(timestamptz) to authenticated, service_role;
