-- O rastro de quem mexeu no cadastro do cliente, e em qual sistema.
--
-- A ação `corrigir_cadastro` da `omie-clientes-criar` escreve endereço em cadastro
-- que NÃO nasceu no Hub — no Omie e, opcionalmente, no Asaas na mesma chamada. Foi
-- decisão tomada com o custo à vista (15 emissões mortas em 26/08/26 por "falta
-- preencher o Número do Endereço"), e escrita assim precisa de rastro: três meses
-- depois, "por que o endereço deste cliente mudou?" tem de ter resposta, e a
-- resposta tem de dizer o que estava lá antes, de onde veio o novo e qual cobrança
-- isso destravou.
--
-- Append-only, como o diário de emissões: correção que deu errado não se apaga.

create table if not exists public.nf_cadastro_correcoes (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  doc           text not null,
  nome          text,
  -- Os dois lados da ponte, para achar o cadastro em cada sistema depois.
  n_cod_cli     bigint,
  id_customer   text,
  -- ["omie"], ["asaas"] ou os dois: o que se pediu para escrever.
  alvos         text[] not null,
  -- "receita" | "cep" | "asaas" — de onde veio o endereço proposto. É o que
  -- distingue "a Receita disse" de "copiamos o que já estava no Asaas".
  fonte         text,
  proposta      jsonb,
  -- O que cada sistema respondeu, por alvo: { omie: {ok, escrito}, asaas: {...} }.
  -- Guardar o `escrito` é o ponto — a proposta é o que se quis, o escrito é o que foi.
  resultado     jsonb,
  ids_cobranca  text[],
  operador      text
);

create index if not exists nf_cadastro_correcoes_doc_idx
  on public.nf_cadastro_correcoes (doc, criado_em desc);

alter table public.nf_cadastro_correcoes enable row level security;

-- Leitura para quem está logado; a escrita é da Edge Function, que usa a service
-- role e não passa por policy. Sem o `revoke`, a função nasceria chamável por
-- anon — ver a migration de grants do repo.
create policy nf_cadastro_correcoes_leitura
  on public.nf_cadastro_correcoes for select
  to authenticated using (true);

revoke all on public.nf_cadastro_correcoes from anon;
