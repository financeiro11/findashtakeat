-- Radar de Preços do Facilities.
--
-- O QUE RESOLVE. Hoje a compra de equipamento começa quando alguém precisa: abre
-- a solicitação, sai cotando na hora e compra pelo preço que o dia ofereceu. O
-- radar inverte isso — o Facilities registra o que quer e por quanto, e o Hub
-- fica vigiando o preço no lugar dele. Quando bater, avisa.
--
-- QUATRO TABELAS, E CADA UMA EXISTE POR UM MOTIVO:
--
--   `alvos`    o pedido, com as specs já traduzidas pela IA (jsonb `specs`,
--              formato AlvoSpecs de _shared/radar-precos.ts).
--   `ofertas`  cada anúncio que já apareceu, uma linha por (alvo, fonte, id).
--              É atualizada, não reinserida — o id_externo é o que dá a
--              continuidade entre uma varredura e a seguinte.
--   `precos`   append-only, o preço de cada varredura. **É esta tabela que
--              separa oportunidade de ruído.** Sem ela, "R$ 2.890, abaixo do
--              teto de R$ 3.000" é indistinguível de um produto que custa
--              R$ 2.890 desde maio; com ela dá para dizer "menor preço já
--              visto". Avisar sem essa distinção treina a pessoa a ignorar o
--              radar, que é o único jeito de ele falhar de vez.
--   `alertas`  o que subiu para a tela. Único por (alvo, oferta, preço) para o
--              mesmo achado não reaparecer todo dia até alguém arquivar.
--
-- O RADAR NÃO COMPRA E NÃO ABRE CARD SOZINHO. Ele avisa; virar cotação é clique
-- de gente. Automação que gasta dinheiro sem uma pessoa no meio não é o que foi
-- pedido, e não é o que este módulo faz.

/* ------------------------------------------------------------------ alvos */

