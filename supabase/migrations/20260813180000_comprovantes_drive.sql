-- Comprovantes do Drive: o que cada lançamento foi, por lançamento.
--
-- Duas pastas do Drive respondem o que a linha da DRE realmente foi:
--   • Mercado Livre — a NF-e de cada pedido, em PDF de TEXTO. 37 arquivos.
--   • WhatsApp — foto/scan do recibo que a galera manda no grupo. 107 arquivos.
--
-- ISTO NÃO É A PARAMETRIZAÇÃO. Lá se nomeia a CONTRAPARTE; aqui os 166
-- lançamentos de "MERCADO LIVRE" são 166 produtos diferentes, e o que responde
-- é cada LINHA dizer o que foi comprado. Por isso a chave é o lançamento.
--
-- O CASAMENTO TEM TRÊS TENTATIVAS, e cada uma nasceu de um caso real:
--   1. valor da nota + data ....... "PURE WATER R$ 45,60 (28/07)" casou com
--      "MERCADO LIVRE 28/07 R$ 45,60".
--   2. SOMA das notas do arquivo .. um pedido com dois vendedores gera dois
--      DANFEs no mesmo PDF e UMA cobrança: "MERCADOLIVRE*MERCADO 24/07
--      R$ 161,50" é 135,50 (Multimix) + 26,00 (Depósito dos Copos).
--   3. valor / parcelas ........... o memo traz "01/06"; a nota tem o total e a
--      fatura tem a parcela — a mesma lição da planilha de Compras.
--
-- E o memo do OFX ainda confere de graça: "MERCADOLIVRE*PUREWAT" bate com o
-- emitente "PURE WATER". É uma segunda chave, independente do valor, que
-- desempata dois pedidos de mesmo total.

-- ---------------------------------------------------------------------------
-- 1. Onde mora a chave da Drive API
-- ---------------------------------------------------------------------------
-- Mesmo desenho do `internal_cron_tokens`: RLS ligado e NENHUMA política, então
-- só o service_role enxerga — nem o `authenticated` do front alcança. Existe
-- porque o segredo de ambiente do Supabase não se escreve por aqui; a função
-- prefere `Deno.env` quando ele existir, e esta tabela é o segundo lugar.

create table if not exists public.internal_secrets (
  nome      text primary key,
  valor     text not null,
  observacao text,
  criado_em timestamptz not null default now()
);

alter table public.internal_secrets enable row level security;
revoke all on public.internal_secrets from anon, authenticated;
grant select on public.internal_secrets to service_role;

comment on table public.internal_secrets is
  'Segredos lidos por Edge Function. RLS ligado SEM política de propósito: só service_role lê. Env var tem precedência.';

-- ---------------------------------------------------------------------------
-- 2. O comprovante
-- ---------------------------------------------------------------------------

create table if not exists public.comprovantes_drive (
  id uuid primary key default gen_random_uuid(),

  -- o arquivo lá
  drive_id   text not null unique,
  pasta      text not null,              -- mercado_livre | whatsapp
  mes        text,                       -- "07. julho", como está no Drive
  nome_arquivo text not null,
  mime       text,
  -- guarda o carimbo do Drive para reprocessar SÓ o que mudou: são 144 arquivos
  -- hoje e cada foto custa uma chamada de OCR.
  drive_modificado_em timestamptz,

  -- o que foi lido do documento
  lido_como  text,                       -- danfe | ocr | nome_arquivo
  emitente   text,                       -- quem vendeu de verdade
  cnpj_norm  text,
  data       date,
  valor      numeric,
  descricao  text,                       -- o que foi comprado, em uma linha
  itens      jsonb,
  notas      int not null default 0,     -- quantas DANFEs vieram no arquivo
  lido_em    timestamptz,
  erro       text,

  -- o casamento com o lançamento
  casamento  text,                       -- valor_data | soma_pedido | parcela
  confianca  text,                       -- alta | media
  cartao_data date,
  cartao_valor numeric,
  cartao_estabelecimento text,
  cartao_descricao text,                 -- o memo do OFX, que confere o emitente
  -- o título do Omie, resolvido pelo memo. É por ele que o drill-down acha o
  -- comprovante: a linha da DRE já tem `cod_titulo` na mão.
  cod_titulo text,
  candidatos jsonb,                      -- quando mais de um lançamento serve
  casado_em  timestamptz,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint comprovantes_drive_pasta_ck check (pasta in ('mercado_livre', 'whatsapp')),
  constraint comprovantes_drive_lido_ck  check (lido_como is null or lido_como in ('danfe', 'ocr', 'nome_arquivo')),
  constraint comprovantes_drive_casamento_ck check (casamento is null or casamento in ('valor_data', 'soma_pedido', 'parcela')),
  constraint comprovantes_drive_confianca_ck check (confianca is null or confianca in ('alta', 'media'))
);

-- O drill-down busca por aqui, uma vez por célula aberta.
create index if not exists comprovantes_drive_cod_titulo_idx
  on public.comprovantes_drive (cod_titulo) where cod_titulo is not null;

-- O casamento varre por valor+data.
create index if not exists comprovantes_drive_valor_data_idx
  on public.comprovantes_drive (valor, data);

create index if not exists comprovantes_drive_pendentes_idx
  on public.comprovantes_drive (pasta) where cod_titulo is null;

comment on table public.comprovantes_drive is
  'Comprovante do Drive lido e casado com um lançamento. O drill-down da DRE/DFC lê por cod_titulo.';
comment on column public.comprovantes_drive.emitente is
  'O vendedor de verdade (PURE WATER), não a fachada do marketplace (MERCADO LIVRE).';
comment on column public.comprovantes_drive.candidatos is
  'Quando dois lançamentos servem, os dois ficam aqui e NADA é casado: chutar aqui cola o comprovante na linha errada.';

alter table public.comprovantes_drive enable row level security;

drop policy if exists "auth le comprovantes_drive" on public.comprovantes_drive;
create policy "auth le comprovantes_drive"
  on public.comprovantes_drive for select
  to authenticated using (true);

revoke all on public.comprovantes_drive from anon;
grant select on public.comprovantes_drive to authenticated;
grant select, insert, update, delete on public.comprovantes_drive to service_role;
