-- Radar: 👍/👎 por anúncio — o insumo para o radar entender a preferência de
-- quem compra, não só a spec que foi digitada no formulário.
--
-- O PROBLEMA. `avaliar()` só sabe o que está escrito em `AlvoSpecs`: marca,
-- termos obrigatórios/proibidos, tier de CPU. Se o Facilities recusa a mesma
-- marca três vezes seguidas num alvo — sempre no olho, nunca no formulário —,
-- essa recusa não deixa rastro nenhum, e a próxima varredura mostra o mesmo
-- anúncio de novo, do mesmo jeito, para a mesma pessoa recusar de novo.
--
-- A DECISÃO, tomada em 03/09/2026 depois de perguntar: o clique é sem atrito
-- (só o ícone, sem formulário) e SEM EFEITO AUTOMÁTICO na varredura — ele só
-- ACUMULA. Quando o mesmo padrão se repete (hoje: mesma marca, 3× 👎, no mesmo
-- alvo), o Hub PROPÕE a regra e a pessoa confirma. É o mesmo desenho já usado no
-- Cartão e nas Tarefas: sinal determinístico, a pessoa carimba — nunca a
-- varredura decidindo sozinha que uma marca boa parece ruim por coincidência.
--
-- POR QUE POR ALVO, E NÃO GLOBAL. `marcas`/`termos_obrigatorios`/
-- `termos_proibidos` já são campos por alvo em `AlvoSpecs` — "não gosto de AOC
-- em Monitor Padrão" não tem por que valer em Notebook Padrão. Um vendedor que
-- decepciona em todo canto é um problema real, mas é OUTRO problema (reputação
-- global), que fica de fora desta rodada de propósito — esta migração guarda
-- `vendedor` e `fonte` em cada linha para não refazer o trabalho quando (e se)
-- isso for pedido.
--
-- A REGRA APLICADA REUSA `termos_proibidos`, e não cria um filtro novo:
-- `avaliar()` já recusa qualquer título que contenha um termo proibido, o card
-- de edição já mostra "Exclui: ...", e uma marca quase sempre aparece no título
-- do anúncio. Um mecanismo de filtro a mais para a mesma pergunta ("essa marca
-- pode?") seria a mesma resposta por dois caminhos que podem divergir.

create table if not exists public.facilities_radar_feedback (
  id          bigserial primary key,
  alvo_id     uuid not null references public.facilities_radar_alvos(id) on delete cascade,
  -- Único por anúncio: reclicar no mesmo ícone desfaz (a linha some), clicar no
  -- outro troca (a linha é atualizada) — nunca duas linhas para o mesmo anúncio.
  oferta_id   bigint not null references public.facilities_radar_ofertas(id) on delete cascade unique,
  sinal       text not null check (sinal in ('gostei', 'nao_gostei')),
  -- Os quatro campos abaixo são a FOTOGRAFIA do anúncio no momento do clique —
  -- lidos da própria oferta, nunca recalculados depois. Um anúncio pode sair da
  -- lista (`ativo=false`) sem que o voto sobre ele deixe de valer para o padrão.
  marca       text,
  vendedor    text,
  fonte       text not null,
  condicao    text not null default 'novo',
  criado_por  text,
  created_at  timestamptz not null default now()
);

comment on table public.facilities_radar_feedback is
  '👍/👎 por anúncio, por alvo. Puramente aditivo: não filtra nada sozinho. Quando a mesma marca acumula 3+ 👎 no mesmo alvo, a Edge Function facilities-radar (action classificar) devolve uma `proposta` para a tela confirmar — a confirmação escreve em facilities_radar_alvos.specs.termos_proibidos, que avaliar() já sabe recusar. Ver a migração de 03/09/2026.';
comment on column public.facilities_radar_feedback.marca is
  'specs_lidas->>marca da oferta no momento do voto (token da lista MARCAS de _shared/radar-precos.ts). Null quando o título não trazia marca reconhecida — o padrão só é detectado quando não é null.';

-- A pergunta "quantos 👎 esta marca já levou neste alvo?" roda a cada clique de
-- 👎 com marca conhecida — sem o índice, vira sequential scan crescente à
-- medida que o histórico de votos cresce.
create index if not exists idx_radar_feedback_padrao
  on public.facilities_radar_feedback (alvo_id, sinal, marca)
  where marca is not null;

alter table public.facilities_radar_feedback enable row level security;

-- Mesmo padrão das outras tabelas do módulo (fac_radar_alvos_all…): app
-- interno, quem está logado enxerga o Facilities inteiro.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facilities_radar_feedback' and policyname='fac_radar_feedback_all') then
    create policy fac_radar_feedback_all on public.facilities_radar_feedback for all to authenticated using (true) with check (true);
  end if;
end $$;

-- FECHAR PARA ANON EXPLICITAMENTE, mesmo com o `alter default privileges` de
-- 30/08/2026 (ver invasao-login-senha-padrao): medir é mais barato que supor, e
-- uma tabela nova em `public` já expôs dado de contraparte no passado deste
-- projeto por causa de um grant que ninguém pediu.
revoke all on public.facilities_radar_feedback from anon, public;
grant select, insert, update, delete on public.facilities_radar_feedback to authenticated;
