-- Comissões Variáveis (/operacional/variavel): os nove times são um array fixo em
-- código (TEAMS, em src/pages/operacional/Variavel.tsx). Quando um time deixa de
-- existir (ex.: "Canais Indiretos (Parceiros)") ou uma planilha vira lixo permanente
-- (403 sem ninguém pra arrumar o compartilhamento), a pessoa quer poder tirá-lo do
-- painel sem editar código — e sem que ele conte como "pendente" no resumo geral.
--
-- Guardamos só o estado (oculto = true/false) por team_key; a lista de times em si
-- continua fixa no front. Arquivar é reversível: a linha nunca é apagada, só marcada.

create table if not exists public.variavel_times_config (
  team_key       text primary key,
  oculto         boolean not null default false,
  atualizado_em  timestamptz not null default now()
);

alter table public.variavel_times_config enable row level security;

create policy "variavel_times_config leitura"
  on public.variavel_times_config for select to authenticated using (true);

create policy "variavel_times_config insere"
  on public.variavel_times_config for insert to authenticated with check (true);

create policy "variavel_times_config atualiza"
  on public.variavel_times_config for update to authenticated using (true) with check (true);

revoke all on public.variavel_times_config from anon;
