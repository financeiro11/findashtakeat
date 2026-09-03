-- Passagens aéreas: a viagem marcada tem teto, e o Hub avisa quando dá para
-- comprar.
--
-- O QUE RESOLVE. Hoje a passagem é comprada no dia em que a viagem é marcada,
-- pelo preço que o dia ofereceu — exatamente o problema que o Radar de Preços
-- resolveu para equipamento. A diferença é que passagem não é produto: o
-- "produto" é a tupla (origem, destino, ida, volta), o preço muda várias vezes
-- ao dia, e nada do motor do Radar (marca, acessório, piso de preço, specs)
-- significa coisa alguma aqui. Por isso módulo próprio, e não uma categoria
-- nova lá dentro: forçar passagem no `avaliar()` estragaria um motor limpo.
--
-- O QUE TRANSFERE do Radar é a FORMA, não o código: alvo com teto, curva de
-- preço, e aviso só no que dá para agir. E só a metade "modo compra" — janela
-- curta com aviso ativo. A vigia permanente (curva de rota o ano inteiro) foi
-- descartada de propósito na conversa de 03/09/2026: o que dói é a viagem
-- marcada, não a curva histórica da rota.
--
-- DE ONDE VEM O PREÇO, e por que não é uma API. Em 2026 esse caminho fechou: a
-- Amadeus Self-Service desligou em 17/07/2026, a Kiwi Tequila fechou para novos
-- desenvolvedores em agosto, e o teste da Duffel devolve sandbox. O que sobrou
-- de graça é o alerta do próprio Google Flights, que monitora quantas rotas se
-- queira, sem cobrar e sem anti-robô, e manda e-mail para o financeiro@ — uma
-- caixa que este Hub já sabe ler (`_shared/gmail.ts`, `gmail-nf-sync`).
--
-- O TRABALHO QUE SOBRA PARA O HUB é justamente o que o Google não faz. Ele
-- avisa quando o preço MEXE; ninguém quer isso. Com dezenas de viagens
-- rastreadas, repassar o "mexeu" seria reproduzir a caixa de entrada que este
-- módulo existe para calar. O Hub compara com o SEU teto e só faz barulho no
-- que dá para comprar — e no fim responde o que a caixa de entrada nunca
-- responde: quanto se pagou × qual era o teto × qual foi o menor visto na
-- janela, ou seja, quanto a espera economizou.
--
-- ZERO CRÉDITO DE FIRECRAWL. O orçamento de raspagem está 100% rateado entre
-- oito consumidores que somam exatos 5.000; este módulo não pede nada dele.

/* ------------------------------------------------------------------ viagens */

create table if not exists public.passagens_viagens (
  id             uuid primary key default gen_random_uuid(),
  -- IATA, sempre maiúscula. Texto livre e não FK para uma tabela de aeroporto:
  -- a lista de `_shared/passagens.ts` cobre o caso comum e o formulário aceita
  -- código digitado à mão — um destino fora da lista não pode travar a viagem.
  origem         text not null,
  destino        text not null,
  data_ida       date not null,
  -- Null = só ida. É diferente de "ainda não sei a volta": quem não sabe não
  -- marcou a viagem, e o que este módulo rastreia é viagem marcada.
  data_volta     date,
  teto           numeric not null check (teto > 0),
  quem_viaja     text,
  motivo         text,
  -- Liga com o pipeline de compras quando a viagem nasceu de uma solicitação.
  -- `set null`: apagar a solicitação não pode levar a curva de preço junto.
  solicitacao_id uuid references public.facilities_solicitacoes(id) on delete set null,
  status         text not null default 'rastreando'
                   check (status in ('rastreando', 'comprada', 'cancelada', 'expirada')),
  preco_comprado numeric check (preco_comprado is null or preco_comprado > 0),
  comprado_em    timestamptz,
  -- O link do Google Flights, montado por `linkGoogleFlights`. Guardado e não
  -- recalculado na tela: se a função mudar de formato amanhã, o alerta que a
  -- pessoa já criou no Google continua sendo ESTE, e é ele que ela precisa
  -- reabrir para desligar o rastreamento.
  google_url     text,
  -- Quando alguém confirmou que ligou "Rastrear preços" no Google. Null = a
  -- viagem está cadastrada mas ninguém ligou o alerta — e sem isso não chega
  -- e-mail nenhum, que é a falha mais silenciosa possível deste módulo.
  rastreando_em  timestamptz,
  criado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint passagens_volta_depois_da_ida
    check (data_volta is null or data_volta >= data_ida)
);

