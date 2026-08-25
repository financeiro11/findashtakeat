-- Parametrização v3: a Base precisa dizer QUEM nomeou, QUANDO, e o que ficou
-- marcado para reler. `atualizado_em` não serve para "quando": qualquer sync do
-- Omie mexe nele, e a coluna "Quem nomeou" passaria a mentir no dia seguinte.

alter table public.lib_fornecedores
  add column if not exists apelido_por uuid references auth.users(id) on delete set null,
  add column if not exists apelido_em timestamptz,
  add column if not exists revisar boolean not null default false;

comment on column public.lib_fornecedores.apelido_por is
  'Quem deu o nome interno. Só a Parametrização escreve aqui.';
comment on column public.lib_fornecedores.apelido_em is
  'Quando o nome interno foi dado. Separado de atualizado_em, que o sync do Omie mexe.';
comment on column public.lib_fornecedores.revisar is
  'Marcado na Base para reler depois — o nome está lá, mas alguém duvidou dele.';

-- Quem já tem apelido ganha a data que existia; a autoria só passa a existir de
-- agora em diante e fica nula no que veio antes (a tela escreve "—").
update public.lib_fornecedores
   set apelido_em = coalesce(apelido_em, atualizado_em)
 where apelido is not null and btrim(apelido) <> '';

create index if not exists lib_fornecedores_revisar_idx
  on public.lib_fornecedores (revisar) where revisar;
