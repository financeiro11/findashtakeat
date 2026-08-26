-- Provisionamento da folha no Omie: o de-para das pessoas e o registro dos envios.
--
-- Duas tabelas, dois papéis distintos:
--
--   folha_depara       quem é de qual departamento e categoria. É o que a
--                      planilha manual carregava na cabeça de quem preenchia.
--   folha_envios_omie  o que já foi enviado, por competência. É a trava que
--                      impede provisionar o mesmo mês duas vezes.
--
-- POR QUE O DE-PARA É POR PESSOA, e não por setor: o campo `setor` do espelho
-- do RH é texto livre — a mesma área aparece como "Marketing" numa linha e
-- "Branding" noutra. O departamento padronizado é o da folha, e a tradução
-- setor → departamento é 1→muitos ("Marketing" se divide entre Branding e
-- Conteúdo, Comunidade e Performance). Não há regra que decida pelo nome.

/* ------------------------------------------------------------------ */
/* De-para                                                             */
/* ------------------------------------------------------------------ */

create table if not exists public.folha_depara (
  -- `codigo` do espelho do RH ("COL-003057"): único nas 112 linhas e nunca
  -- vazio. NÃO usar CNPJ como chave — quatro pessoas ativas dividem o
  -- 37.511.891/0001-50, e a chave colidiria.
  codigo_rh           text primary key,
  nome                text not null,

  -- Departamento padronizado, o nome da folha. Casa com o cadastro do Omie
  -- por descrição; o código (`cCodDep`) sai do cache `folha_cadastros`.
  departamento        text,

  -- Descrição da categoria como aparece na folha
  -- ("3.1.1.4. Pessoal - Tecnologia"). O `codigo_categoria` do Omie é OUTRA
  -- numeração ("2.03.13") e sai do mesmo cache — nunca deduzir uma da outra.
  categoria_descricao text,

  -- De onde veio esta linha:
  --   'planilha' folha de julho/2026, casada por CNPJ ou nome
  --   'regra'    deduzida do setor do RH, quando a relação é 1:1
  --   'ia'       sugerida pelo modelo, ainda não confirmada por gente
  --   'manual'   preenchida ou confirmada por uma pessoa
  origem            text not null default 'manual'
                    check (origem in ('planilha','regra','ia','manual')),

  -- Sugestão de IA só vira verdade depois que alguém confirma. Enquanto isto
  -- for nulo com origem 'ia', a prévia mostra a linha marcada.
  confirmado_em     timestamptz,
  confirmado_por    uuid references auth.users(id) on delete set null,

  -- Por que a IA escolheu — fica para quem confere entender a sugestão.
  justificativa_ia  text,

  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.folha_depara is
  'Departamento e categoria de cada colaborador, para o provisionamento da folha no Omie.';

create index if not exists folha_depara_departamento_idx
  on public.folha_depara (departamento);

/* ------------------------------------------------------------------ */
/* Registro dos envios                                                 */
/* ------------------------------------------------------------------ */

create table if not exists public.folha_envios_omie (
  -- Primeiro dia da competência (o mês TRABALHADO). Folha de agosto/2026 =
  -- '2026-08-01', registra 31/08 e vence 05/09.
  competencia   date primary key,

  estado        text not null default 'pendente'
                check (estado in ('pendente','fora_do_hub','enviado')),

  -- Quantos títulos e quanto dinheiro — para conferir contra o Omie depois.
  titulos       integer not null default 0,
  valor_total   numeric(14,2) not null default 0,

  enviado_em    timestamptz,
  enviado_por   uuid references auth.users(id) on delete set null,

  -- Resposta crua do Omie, lote a lote. Guardada inteira de propósito: quando
  -- um título é recusado, a mensagem é a única pista do motivo.
  resposta      jsonb,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.folha_envios_omie is
  'Uma linha por competência de folha. Impede provisionar o mesmo mês duas vezes.';

/* ------------------------------------------------------------------ */
/* O marco                                                             */
/* ------------------------------------------------------------------ */

-- Até julho/2026 a folha foi lançada no Omie à mão, fora do Hub. Marcar as
-- competências passadas como 'fora_do_hub' faz a trava valer no BANCO, e não
-- só no código — reprovisionar um mês já pago duplica cem títulos de uma vez.
insert into public.folha_envios_omie (competencia, estado)
select d::date, 'fora_do_hub'
from generate_series(date '2026-01-01', date '2026-07-01', interval '1 month') d
on conflict (competencia) do nothing;

/* ------------------------------------------------------------------ */
/* RLS                                                                 */
/* ------------------------------------------------------------------ */

alter table public.folha_depara      enable row level security;
alter table public.folha_envios_omie enable row level security;

-- Mesmo padrão das outras tabelas internas do Hub: quem está logado enxerga.
-- O cargo 'parcerias' é barrado no AppLayout e nas Edge Functions.
create policy "auth all folha_depara" on public.folha_depara
  for all to authenticated using (true) with check (true);

create policy "auth all folha_envios_omie" on public.folha_envios_omie
  for all to authenticated using (true) with check (true);

/* ------------------------------------------------------------------ */
/* atualizado_em                                                       */
/* ------------------------------------------------------------------ */

-- Função própria: a `update_updated_at_column()` que as tabelas `lib_*` usam
-- escreve em `updated_at`, e aqui a coluna é `atualizado_em` — como em
-- `omie_cache`. Reaproveitar a outra falharia em toda atualização com
-- "record NEW has no field updated_at".
create or replace function public.folha_touch_atualizado_em()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

create trigger trg_folha_depara_updated
  before update on public.folha_depara
  for each row execute function public.folha_touch_atualizado_em();

create trigger trg_folha_envios_updated
  before update on public.folha_envios_omie
  for each row execute function public.folha_touch_atualizado_em();
