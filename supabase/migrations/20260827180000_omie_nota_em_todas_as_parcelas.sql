-- A nota da compra parcelada passa a valer para TODAS as parcelas.
--
-- O QUE ESTAVA ERRADO. A nota vai ao ERP anexada a UM título. Quando a compra
-- foi parcelada, o Omie criou N títulos e o documento ficava só no que casou.
-- Quem abrisse a parcela 5/8 não encontrava nada, e o contador cobrava uma nota
-- que já existia no sistema. Medido em 27/08/2026: dos 254 títulos com nota
-- anexada pelo Hub, **167 são parcelados** — cada um com irmãs sem documento.
--
-- POR QUE PRECISA DE TABELA. O Omie não diz quem são as irmãs: `numero_documento`
-- está vazio em 100% dos 1.102 títulos parcelados, e `numero_pedido` também. O
-- agrupamento é reconstruído (ver `_shared/parcelas.ts`) e, quando fica
-- ambíguo, alguém precisa confirmar. Decisão de gente se guarda.
--
-- DOIS CAMINHOS, e o de cima é o que o futuro usa:
--   `cartao`      o título nasceu no Hub e traz `CARTAO-<fitid>-NN`; o fitid é o
--                 mesmo nas parcelas da compra. Chave nossa, casamento exato.
--   `evidencia`   lançamento manual antigo: mesmo fornecedor, mesmo denominador,
--                 mesmo valor exato, vencimentos de mês em mês.

create table if not exists public.omie_parcela_anexo (
  id                bigserial primary key,
  -- A parcela que JÁ tem a nota — a origem do documento.
  cod_titulo_origem bigint not null,
  -- A irmã que deve receber a mesma nota.
  cod_titulo        bigint not null,
  -- "004/008", como o Omie escreve.
  parcela           text,
  origem            text not null,          -- cartao | evidencia
  confianca         text not null,          -- exata | alta | ambigua
  motivo            text not null,
  -- proposto → confirmado → anexado. `recusado` guarda o "não é a mesma compra",
  -- que é informação: impede a varredura de propor de novo amanhã.
  status            text not null default 'proposto',
  erro              text,
  decidido_por      text,
  decidido_em       timestamptz,
  anexado_em        timestamptz,
  created_at        timestamptz not null default now(),
  -- Uma proposta por par. Reexecutar a varredura não duplica a fila.
  unique (cod_titulo_origem, cod_titulo)
);

create index if not exists idx_parcela_anexo_status
  on public.omie_parcela_anexo (status, created_at);
create index if not exists idx_parcela_anexo_titulo
  on public.omie_parcela_anexo (cod_titulo);

alter table public.omie_parcela_anexo enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='omie_parcela_anexo' and policyname='omie_parcela_anexo_all') then
    create policy omie_parcela_anexo_all on public.omie_parcela_anexo
      for all to authenticated using (true) with check (true);
  end if;
end $$;

comment on table public.omie_parcela_anexo is
  'Fila e histórico de "a mesma nota também vale para esta parcela". `ambigua` NÃO sobe sozinha: duas compras iguais do mesmo fornecedor no mesmo plano fazem o número da parcela repetir, e anexar a nota errada no ERP é pior que não anexar.';
comment on column public.omie_parcela_anexo.confianca is
  'exata = chave do cartão gravada pelo Hub (CARTAO-<fitid>); alta = fornecedor+denominador+valor exato+passo mensal; ambigua = precisa de gente.';
