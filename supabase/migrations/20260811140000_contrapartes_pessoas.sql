-- Razão social que é, na verdade, uma pessoa.
--
-- O comentário da DRE/DFC nasce dos lançamentos do Omie, e o Omie guarda a RAZÃO
-- SOCIAL. Quando o prestador é a PJ de uma pessoa só, o texto sai dizendo "a saída
-- de DALBER NEGOCIOS (-R$ 27,2k) e C M SOLUCOES E SERVICOS LTDA (-R$ 3,0k)" onde
-- quem lê esperava "a saída do Dalber e da Carla" — e alguém corrige à mão, toda
-- vez, antes de colar no tracker.
--
-- A tabela é o de-para: uma linha por grafia que aparece no Omie. Grafias
-- diferentes do mesmo prestador ("DALBER NEGOCIOS", "DALBER NEGOCIOS LTDA")
-- podem virar duas linhas apontando para a mesma pessoa — o índice único é por
-- grafia, não por pessoa, exatamente para permitir isso.
--
-- PALIATIVO ASSUMIDO. Quando o Hub estiver ligado ao RH, a ligação entra por
-- `colaborador_id` e o `pessoa` digitado à mão passa a ser fallback. Por isso a
-- FK já existe e já é opcional: hoje ninguém preenche, amanhã ela é a fonte.
--
-- Por que tabela nova e não coluna em `lib_fornecedores`: a contraparte que chega
-- no prompt vem da RPC `demonstracoes_contrapartes` (cadastro do Omie), e nem toda
-- razão social que aparece lá tem linha na Biblioteca. O casamento aqui é por
-- NOME normalizado, não por id — é o que o texto tem para oferecer.

create table if not exists public.contrapartes_pessoas (
  id uuid primary key default gen_random_uuid(),

  -- A razão social COMO ELA VEM DO OMIE. É a chave de busca; cole daqui, não
  -- reescreva bonito.
  nome text not null,

  -- Como escrever no comentário. "Dalber", "Carla Mendes" — o nome pelo qual a
  -- pessoa é chamada no fechamento, não o nome de batismo completo.
  pessoa text not null,

  documento text,

  -- O gancho para o RH. Nulo em todas as linhas hoje, de propósito.
  colaborador_id uuid references public.lib_colaboradores(id) on delete set null,

  observacao text,
  status text not null default 'ativo',

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint contrapartes_pessoas_status_ck check (status in ('ativo', 'inativo')),
  -- Chave curta demais casaria palavra comum no meio do texto ("EI", "SA") e
  -- trocaria o nome de qualquer um. O mesmo piso existe no helper que aplica.
  constraint contrapartes_pessoas_nome_ck check (length(btrim(nome)) >= 4),
  constraint contrapartes_pessoas_pessoa_ck check (length(btrim(pessoa)) >= 2)
);

-- Uma grafia, um dono. Sem isto, dois cadastros da mesma razão social com nomes
-- diferentes fariam o mesmo comentário sair de um jeito a cada geração.
create unique index if not exists contrapartes_pessoas_nome_key
  on public.contrapartes_pessoas (upper(btrim(regexp_replace(nome, '\s+', ' ', 'g'))));

create index if not exists contrapartes_pessoas_status_idx
  on public.contrapartes_pessoas (status);

comment on table public.contrapartes_pessoas is
  'De-para razão social do Omie -> nome da pessoa, aplicado nos textos escritos por IA (DRE/DFC, assistente). Paliativo até o Hub ler o RH.';

-- `tg_set_atualizado_em` veio da onda 1 (20260808151147). Reusa.
drop trigger if exists set_atualizado_em on public.contrapartes_pessoas;
create trigger set_atualizado_em
  before update on public.contrapartes_pessoas
  for each row execute function public.tg_set_atualizado_em();

alter table public.contrapartes_pessoas enable row level security;

drop policy if exists "auth all contrapartes_pessoas" on public.contrapartes_pessoas;
create policy "auth all contrapartes_pessoas"
  on public.contrapartes_pessoas
  for all
  to authenticated
  using (true)
  with check (true);