create table if not exists public.facilities_radar_alvos (
  id                uuid primary key default gen_random_uuid(),
  titulo            text not null,
  -- O texto que a pessoa escreveu, cru. Guardado para dar para reinterpretar
  -- quando a leitura da IA sair torta, sem obrigar a redigitar.
  pedido            text not null,
  link_ref          text,
  categoria         text not null default 'TI',
  specs             jsonb not null default '{}'::jsonb,
  preco_alvo        numeric not null check (preco_alvo > 0),
  quantidade        integer not null default 1,
  solicitacao_id    uuid references public.facilities_solicitacoes(id) on delete set null,
  fontes            text[] not null default array['mercado_livre','kabum','terabyte','amazon'],
  ativo             boolean not null default true,
  criado_por        text,
  ultima_varredura  timestamptz,
  ultimo_erro       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_radar_alvos_ativo on public.facilities_radar_alvos (ativo, ultima_varredura nulls first);
create index if not exists idx_radar_alvos_solic on public.facilities_radar_alvos (solicitacao_id);

/* ---------------------------------------------------------------- ofertas */

create table if not exists public.facilities_radar_ofertas (
  id                bigserial primary key,
  alvo_id           uuid not null references public.facilities_radar_alvos(id) on delete cascade,
  fonte             text not null,
  id_externo        text not null,
  titulo            text not null,
  url               text not null,
  imagem_url        text,
  vendedor          text,
  condicao          text not null default 'novo',
  preco             numeric not null,
  -- Menor preço já visto NESTE anúncio. Redundante com `precos`, e de propósito:
  -- a tela ordena por ele e não vai fazer min() sobre o histórico a cada render.
  preco_min         numeric,
  frete_gratis      boolean not null default false,
  score             integer not null default 0,
  motivos           text[] not null default '{}',
  conferir          text[] not null default '{}',
  specs_lidas       jsonb not null default '{}'::jsonb,
  -- Anúncio que saiu do ar ou saiu dos filtros vira ativo=false, não é apagado:
  -- o histórico de preço dele continua valendo como referência de mercado.
  ativo             boolean not null default true,
  primeiro_visto_em timestamptz not null default now(),
  visto_em          timestamptz not null default now(),
  unique (alvo_id, fonte, id_externo)
);

create index if not exists idx_radar_ofertas_alvo on public.facilities_radar_ofertas (alvo_id, ativo, preco);

/* ------------------------------------------------------- histórico de preço */

create table if not exists public.facilities_radar_precos (
  id          bigserial primary key,
  oferta_id   bigint not null references public.facilities_radar_ofertas(id) on delete cascade,
  preco       numeric not null,
  coletado_em timestamptz not null default now()
);

create index if not exists idx_radar_precos_oferta on public.facilities_radar_precos (oferta_id, coletado_em);

/* --------------------------------------------------------------- alertas */

create table if not exists public.facilities_radar_alertas (
  id          bigserial primary key,
  alvo_id     uuid not null references public.facilities_radar_alvos(id) on delete cascade,
  oferta_id   bigint not null references public.facilities_radar_ofertas(id) on delete cascade,
  tipo        text not null,           -- alvo_batido | minimo_historico | queda_forte
  texto       text not null,
  preco       numeric not null,
  preco_alvo  numeric not null,
  status      text not null default 'novo',  -- novo | visto | virou_cotacao | arquivado
  cotacao_id  uuid,
  visto_por   text,
  visto_em    timestamptz,
  created_at  timestamptz not null default now(),
  -- O mesmo anúncio pelo mesmo preço não avisa duas vezes. Se cair de novo,
  -- é outro preço e é outro alerta.
  unique (alvo_id, oferta_id, preco)
);

create index if not exists idx_radar_alertas_status on public.facilities_radar_alertas (status, created_at desc);

/* -------------------------------------------------------------- execuções */

-- Diário de bordo da varredura. Existe para responder "por que hoje não achou
-- nada" sem precisar reproduzir a rodada: fonte que devolveu 0, fonte que deu
-- 403, quantos anúncios foram recusados e por quê.
create table if not exists public.facilities_radar_execucoes (
  id           bigserial primary key,
  iniciado_em  timestamptz not null default now(),
  terminado_em timestamptz,
  alvos        integer not null default 0,
  ofertas      integer not null default 0,
  alertas      integer not null default 0,
  detalhe      jsonb not null default '{}'::jsonb
);

/* -------------------------------------------------------------------- RLS */

alter table public.facilities_radar_alvos      enable row level security;
alter table public.facilities_radar_ofertas    enable row level security;
alter table public.facilities_radar_precos     enable row level security;
alter table public.facilities_radar_alertas    enable row level security;
alter table public.facilities_radar_execucoes  enable row level security;

-- Mesmo padrão das outras seis tabelas do módulo (fac_solic_all, fac_cot_all…):
-- app interno, quem está logado enxerga o Facilities inteiro.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_alvos' and policyname='fac_radar_alvos_all') then
    create policy fac_radar_alvos_all on public.facilities_radar_alvos for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_ofertas' and policyname='fac_radar_ofertas_all') then
    create policy fac_radar_ofertas_all on public.facilities_radar_ofertas for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_precos' and policyname='fac_radar_precos_all') then
    create policy fac_radar_precos_all on public.facilities_radar_precos for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_alertas' and policyname='fac_radar_alertas_all') then
    create policy fac_radar_alertas_all on public.facilities_radar_alertas for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_execucoes' and policyname='fac_radar_exec_all') then
    create policy fac_radar_exec_all on public.facilities_radar_execucoes for all to authenticated using (true) with check (true);
  end if;
end $$;

/* ------------------------------------------------------------------ painel */

-- Uma linha por alvo, com o resumo que o card precisa. É RPC e não select
-- direto porque juntar alvo + melhor oferta + contagem de alerta no front
-- exigiria trazer a tabela de ofertas inteira — e o PostgREST corta em 1000
-- linhas sem avisar (é o mesmo tropeço que já custou caro no Asaas).
create or replace function public.facilities_radar_painel()
returns table (
  alvo               jsonb,
  alertas_novos      integer,
  ofertas_ativas     integer,
  melhor             jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_jsonb(a) as alvo,
    (select count(*)::int from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'novo') as alertas_novos,
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo
       order by o.preco asc, o.score desc
       limit 1) as melhor
  from facilities_radar_alvos a
  order by a.ativo desc, a.created_at desc;
$$;

/* FUNÇÃO NOVA NASCE ABERTA, e não é para `anon`: é para PUBLIC. Por isso
   `revoke ... from anon` não muda nada — a ACL fica com `=X/postgres` e o
   has_function_privilege('anon', …) continua true. Tem de tirar de PUBLIC e
   devolver nominalmente a quem deve ter. Conferido comparando a ACL desta com a
   de demonstracoes_lancamentos, que já estava certa. */
revoke all on function public.facilities_radar_painel() from public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;

/* -------------------------------------------------- alerta → cotação real */

-- Leva o achado para o fluxo que o módulo já tem: vira Cotação, com valor, link
-- e o vendedor no lugar do fornecedor. Daí para a frente é a aprovação de
-- sempre (LIMITE_APROVACAO, tarefa automática, compra, NF).
--
-- Cria a solicitação quando o alvo ainda não tem uma, porque
-- facilities_cotacoes.solicitacao_id é NOT NULL. Isso NÃO é o radar abrindo
-- card sozinho: só acontece no clique de uma pessoa, e a tela avisa antes.
create or replace function public.facilities_radar_virar_cotacao(
  p_alerta_id bigint,
  p_quem      text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_al     facilities_radar_alertas%rowtype;
  v_alvo   facilities_radar_alvos%rowtype;
  v_of     facilities_radar_ofertas%rowtype;
  v_solic  uuid;
  v_cot    uuid;
  v_nova   boolean := false;
begin
  select * into v_al from facilities_radar_alertas where id = p_alerta_id;
  if not found then raise exception 'Alerta % não existe.', p_alerta_id; end if;
  if v_al.cotacao_id is not null then
    return jsonb_build_object('cotacao_id', v_al.cotacao_id, 'ja_existia', true);
  end if;

  select * into v_alvo from facilities_radar_alvos   where id = v_al.alvo_id;
  select * into v_of   from facilities_radar_ofertas where id = v_al.oferta_id;

  v_solic := v_alvo.solicitacao_id;
  if v_solic is null then
    insert into facilities_solicitacoes (titulo, categoria, valor, status, solicitante, observacao)
    values (
      v_alvo.titulo,
      v_alvo.categoria,
      v_al.preco * greatest(v_alvo.quantidade, 1),
      'em_cotacao',
      coalesce(p_quem, v_alvo.criado_por),
      'Aberta pelo Radar de Preços. Pedido original: ' || v_alvo.pedido
    )
    returning id into v_solic;
    v_nova := true;
    update facilities_radar_alvos set solicitacao_id = v_solic, updated_at = now() where id = v_alvo.id;
  end if;

  insert into facilities_cotacoes (solicitacao_id, fornecedor_nome, valor, link_url, observacao)
  values (
    v_solic,
    coalesce(v_of.vendedor, v_of.fonte),
    v_al.preco,
    v_of.url,
    v_of.titulo
      || case when array_length(v_of.conferir, 1) is null then ''
              else E'\n⚠ Conferir no anúncio: ' || array_to_string(v_of.conferir, ', ') end
      || E'\nRadar: ' || v_al.texto
  )
  returning id into v_cot;

  update facilities_radar_alertas
     set status = 'virou_cotacao', cotacao_id = v_cot,
         visto_por = coalesce(p_quem, visto_por), visto_em = now()
   where id = p_alerta_id;

  return jsonb_build_object('cotacao_id', v_cot, 'solicitacao_id', v_solic, 'solicitacao_nova', v_nova);
end $$;

revoke all on function public.facilities_radar_virar_cotacao(bigint, text) from public;
grant execute on function public.facilities_radar_virar_cotacao(bigint, text) to authenticated, service_role;

/* ------------------------------------------------------------- cron token */

insert into public.internal_cron_tokens (name, token)
values ('facilities-radar', replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

comment on table public.facilities_radar_precos is
  'Append-only: um preço por varredura, por anúncio. É o que permite dizer "menor preço já visto" em vez de só "abaixo do teto" — sem isso o radar avisa todo dia a mesma coisa e vira ruído.';
