-- O painel de notícias aprende o que eu quero ler — e mostra o que aprendeu.
--
-- O PEDIDO (29/08/2026): "uma forma de eu dizer que gostei (quero mais) ou que
-- não gostei (evite)". Cada item do painel ganha 👍 e 👎.
--
-- O PROBLEMA DE UM BOTÃO DESSES é que ele é fácil de colocar e difícil de fazer
-- valer alguma coisa. A versão preguiçosa guarda o clique num log e nunca mais o
-- lê — o feedback vira enfeite, e a pessoa descobre isso no terceiro dia em que
-- o assunto que ela recusou volta. A versão pior guarda o clique num modelo que
-- se ajusta sozinho, e aí o painel muda de humor sem que ninguém saiba por quê.
--
-- O ARRANJO É O DA CASA, o mesmo do resto do módulo: SINAL DETERMINÍSTICO, IA SÓ
-- DESCREVE. O voto vira VOCABULÁRIO. A IA lê o item votado e devolve um rótulo
-- curto e de dois a cinco termos ("preço de API de IA" → preco, api, token,
-- modelo); daí em diante quem decide é `aplicarPreferencias`, em TypeScript, com
-- casamento de palavra igual ao que a régua já faz com o nome dos nossos
-- fornecedores. O peso é CONTAGEM de votos, com sinal — três 👍 valem +3, um 👎
-- depois deixa +2. Nada de taxa de aprendizado, nada de decaimento: é o único
-- formato que a pessoa consegue prever ao clicar e conferir depois na tela.
--
-- E DÁ PARA ABRIR E APAGAR. É por isso que isto é uma tabela com rótulo legível
-- e não um vetor: o painel mostra a lista do que aprendeu, com o peso e os
-- termos de cada assunto, e um botão para esquecer. Aprendizado que não se
-- audita é fé, e fé num filtro que decide o que alguém lê de manhã é caro
-- demais.
--
-- OS DOIS TETOS, que moram na régua e ficam registrados aqui porque são a
-- escolha e não o detalhe: um assunto sozinho mexe no máximo 4 pontos, a soma de
-- todos no máximo 6. Preferência empurra a fila do dia; não substitui a régua.
-- E a partir de DOIS votos negativos o assunto deixa de descontar e passa a
-- vetar — um 👎 pode ser o dia ruim ou o clique errado, dois é uma pessoa
-- dizendo a mesma coisa duas vezes.

create table if not exists public.briefing_noticias_preferencias (
  id          bigserial primary key,
  -- O rótulo normalizado. É por aqui que os votos se somam: "Preço de API de IA"
  -- e "preço de api de ia" têm de cair na mesma linha, senão o peso nunca passa
  -- de 1 e o botão não aprende nada — só acumula linhas parecidas na tela.
  assunto     text        not null unique,
  -- Como se escreve na tela. Até quatro palavras, em português.
  rotulo      text        not null,
  -- O que a régua casa. Normalizado (sem acento, minúsculo), de 2 a 5 termos,
  -- e o casamento exige DOIS deles no mesmo texto: um termo solto é
  -- coincidência — "preço" aparece em metade das manchetes de tecnologia.
  termos      text[]      not null default '{}',
  -- Soma dos votos, com sinal. > 0 quero mais, < 0 evite.
  peso        integer     not null default 0,
  votos       integer     not null default 0,
  -- As manchetes que geraram o assunto. É a prova: sem elas, a tela de
  -- preferências seria uma lista de afirmações sobre o gosto de alguém.
  exemplos    text[]      not null default '{}',
  -- De que pauta veio o primeiro voto. Só para a tela agrupar.
  pauta       text,
  -- Desligar em vez de apagar: quem esqueceu um assunto e viu o efeito piorar
  -- consegue voltar atrás, e a régua ignora o inativo do mesmo jeito.
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  text,
  atualizado_em timestamptz not null default now()
);

comment on table public.briefing_noticias_preferencias is
  'O que o 👍/👎 do painel de notícias ensinou: assunto, termos que a régua casa e peso (soma dos votos, com sinal). Lido por `pontuar` em _shared/briefing-noticias.ts.';

-- A rodada lê "todos os ativos com peso" uma vez por dia. São dezenas de linhas,
-- não milhares — o índice é para a tela, que ordena pelo peso absoluto.
create index if not exists briefing_noticias_prefs_ativas
  on public.briefing_noticias_preferencias (peso desc) where ativo;

alter table public.briefing_noticias_preferencias enable row level security;

drop policy if exists briefing_prefs_leitura on public.briefing_noticias_preferencias;
create policy briefing_prefs_leitura on public.briefing_noticias_preferencias
  for select to authenticated using (true);

-- Esquecer e reativar são da tela; escrever assunto novo é da função
-- (service_role, que não passa por policy). Apagar de vez também é da tela:
-- "esquece isso" tem de poder ser literal, senão a lista vira depósito.
drop policy if exists briefing_prefs_editar on public.briefing_noticias_preferencias;
create policy briefing_prefs_editar on public.briefing_noticias_preferencias
  for update to authenticated using (true) with check (true);

drop policy if exists briefing_prefs_apagar on public.briefing_noticias_preferencias;
create policy briefing_prefs_apagar on public.briefing_noticias_preferencias
  for delete to authenticated using (true);

/* =========================================================== o carimbo de hora */

create or replace function public.briefing_prefs_toca()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists briefing_prefs_toca on public.briefing_noticias_preferencias;
create trigger briefing_prefs_toca
  before update on public.briefing_noticias_preferencias
  for each row execute function public.briefing_prefs_toca();
