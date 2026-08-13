-- Parametrização, parte 4: o apelido vem das planilhas, não do palpite.
--
-- As quatro planilhas de formulário (Compras, Reembolsos, NFs Colaboradores,
-- NFs Eventos & Parcerias) guardam TESTEMUNHO de quem gastou: o site onde
-- comprou, a justificativa escrita à mão, o CNPJ do prestador. Isso é uma fonte
-- melhor do que qualquer modelo adivinhando a partir de "KAZEMHAMMOUD".
--
-- MEDIDO ANTES DE ESCREVER (13/08/2026), contra as 692 contrapartes da fila:
--   • CNPJ (Reembolsos + Eventos) .......... 66 das 359 do Omie
--   • valor da PARCELA + data (Compras) .... 48 lojistas do cartão
--   • nome do site (Compras) ............... 14, e todos já óbvios
-- Casar pelo valor TOTAL rendia só 31: a fatura mostra a parcela, e o formulário
-- pergunta as duas coisas. É a parcela que casa.
--
-- POR QUE UMA TABELA DE EVIDÊNCIA, e não gravar o apelido direto:
--   1. Confiança é diferente por chave. CNPJ é identidade e entra sozinho;
--      valor+data é casamento e vira proposta de um clique. Sem guardar COMO se
--      chegou ao nome, não dá para tratar os dois diferente.
--   2. O sync roda de novo toda semana. Guardando a evidência à parte, reprocessar
--      nunca pisa no apelido que alguém escreveu à mão — `lib_fornecedores.apelido`
--      só é tocado quando ainda está vazio.
--   3. `detalhe` guarda a frase crua da planilha. Quem lê "Café dos eventos" na
--      DRE consegue ver que ela veio de "Copo de café personalizado para evento
--      HFN (1000 unidades)", escrito por alguém, com data e autor.

create table if not exists public.parametrizacao_evidencias (
  id uuid primary key default gen_random_uuid(),

  -- de onde veio: compras | reembolsos | nfs_colaboradores | eventos
  fonte text not null,

  -- a contraparte alcançada, na mesma língua da fila
  contraparte_origem text not null,          -- omie | cartao
  contraparte_nome   text not null,
  chave              text not null,          -- contraparte_nome normalizada; é a identidade da linha
  documento_norm     text,

  -- como se chegou nela
  chave_tipo text not null,                  -- cnpj | valor_data | nome
  confianca  text not null,                  -- alta | media | baixa

  -- o que a planilha diz
  apelido text,
  o_que_e text,
  detalhe text,                              -- a frase crua, para conferir a origem
  ocorrencias int not null default 1,        -- quantas linhas da planilha sustentam isto

  -- carimbo de quando virou apelido de verdade (só o de confiança alta)
  aplicado_em  timestamptz,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint parametrizacao_evidencias_fonte_ck
    check (fonte in ('compras', 'reembolsos', 'nfs_colaboradores', 'eventos')),
  constraint parametrizacao_evidencias_chave_tipo_ck
    check (chave_tipo in ('cnpj', 'valor_data', 'nome')),
  constraint parametrizacao_evidencias_confianca_ck
    check (confianca in ('alta', 'media', 'baixa'))
);

-- Uma linha por (planilha, contraparte): o sync AGREGA antes de gravar. Sem isto
-- a Latam teria 20 evidências e a tela teria de somar na hora, toda vez.
create unique index if not exists parametrizacao_evidencias_fonte_chave_idx
  on public.parametrizacao_evidencias (fonte, chave);

-- A tela lê por contraparte para montar a coluna "Sugestão".
create index if not exists parametrizacao_evidencias_chave_idx
  on public.parametrizacao_evidencias (chave);

create index if not exists parametrizacao_evidencias_doc_idx
  on public.parametrizacao_evidencias (documento_norm)
  where documento_norm is not null;

comment on table public.parametrizacao_evidencias is
  'O que cada planilha de formulário diz sobre cada contraparte. Insumo da coluna Sugestão da Parametrização; só a evidência por CNPJ vira apelido sozinha.';
comment on column public.parametrizacao_evidencias.detalhe is
  'A frase crua escrita por quem gastou. É o que permite conferir de onde saiu o apelido.';
comment on column public.parametrizacao_evidencias.aplicado_em is
  'Quando esta evidência virou lib_fornecedores.apelido. Nulo = ainda é só proposta.';

alter table public.parametrizacao_evidencias enable row level security;

drop policy if exists "auth all parametrizacao_evidencias" on public.parametrizacao_evidencias;
create policy "auth all parametrizacao_evidencias"
  on public.parametrizacao_evidencias for all
  to authenticated using (true) with check (true);

revoke all on public.parametrizacao_evidencias from anon;
grant select, insert, update, delete on public.parametrizacao_evidencias to authenticated, service_role;
