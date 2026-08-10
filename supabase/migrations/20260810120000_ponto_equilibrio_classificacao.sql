-- ============================================================
-- Classificacao de custos do card "Ponto de equilibrio" (/caixa).
--
-- O que e fixo, o que e variavel e o que fica fora da conta e decisao
-- de negocio, nao de contabilidade -- e precisa valer para a empresa
-- inteira, nao para o navegador de quem editou. Antes disso a escolha
-- morava em localStorage e cada login via um ponto de equilibrio
-- diferente.
--
-- UMA LINHA POR RUBRICA, de proposito. Um blob JSONB unico faria duas
-- pessoas mexendo em rubricas diferentes sobrescreverem uma a outra --
-- a mesma licao do merge celula-a-celula da DRE.
--
-- So o que foi mudado A MAO e gravado. O padrao continua no codigo
-- (src/lib/pontoEquilibrio.ts), para rubrica nova na DRE herdar a regra
-- vigente em vez de congelar a de hoje.
-- ============================================================

create table if not exists public.ponto_equilibrio_classificacao (
  rubrica        text primary key,
  bucket         text not null check (bucket in ('variavel', 'fixo', 'fora')),
  atualizado_em  timestamptz not null default now(),
  -- quem mexeu (auth.uid()); sem FK para nao acoplar ao schema auth
  atualizado_por uuid
);

comment on table public.ponto_equilibrio_classificacao is
  'Card Ponto de equilibrio (/caixa): rubrica da DRE -> variavel | fixo | fora. Guarda apenas os ajustes manuais; o padrao vive em src/lib/pontoEquilibrio.ts.';

alter table public.ponto_equilibrio_classificacao enable row level security;

-- Mesma politica das demais tabelas do painel: quem esta logado le e escreve.
-- O bloqueio do cargo "parcerias" acontece na frente (AppLayout), que nem
-- deixa esse perfil chegar em /caixa.
drop policy if exists "auth all ponto_equilibrio_classificacao"
  on public.ponto_equilibrio_classificacao;
create policy "auth all ponto_equilibrio_classificacao"
  on public.ponto_equilibrio_classificacao
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_ponto_equilibrio_classificacao_upd
  on public.ponto_equilibrio_classificacao;
create trigger trg_ponto_equilibrio_classificacao_upd
  before update on public.ponto_equilibrio_classificacao
  for each row execute function public.tg_set_atualizado_em();