comment on table public.passagens_viagens is
  'Viagem marcada com teto de preço. Janela curta e aviso ativo — o equivalente ao "modo compra" do Radar, sem a vigia permanente. O preço vem do alerta do Google Flights por e-mail; ver passagens-gmail-sync.';
comment on column public.passagens_viagens.rastreando_em is
  'Quando alguém confirmou ter ligado "Rastrear preços" no Google Flights. Não existe API para criar esse alerta — é o único passo manual do módulo, e sem ele nenhum e-mail chega. A tela cobra.';

create index if not exists idx_passagens_viagens_abertas
  on public.passagens_viagens (status, data_ida)
  where status = 'rastreando';

/* ------------------------------------------------------- histórico de preço */

-- Append-only, como `facilities_radar_precos`: é esta tabela que separa
-- "R$ 1.100 é barato" de "R$ 1.100 é o preço de sempre desta rota".
create table if not exists public.passagens_precos (
  id          bigserial primary key,
  viagem_id   uuid not null references public.passagens_viagens(id) on delete cascade,
  preco       numeric not null check (preco > 0),
  fonte       text not null default 'email_google'
                check (fonte in ('email_google', 'manual')),
  cia         text,
  coletado_em timestamptz not null default now()
);

create index if not exists idx_passagens_precos_viagem
  on public.passagens_precos (viagem_id, coletado_em);

/* --------------------------------------------------------- os e-mails lidos */

-- TODO alerta lido vira linha aqui, inclusive o que NÃO casou com viagem
-- nenhuma. Três motivos, e o terceiro é o que mais importa:
--
--   1. idempotência — `gmail_id` único impede o mesmo e-mail virar dois pontos
--      na curva quando o cron roda de novo sobre a mesma janela;
--   2. fila humana — e-mail que casou com duas viagens (mesmo destino, datas
--      diferentes, sem data no texto) não pode ser chutado nem descartado: ele
--      espera alguém dizer de qual viagem é;
--   3. depurar o parser sem adivinhação — o `trecho` guarda o texto que o
--      casador viu. Quando o Google mudar o layout do e-mail, a pergunta "o que
--      exatamente chegou?" tem resposta gravada, em vez de exigir esperar o
--      próximo alerta para descobrir.
create table if not exists public.passagens_emails (
  id          bigserial primary key,
  gmail_id    text not null unique,
  assunto     text,
  recebido_em timestamptz,
  viagem_id   uuid references public.passagens_viagens(id) on delete set null,
  preco       numeric,
  confianca   text check (confianca is null or confianca in ('alta', 'media')),
  -- Sempre preenchido quando não casou, em português, para a tela poder dizer
  -- POR QUE aquele e-mail está parado esperando gente.
  motivo      text,
  trecho      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_passagens_emails_orfaos
  on public.passagens_emails (created_at desc)
  where viagem_id is null;

/* ====================================================================== RLS */

alter table public.passagens_viagens enable row level security;
alter table public.passagens_precos  enable row level security;
alter table public.passagens_emails  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='passagens_viagens' and policyname='passagens_viagens_all') then
    create policy passagens_viagens_all on public.passagens_viagens for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='passagens_precos' and policyname='passagens_precos_all') then
    create policy passagens_precos_all on public.passagens_precos for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='passagens_emails' and policyname='passagens_emails_all') then
    create policy passagens_emails_all on public.passagens_emails for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Fechar para anon explicitamente — ver invasao-login-senha-padrao. Aqui há
