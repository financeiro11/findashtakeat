-- Remuneração: a linha do tempo de quanto cada pessoa ganha, mês a mês.
--
-- O pedido veio do diretor de receita: ele precisa saber quando cada pessoa
-- entrou, quanto ganhava, e separar o que é fixo do que é comissão — para ter
-- conversa de plano de carreira com número na mão em vez de memória.
--
-- POR QUE UMA TABELA NOVA, e não uma view sobre o que já existe:
--
--   `cap_titulos` responde isso hoje, mas é uma view sobre `omie_cache` e o
--   cache é uma JANELA ROLANTE — hoje começa em abril/2026 e anda para frente.
--   Um painel de histórico construído em cima dela perderia o passado sozinho,
--   sem erro e sem aviso, à medida que a janela andasse. Aqui o passado é
--   gravado; a janela do cache vira só a fonte da carga mais recente.
--
--   E o histórico vai ter TRÊS fontes: o Omie (abr/2026 em diante), o export do
--   Conta Azul (mar/2025 a mar/2026) e as NFs do Drive. Cada linha declara de
--   onde veio, porque quando dois números discordarem é essa coluna que diz
--   qual acreditar.

/* ------------------------------------------------------------------ */
/* Quem pode ver                                                       */
/* ------------------------------------------------------------------ */

-- Remuneração individual é o dado mais sensível do Hub, e até aqui ele estava
-- aberto: a policy do espelho do RH era `to authenticated using (true)`, e a
-- aba Colaboradores mostra a coluna `valor`. Ou seja, o salário de todo mundo
-- já era legível por qualquer pessoa logada.
--
-- A função é SECURITY DEFINER porque precisa ler `profiles` de quem chamou sem
-- depender da RLS de `profiles` — uma policy que consulta uma tabela com RLS
-- entra em recursão. `coalesce(..., false)` importa: sem linha em `profiles`
-- o `in (...)` devolveria NULL, e NULL numa policy é indistinguível de false
-- na prática mas confunde quem for depurar depois.
create or replace function public.pode_ver_remuneracao()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select lower(btrim(coalesce(p.cargo, ''))) in ('ceo', 'financeiro', 'diretoria')
       from public.profiles p
      where p.user_id = auth.uid()
      limit 1),
    false)
$$;

comment on function public.pode_ver_remuneracao() is
  'Cargo do usuário logado pode ver remuneração individual? Usada na RLS do painel de remuneração E do espelho do RH.';

/* ------------------------------------------------------------------ */
/* As pessoas                                                          */
/* ------------------------------------------------------------------ */

