-- O cadastro de CNPJ lido de página pública, guardado.
--
-- POR QUE UM CACHE, e não simplesmente consultar quando precisar. A fila de
-- cadastro é RETOMÁVEL de propósito: ela para no relógio, marca o cliente como
-- pendente e volta na janela seguinte. Isso significa que o mesmo CNPJ difícil
-- reaparece na cabeça da fila várias vezes — a fila é ordenada por valor, e quem
-- falha é justamente o maior. Sem cache, cada reaparição custaria de novo o
-- crédito de raspagem para reler uma ficha que não mudou.
--
-- E ELA NÃO MUDA COM FREQUÊNCIA: razão social, endereço e situação cadastral de
-- uma empresa mudam de mês em mês, não de hora em hora. A validade de 60 dias
-- mora no código que lê (`_shared/cnpj-publico.ts`), junto com a decisão de
-- reler — aqui fica só o que foi lido e quando.
--
-- `dados` é o objeto inteiro como veio, e não colunas separadas, porque este é
-- um cache de leitura de terceiro: no dia em que a página passar a publicar mais
-- um campo, ele entra sem migração. Quem consome já valida o que precisa.

create table if not exists public.cnpj_publico_cache (
  doc      text primary key,
  dados    jsonb       not null,
  -- O host de onde veio ("cnpj.biz"). Se um dia uma das páginas começar a
  -- devolver lixo, é por aqui que se acha o que ela contaminou.
  fonte    text,
  lido_em  timestamptz not null default now()
);

comment on table public.cnpj_publico_cache is
  'Cadastro de CNPJ lido de página pública por raspagem, quando a BrasilAPI recusa por limite de taxa. Plano B, marcado como tal.';

alter table public.cnpj_publico_cache enable row level security;
drop policy if exists cnpj_publico_cache_leitura on public.cnpj_publico_cache;
create policy cnpj_publico_cache_leitura on public.cnpj_publico_cache
  for select to authenticated using (true);
