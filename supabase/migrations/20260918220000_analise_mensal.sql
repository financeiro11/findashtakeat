-- A camada de análise: todos os números do Hub alinhados por mês, num lugar só.
--
-- Pedido do financeiro (18/09/2026): cruzar DRE/DFC, BP, operação e aquisição para tirar
-- análises. Cada fonte mede o mês de um jeito — a DRE por competência (e a de 2025 por
-- CAIXA), a DFC por caixa, o OS pelo que o comercial lança (com canal que às vezes falta),
-- a carteira pela base do fim do mês — e cruzar isso de cabeça é o jeito de comparar julho
-- com junho sem perceber. Aqui cada número vem com a fonte, o regime, o plano do BP, a meta
-- do OS e um status que diz se dá para confiar nele.
--
-- Formato LONGO (uma linha por métrica por mês): métrica nova não pede migration, e o
-- Assistente, a Revisão e as análises leem pelo nome da métrica.
--
-- Quem escreve: a Edge Function `analise-mensal-montar`, com o módulo puro
-- supabase/functions/_shared/analise-mensal.ts (a conta e a fórmula de cada métrica).
-- Roda depois da cópia diária do OS e sob demanda. Troca inteira a cada rodada.

create table if not exists public.analise_mensal (
  competencia  date not null,
  metrica      text not null,
  rotulo       text not null,
  grupo        text not null,     -- resultado | caixa | carteira | aquisicao | retencao | eficiencia
  unidade      text not null,     -- BRL | count | percent | ratio | meses
  valor        numeric,
  plano        numeric,           -- BP do ano, quando o BP tem a linha
  meta         numeric,           -- orçado do Takeat OS, quando existe
  fonte        text not null,     -- DRE | DFC | OS | Carteira OS | Painel CAC | Estornos Asaas | Derivado
  regime       text not null,     -- competencia | caixa | carteira | lancamento_os | derivado
  status       text not null,     -- ok | mes_aberto | incompleto | estimado | regime_caixa | sem_dado
  formula      text,
  nota         text,
  sensivel     boolean not null default false,
  calculado_em timestamptz not null default now(),
  primary key (competencia, metrica)
);

comment on table public.analise_mensal is
  'Camada de análise: uma linha por métrica por mês, com fonte, regime, plano (BP), meta (OS) e status de confiança. Escrita por analise-mensal-montar (_shared/analise-mensal.ts). Ver migration 20260918220000.';

create index if not exists analise_mensal_metrica_idx on public.analise_mensal (metrica, competencia);

-- Junta resultado (DRE), caixa, aquisição e retenção: é leitura de quem vê as métricas de
-- cliente E as demonstrações. Linha sensível (margem, LTV e derivados) exige a checagem
-- dura de demonstrações, como no espelho do OS.
alter table public.analise_mensal enable row level security;
drop policy if exists "le quem ve metricas e demonstracoes" on public.analise_mensal;
create policy "le quem ve metricas e demonstracoes" on public.analise_mensal
  for select to authenticated using (
    public.pode_ler('metricas') and public.pode_ler('demonstracoes')
    and (not sensivel or auth.uid() is null or public.pode('demonstracoes'))
  );
revoke insert, update, delete on public.analise_mensal from authenticated, anon;

insert into public.internal_cron_tokens (name, token)
select 'analise-mensal-montar', gen_random_uuid()::text
where not exists (select 1 from public.internal_cron_tokens where name = 'analise-mensal-montar');

-- Todo dia às 06:15 BRT: 15 min depois da cópia do OS (09:00 UTC), que dispara o cálculo
-- do que o OS deixa vazio — a análise lê os_painel_completo e precisa dele pronto.
select cron.unschedule(jobid) from cron.job where jobname = 'analise-mensal-montar';
select cron.schedule('analise-mensal-montar', '15 9 * * *', $cron$
  select public.disparar_automacao(
    'analise-mensal-montar',
    'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/analise-mensal-montar',
    jsonb_build_object('trigger', 'cron'),
    'analise-mensal-montar', null, null)
$cron$);