-- POR QUE O CADASTRO NÃO É `rh_colaboradores`: o espelho do Portal RH guarda
-- 106 ativos e só 12 desligados — quem sai some de lá. Nos pagamentos do Omie
-- existem 135 favorecidos distintos nas categorias de pessoal, e 33 deles não
-- têm ficha no espelho: são gente que passou pela Takeat e foi removida do
-- Portal. Se o cadastro fosse o espelho, o histórico dessas pessoas sumiria
-- justamente quando elas saíssem — que é quando o histórico importa.
--
-- Então este cadastro é SUPERCONJUNTO: todo mundo que já recebeu. O espelho do
-- RH enriquece (cargo, setor, início, contrato) quem estiver nos dois.
create table if not exists public.remuneracao_pessoa (
  id          uuid primary key default gen_random_uuid(),

  -- Nome de exibição. É o apelido que a Parametrização já resolveu: o Omie
  -- entrega "DALBER NEGOCIOS" e "51.967.013 LEONARDO DIAS BUSSULAR", e
  -- `contraparte_apelido` devolve "Breno D'Alberto" e "Leonardo Dias Bussular".
  nome        text not null,

  -- `contraparte_chave(nome)` — a forma normalizada pela qual as cargas casam.
  -- É a chave única de verdade; `nome` é só o que a tela mostra.
  chave       text not null unique,

  -- `codigo` do espelho do RH ("COL-003057") quando a pessoa tem ficha lá.
  -- Nulo para quem já saiu antes do espelho existir. NÃO usar CNPJ como chave:
  -- quatro pessoas ativas dividem o 37.511.891/0001-50.
  codigo_rh   text unique,

  -- CNPJ/CPF só de dígitos, quando conhecido. Ajuda a casar o export do Conta
  -- Azul; não é único, pelo motivo acima.
  doc         text,

  -- Nem todo favorecido de categoria "Pessoal" é gente: "Ecoesfera Inova
  -- Simples I S" e "SHROUD e B2TG CAPITAL" caíram lá. Marcar em vez de apagar
  -- — apagar faria a soma do painel deixar de bater com a DRE, e ninguém
  -- descobriria por quê.
  eh_pessoa   boolean not null default true,

  observacao  text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.remuneracao_pessoa is
  'Todo mundo que já recebeu como Pessoal/Premiação/Escala — inclusive quem saiu e sumiu do Portal RH.';

create index if not exists remuneracao_pessoa_codigo_rh_idx
  on public.remuneracao_pessoa (codigo_rh) where codigo_rh is not null;
create index if not exists remuneracao_pessoa_doc_idx
  on public.remuneracao_pessoa (doc) where doc is not null;

/* ------------------------------------------------------------------ */
/* Os pagamentos                                                       */
/* ------------------------------------------------------------------ */

-- O grão é o LANÇAMENTO, não o mês. Guardar já somado por mês pareceria mais
-- simples e custaria caro: sem o título de origem não há como conferir uma
-- linha contra o ERP, nem como recarregar uma competência sem duplicar. A soma
-- mensal é a view aqui embaixo.
create table if not exists public.remuneracao_lancamento (
  id           bigserial primary key,
  pessoa_id    uuid not null references public.remuneracao_pessoa(id) on delete cascade,

  -- Primeiro dia do mês TRABALHADO — não o do pagamento. A folha de agosto/2026
  -- vence em 05/09; sem essa distinção agosto inteiro cairia em setembro e o
  -- painel ficaria sutilmente errado, que é o pior jeito de errar.
  competencia  date not null,

  -- A taxonomia vem da categoria do Omie, pela PALAVRA e nunca pelo código:
  --   'fixo'       3.1.1.x / 3.2.7.x Pessoal - <área>
  --   'premiacao'  Premiação - <área>   (é a comissão)
  --   'escala'     Escala - <área>      (plantão do Suporte e do Onboarding)
  --   'prolabore'  Pro Labore           (sócios; some junto com o fixo na tela)
  --   'outro'      escape, para o que aparecer depois
  --
  -- POR QUE PELA PALAVRA: a mesma descrição tem dois códigos no Omie
  -- ("3.1.1.11 Premiação - Sucesso" é 2.01.94 em abril e 2.03.03 de maio em
  -- diante), e o número do prefixo se repete entre coisas diferentes
  -- (3.1.1.10 é "Pro Labore", "Premiação - Suporte" E "Pessoal - Novos
  -- Canais"). Quem classificar por código perde abril inteiro.
  bloco        text not null
               check (bloco in ('fixo','premiacao','escala','prolabore','outro')),

  valor        numeric(14,2) not null,

  -- De onde este número veio. Quando duas fontes discordarem do mesmo mês, é
  -- esta coluna que decide qual vale — e a tela mostra a divergência em vez de
  -- escolher calada.
  fonte        text not null
               check (fonte in ('omie','conta_azul','nf_drive','manual')),

  -- O identificador na fonte: `nCodTitulo` no Omie, a linha do export no Conta
  -- Azul, a resposta do formulário no Drive. Junto com `fonte` é o que faz a
  -- carga ser idempotente — rodar duas vezes não duplica.
  origem_ref   text not null,

  -- A descrição da categoria como veio, guardada crua. É a prova de por que a
  -- linha foi classificada naquele bloco.
  categoria    text,

  vencimento   date,
  pagamento    date,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (fonte, origem_ref)
);

comment on table public.remuneracao_lancamento is
  'Um pagamento de remuneração. Grão de lançamento, com a fonte declarada em cada linha.';

create index if not exists remuneracao_lancamento_pessoa_idx
  on public.remuneracao_lancamento (pessoa_id, competencia);
create index if not exists remuneracao_lancamento_competencia_idx
  on public.remuneracao_lancamento (competencia);

/* ------------------------------------------------------------------ */
/* A soma mensal                                                       */
/* ------------------------------------------------------------------ */

-- `security_invoker` LIGADO de propósito: sem isso a view roda com os direitos
-- de quem a criou e a RLS das tabelas de baixo não vale — o painel restrito
-- vazaria por ela.
create or replace view public.vw_remuneracao_mensal
with (security_invoker = true) as
select
  p.id                as pessoa_id,
  p.nome,
  p.codigo_rh,
  p.eh_pessoa,
  l.competencia,
  sum(l.valor) filter (where l.bloco in ('fixo','prolabore'))  as fixo,
  sum(l.valor) filter (where l.bloco = 'premiacao')            as premiacao,
  sum(l.valor) filter (where l.bloco = 'escala')               as escala,
  sum(l.valor) filter (where l.bloco = 'outro')                as outro,
  sum(l.valor)                                                 as total,
  count(*)                                                     as lancamentos,
  -- Quais fontes formaram este mês. Mais de uma é sinal de conferir.
  string_agg(distinct l.fonte, '+' order by l.fonte)           as fontes
from public.remuneracao_pessoa p
join public.remuneracao_lancamento l on l.pessoa_id = p.id
group by p.id, p.nome, p.codigo_rh, p.eh_pessoa, l.competencia;

comment on view public.vw_remuneracao_mensal is
  'Remuneração somada por pessoa e competência, já separada em fixo/premiação/escala.';

/* ------------------------------------------------------------------ */
/* RLS                                                                 */
/* ------------------------------------------------------------------ */

alter table public.remuneracao_pessoa      enable row level security;
alter table public.remuneracao_lancamento  enable row level security;

drop policy if exists "remuneracao_pessoa por cargo"     on public.remuneracao_pessoa;
drop policy if exists "remuneracao_lancamento por cargo" on public.remuneracao_lancamento;

create policy "remuneracao_pessoa por cargo" on public.remuneracao_pessoa
  for all to authenticated
  using (public.pode_ver_remuneracao())
  with check (public.pode_ver_remuneracao());

create policy "remuneracao_lancamento por cargo" on public.remuneracao_lancamento
  for all to authenticated
  using (public.pode_ver_remuneracao())
  with check (public.pode_ver_remuneracao());

-- O Postgres do Supabase concede acesso a `anon` automaticamente em tabela
-- nova. Sem este revoke, a chave publicável do frontend alcança a tabela por
-- fora da sessão — e RLS ligada com policy só para `authenticated` não impede
-- o `anon` de tentar; impede de ler, mas a superfície não deveria existir.
revoke all on public.remuneracao_pessoa     from anon;
revoke all on public.remuneracao_lancamento from anon;
revoke all on public.vw_remuneracao_mensal  from anon;

/* ------------------------------------------------------------------ */
/* O espelho do RH passa a valer a mesma regra                         */
/* ------------------------------------------------------------------ */

-- Trancar o painel novo e deixar o espelho aberto não protegeria nada: a coluna
-- `valor` da aba Colaboradores responde a mesma pergunta.
--
-- Quem lê esta tabela: o frontend só em `src/pages/operacional/ColaboradoresRH.tsx`.
-- As Edge Functions da folha (`folha-previa`, `folha-omie-enviar`,
-- `omie-folha-cadastros-sync`, `omie-colaboradores-cadastrar`) usam a service
-- role e passam por cima da RLS — nenhuma delas quebra com esta troca.
drop policy if exists "rh_colaboradores_select_authenticated" on public.rh_colaboradores;
drop policy if exists "rh_colaboradores por cargo"            on public.rh_colaboradores;

create policy "rh_colaboradores por cargo" on public.rh_colaboradores
  for select to authenticated
  using (public.pode_ver_remuneracao());

/* ------------------------------------------------------------------ */
/* atualizado_em                                                       */
/* ------------------------------------------------------------------ */

-- Mesmo motivo de `folha_touch_atualizado_em`: a `update_updated_at_column()`
-- das tabelas `lib_*` escreve em `updated_at`, e aqui a coluna é
-- `atualizado_em`. Reaproveitar a outra falharia com "record NEW has no field
-- updated_at" em toda atualização.
drop trigger if exists trg_remuneracao_pessoa_updated     on public.remuneracao_pessoa;
drop trigger if exists trg_remuneracao_lancamento_updated on public.remuneracao_lancamento;

create trigger trg_remuneracao_pessoa_updated
  before update on public.remuneracao_pessoa
  for each row execute function public.folha_touch_atualizado_em();

create trigger trg_remuneracao_lancamento_updated
  before update on public.remuneracao_lancamento
  for each row execute function public.folha_touch_atualizado_em();

/* ------------------------------------------------------------------ */
/* Semente: quem já tem ficha no RH                                    */
/* ------------------------------------------------------------------ */

-- As pessoas que só aparecem nos pagamentos entram na carga do Omie, que sabe
-- o apelido de cada favorecido. Aqui entra quem o espelho do RH conhece, para
-- que o `codigo_rh` já nasça ligado — é ele que traz cargo, setor e data de
-- início para a linha do tempo.
insert into public.remuneracao_pessoa (nome, chave, codigo_rh, doc)
select
  btrim(r.nome),
  public.contraparte_chave(btrim(r.nome)),
  r.codigo,
  nullif(regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g'), '')
from public.rh_colaboradores r
where nullif(btrim(coalesce(r.nome, '')), '') is not null
  and length(public.contraparte_chave(btrim(r.nome))) >= 4
on conflict (chave) do nothing;
