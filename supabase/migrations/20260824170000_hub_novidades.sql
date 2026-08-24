-- Novidades do Hub — o diário de bordo das mudanças da própria ferramenta.
--
-- POR QUE EXISTE: o Hub muda quase todo dia (3 a 28 commits por dia nas últimas
-- duas semanas) e quem usa a ferramenta descobre a mudança por acidente — abre a
-- DRE e a célula agora faz outra coisa. A aba Briefing já é o lugar onde se olha
-- "o que é o dia de hoje"; faltava o outro lado: "o que mudou no Hub ontem".
--
-- A FONTE É O GIT, não um changelog escrito à mão: changelog à mão envelhece na
-- primeira semana em que ninguém lembra de escrever. Os commits deste repositório
-- já são texto em português explicando a mudança e o porquê — a IA só condensa
-- para quem não lê commit, e o VÍNCULO (dia, autor, sha, arquivos, rota da tela)
-- é determinístico. Se a IA falhar, a lista continua saindo com o assunto do
-- commit; o dia nunca fica em branco por causa dela.
--
-- Escrita: só a Edge Function `hub-novidades-sync` (service_role), no cron diário
-- das 08:35 BRT — antes do briefing das 09:00. Leitura: qualquer pessoa logada.

create table if not exists public.hub_novidades (
  -- um dia = uma linha (data em America/Sao_Paulo, que é como as pessoas contam
  -- "ontem"). Reprocessar o mesmo dia sobrescreve, não duplica.
  dia            date primary key,
  resumo         text,
  -- itens redigidos: [{ titulo, o_que_muda, tipo, area, rota, rota_label,
  --                     commits: [sha], hora }]
  itens          jsonb       not null default '[]'::jsonb,
  -- o sinal cru que gerou os itens: [{ sha, assunto, corpo, autor, data,
  --                                    url, arquivos: [path], area, rota }]
  commits        jsonb       not null default '[]'::jsonb,
  n_commits      integer     not null default 0,
  -- 'ia' quando a redação saiu do modelo, 'commits' quando caiu no plano B
  redigido_por   text        not null default 'ia',
  gerado_em      timestamptz not null default now()
);

comment on table public.hub_novidades is
  'Mudanças do próprio Hub, por dia, lidas dos commits do GitHub e redigidas pela hub-novidades-sync.';

create index if not exists hub_novidades_dia_desc on public.hub_novidades (dia desc);

-- Até onde cada pessoa já leu. É o que permite dizer "3 novidades desde a sua
-- última visita" em vez de reapresentar o mesmo dia todas as manhãs.
create table if not exists public.hub_novidades_leitura (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  visto_ate     date        not null,
  atualizado_em timestamptz not null default now()
);

comment on table public.hub_novidades_leitura is
  'Até que dia cada pessoa já leu as Novidades do Hub (marca de leitura própria).';

/* ------------------------------- privilégios ------------------------------- */
-- Mesmo padrão do briefing_diario: só service_role escreve o conteúdo, quem está
-- logado só lê, anon não enxerga nada.
revoke all on public.hub_novidades from anon, authenticated;
grant  select on public.hub_novidades to authenticated;
grant  all    on public.hub_novidades to service_role;

alter table public.hub_novidades enable row level security;

drop policy if exists "auth_read" on public.hub_novidades;
create policy "auth_read"
  on public.hub_novidades for select to authenticated using (true);

-- A marca de leitura é o contrário: cada pessoa escreve a SUA linha (é a tela que
-- grava, com o token da sessão) e não enxerga a das outras.
revoke all on public.hub_novidades_leitura from anon, authenticated;
grant  select, insert, update on public.hub_novidades_leitura to authenticated;
grant  all on public.hub_novidades_leitura to service_role;

alter table public.hub_novidades_leitura enable row level security;

drop policy if exists "leitura_propria_select" on public.hub_novidades_leitura;
create policy "leitura_propria_select"
  on public.hub_novidades_leitura for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "leitura_propria_insert" on public.hub_novidades_leitura;
create policy "leitura_propria_insert"
  on public.hub_novidades_leitura for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "leitura_propria_update" on public.hub_novidades_leitura;
create policy "leitura_propria_update"
  on public.hub_novidades_leitura for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ---------------------------------- cron ---------------------------------- */
insert into public.internal_cron_tokens (name)
select 'hub-novidades-sync'
where not exists (
  select 1 from public.internal_cron_tokens where name = 'hub-novidades-sync'
);

select cron.unschedule('hub-novidades-diario')
where exists (select 1 from cron.job where jobname = 'hub-novidades-diario');

-- 11:35 UTC ≈ 08:35 em São Paulo: o dia de ontem já está fechado e a leitura
-- chega ANTES do briefing das 09:00, que é onde a aba aparece.
select cron.schedule(
  'hub-novidades-diario',
  '35 11 * * *',
  $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/hub-novidades-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- apikey + Authorization: o gateway (verify_jwt) valida ANTES de a função rodar.
      'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnY3h5eHlpZG9pcnFtYmRsbGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MzM2OTAsImV4cCI6MjA5NDEwOTY5MH0.-lENhEbTqq1cHs9oImKGCrCIhDKfWMu9BL8TwhfX04U',
      'x-cron-token',  (select token from public.internal_cron_tokens where name = 'hub-novidades-sync')
    ),
    -- 2 dias: fecha ontem e já deixa o começo de hoje na tela.
    body := '{"dias":2}'::jsonb
  );
  $cron$
);
