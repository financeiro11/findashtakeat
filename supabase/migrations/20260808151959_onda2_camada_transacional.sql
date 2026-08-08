-- ============================================================
-- ONDA 2 - CAMADA TRANSACIONAL
-- Hub FinOps / Takeat - migration: onda2_camada_transacional
-- Pre-requisito: Onda 1 aplicada.
-- ============================================================

-- ---------- 2.1 omie_titulos: espelho do CAP e CAR ----------
create table if not exists public.omie_titulos (
  cod_titulo        bigint primary key,
  tipo              text not null check (tipo in ('pagar','receber')),
  -- contraparte
  fornecedor_id     uuid references public.lib_fornecedores(id),
  favorecido_texto  text,
  documento_norm    text,
  -- valores e datas
  valor             numeric(14,2) not null,
  valor_pago        numeric(14,2),
  data_emissao      date,
  vencimento        date,
  data_pagamento    date,
  competencia       date,
  -- classificacao
  categoria_codigo  text,
  centro_custo_id   uuid references public.lib_centros_custo(id),
  departamento_id   uuid references public.lib_departamentos(id),
  -- identificacao documental
  numero_documento  text,
  nota_fiscal       text,
  observacao        text,
  -- estado e proveniencia
  status            text check (status in ('aberto','pago','parcial','cancelado','atrasado')),
  origem_lancamento text check (origem_lancamento in ('manual','thetys','n8n','importacao')),
  sincronizado_em   timestamptz not null default now(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists omie_titulos_competencia_idx on public.omie_titulos (competencia);
create index if not exists omie_titulos_vencimento_idx  on public.omie_titulos (vencimento);
create index if not exists omie_titulos_fornecedor_idx  on public.omie_titulos (fornecedor_id);
create index if not exists omie_titulos_documento_idx   on public.omie_titulos (documento_norm);
create index if not exists omie_titulos_status_idx      on public.omie_titulos (status);
create index if not exists omie_titulos_tipo_comp_idx   on public.omie_titulos (tipo, competencia);

comment on table public.omie_titulos is
  'Espelho dos titulos do Omie (CAP e CAR) no Hub. Sincronizado via n8n. Fonte da conciliacao.';
comment on column public.omie_titulos.documento_norm is
  'CNPJ/CPF somente digitos, para cruzar com lib_fornecedores e com os extratos.';
comment on column public.omie_titulos.origem_lancamento is
  'Quem criou o titulo. Permite medir quantos lancamentos a Thetys fez e auditar separadamente.';
comment on column public.omie_titulos.cod_titulo is
  'ATENCAO: bigint. omie_reclassificacoes.cod_titulo e text - qualquer join entre as duas exige cast.';

alter table public.omie_titulos enable row level security;
drop policy if exists "auth read omie_titulos" on public.omie_titulos;
create policy "auth read omie_titulos" on public.omie_titulos
  for select to authenticated using (true);
drop policy if exists "auth write omie_titulos" on public.omie_titulos;
create policy "auth write omie_titulos" on public.omie_titulos
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_omie_titulos_upd on public.omie_titulos;
create trigger trg_omie_titulos_upd before update on public.omie_titulos
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 2.2 conciliacao ----------
create table if not exists public.conciliacao (
  id                uuid primary key default gen_random_uuid(),
  -- lado do banco
  origem            text not null check (origem in ('sicoob','asaas','cartao')),
  extrato_id        text not null,
  data_movimento    date,
  valor_extrato     numeric(14,2),
  -- lado do ERP
  cod_titulo        bigint references public.omie_titulos(cod_titulo),
  valor_titulo      numeric(14,2),
  -- lado documental
  comprovante_file_id text,
  -- resultado da decisao
  metodo            text not null check (metodo in
                      ('exato','parcial','agrupado','manual','sem_match')),
  confianca         numeric(5,4) not null default 0
                      check (confianca >= 0 and confianca <= 1),
  alcada            text not null default 'amarelo'
                      check (alcada in ('verde','amarelo','vermelho')),
  status            text not null default 'pendente'
                      check (status in ('pendente','conciliado','divergente','descartado')),
  divergencia_valor numeric(14,2) generated always as
                      (coalesce(valor_extrato,0) - coalesce(valor_titulo,0)) stored,
  -- trilha: quem fez e quem revisou (segunda linha de controle)
  conciliado_por    text not null default 'thetys'
                      check (conciliado_por in ('thetys','humano','n8n')),
  conciliado_em     timestamptz,
  revisado_por      uuid references public.lib_colaboradores(id),
  revisado_em       timestamptz,
  observacao        text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- Um extrato pode quitar varios titulos (pagamento agrupado).
-- NULLS NOT DISTINCT evita duplicar linhas sem titulo vinculado.
create unique index if not exists conciliacao_extrato_titulo_uidx
  on public.conciliacao (origem, extrato_id, cod_titulo) nulls not distinct;

create index if not exists conciliacao_status_idx  on public.conciliacao (status);
create index if not exists conciliacao_alcada_idx  on public.conciliacao (alcada);
create index if not exists conciliacao_data_idx    on public.conciliacao (data_movimento);
create index if not exists conciliacao_titulo_idx  on public.conciliacao (cod_titulo);
create index if not exists conciliacao_pendente_idx
  on public.conciliacao (criado_em) where status = 'pendente';

comment on table public.conciliacao is
  'Materializa a conciliacao extrato x titulo x comprovante. Uma linha por par extrato-titulo.';
comment on column public.conciliacao.revisado_por is
  'Segunda linha de controle. Nulo enquanto nao revisado. Transforma o controle da Julia em dado, nao em combinado.';
comment on column public.conciliacao.alcada is
  'verde = executado pela Thetys sem revisao previa. amarelo = precisa de liberacao humana.';

alter table public.conciliacao enable row level security;
drop policy if exists "auth all conciliacao" on public.conciliacao;
create policy "auth all conciliacao" on public.conciliacao
  for all to authenticated using (true) with check (true);

drop trigger if exists trg_conciliacao_upd on public.conciliacao;
create trigger trg_conciliacao_upd before update on public.conciliacao
  for each row execute function public.tg_set_atualizado_em();


-- ---------- 2.3 comprovantes_index: amarracao vira FK ----------
alter table public.comprovantes_index
  add column if not exists cod_titulo       bigint references public.omie_titulos(cod_titulo),
  add column if not exists fornecedor_id    uuid references public.lib_fornecedores(id),
  add column if not exists confianca_match  numeric(5,4)
                                            check (confianca_match >= 0 and confianca_match <= 1),
  add column if not exists metodo_match     text check (metodo_match in
                                            ('chave_nfe','valor_data','cnpj_valor','ocr','manual'));

create index if not exists comprovantes_index_titulo_idx on public.comprovantes_index (cod_titulo);
create index if not exists comprovantes_index_forn_idx   on public.comprovantes_index (fornecedor_id);

comment on column public.comprovantes_index.lancamento_id is
  'DEPRECIADO. Substituido por cod_titulo (FK). Manter populado ate confirmar que nenhum fluxo n8n le esta coluna.';
comment on column public.comprovantes_index.referencia_casada is
  'DEPRECIADO. Substituido por cod_titulo + metodo_match.';;