-- nome de quem viaja e destino: dado de pessoa, não só de preço.
revoke all on public.passagens_viagens from anon, public;
revoke all on public.passagens_precos  from anon, public;
revoke all on public.passagens_emails  from anon, public;
grant select, insert, update, delete on public.passagens_viagens to authenticated;
grant select, insert, update, delete on public.passagens_precos  to authenticated;
grant select, insert, update, delete on public.passagens_emails  to authenticated;

/* =================================================================== painel */

-- Uma linha por viagem, com os agregados que o card precisa. RPC e não
-- select+join no front porque menor/último/primeiro preço saem de três
-- agregações sobre a mesma tabela — trazer a curva inteira de dezenas de
-- viagens para somar no navegador esbarraria no corte silencioso de 1000 linhas
-- do PostgREST.
create or replace function public.passagens_painel()
returns table (
  viagem         jsonb,
  menor_visto    numeric,
  menor_em       timestamptz,
  ultimo_preco   numeric,
  ultimo_em      timestamptz,
  primeiro_preco numeric,
  pontos         integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_jsonb(v) as viagem,
    (select min(p.preco) from passagens_precos p where p.viagem_id = v.id) as menor_visto,
    (select p.coletado_em from passagens_precos p where p.viagem_id = v.id
      order by p.preco asc, p.coletado_em asc limit 1) as menor_em,
    (select p.preco from passagens_precos p where p.viagem_id = v.id
      order by p.coletado_em desc limit 1) as ultimo_preco,
    (select p.coletado_em from passagens_precos p where p.viagem_id = v.id
      order by p.coletado_em desc limit 1) as ultimo_em,
    -- O primeiro ponto é a régua da economia: é contra ele que "caiu 18% desde
    -- que começamos a olhar" faz sentido.
    (select p.preco from passagens_precos p where p.viagem_id = v.id
      order by p.coletado_em asc limit 1) as primeiro_preco,
    (select count(*)::int from passagens_precos p where p.viagem_id = v.id) as pontos
  from passagens_viagens v
  order by
    -- Quem ainda pode ser comprada primeiro, e dentro disso a viagem mais
    -- próxima: é ela que perde a chance antes.
    (v.status <> 'rastreando'),
    v.data_ida asc,
    v.created_at desc;
$$;

revoke all on function public.passagens_painel() from anon, public;
grant execute on function public.passagens_painel() to authenticated, service_role;

/* ================================================================= expirar */

-- Viagem cuja ida já passou não é mais "rastreando": ela virou histórico, e
-- deixá-la no topo da lista faria a tela mentir sobre o que ainda dá para
-- comprar. Roda no começo de toda sincronização, pelo mesmo motivo que
-- `facilities_radar_dormir_expirados` roda no começo da varredura — se
-- depender de alguém lembrar de arquivar, não acontece.
--
-- Não mexe em `comprada`/`cancelada`: essas já foram decididas por gente.
create or replace function public.passagens_expirar()
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with fechadas as (
    update passagens_viagens
       set status = 'expirada', updated_at = now()
     where status = 'rastreando'
       and data_ida < (now() at time zone 'America/Sao_Paulo')::date
    returning 1
  )
  select count(*)::int from fechadas;
$$;

revoke all on function public.passagens_expirar() from anon, public;
grant execute on function public.passagens_expirar() to authenticated, service_role;

/* ============================================================ série do sino */

-- O aviso não é uma tela nova: entra no sino que já existe. `direcao: abaixo`
-- porque aqui a notícia é o preço CAIR — o contrário de quase todas as outras
-- séries. Produtor determinístico: não compara com mediana nenhuma, compara com
-- o teto que uma pessoa digitou (ver `deveAvisar` em _shared/passagens.ts).
insert into public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
values (
  'passagens.abaixo_do_teto', 'facilities',
  'Passagem entrou no teto',
  'Alerta do Google Flights trouxe um preço dentro do teto da viagem, ou abaixo do menor já visto. '
    'Determinístico: compara com o teto digitado, não com banda estatística.',
  '/facilities/passagens', 'abaixo', 'alta', true
)
on conflict (serie) do update
  set titulo = excluded.titulo,
      descricao = excluded.descricao,
      rota = excluded.rota,
      modulo = excluded.modulo,
      atualizado_em = now();
