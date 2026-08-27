-- A nota em dólar passa a ter valor — e a casar.
--
-- ---------------------------------------------------------------------------
-- O DIAGNÓSTICO, e por que ele não começa no câmbio
--
-- HubSpot, Datadog e Campbells mandam invoice em dólar, e o corpo delas nunca
-- escreve "R$". Como `lerCorpoDeEmail` só procurava por "R$", elas entravam no
-- acervo com valor NULO. Sem valor, nenhuma regra do casador alcança: ficam
-- `sem_alvo` para sempre, com o arquivo ali do lado.
--
-- Medido em 27/08/2026: **483 notas com arquivo e sem valor**, 183 delas
-- classificadas como nota, 409 já copiadas para o bucket. O câmbio era o
-- segundo problema; o primeiro era não ler o número.
--
-- ---------------------------------------------------------------------------
-- A CALIBRAGEM, feita no par que dava para conferir
--
-- Invoice HubSpot 793472891, de 19/07/2026: **US$ 5.693,73**.
-- Título 5504196795 (fatura de 11/08/2026): **R$ 29.138,23**.
-- Fator implícito: **5,1176**.
--
-- PTAX de venda no fim de julho/2026: 5,146 a 5,195; começo de agosto: 5,072 a
-- 5,115. O fator implícito cai DENTRO dessa faixa — ou seja, o cartão converteu
-- praticamente na PTAX, sem o IOF de 3,38% aparecer embutido no lançamento.
--
-- Por isso a régua NÃO é "PTAX + 4 a 6%", que era a suposição de partida: é
-- **PTAX do dia ± 8%**, uma banda simétrica. Ela cobre o caso sem IOF (fator
-- abaixo da PTAX), o caso com IOF (3,38% acima), o spread do adquirente e a
-- diferença entre a data da invoice e a data em que o cartão fechou o câmbio —
-- que são dias diferentes e, num mês volátil, valem mais que o IOF.
--
-- A banda é LARGA de propósito, e é seguro que seja: a regra só se aplica a
-- nota que já tem CNPJ ou nome do mesmo fornecedor, e a moeda estrangeira
-- sozinha nunca casa nada. Quem estreita é a identidade, não o câmbio.
--
-- E toda nota estrangeira sai como confiança `media`: são duas aproximações
-- empilhadas (o câmbio do dia e a data do fechamento), e nenhuma delas merece
-- subir ao ERP sem alguém olhar.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA DE CÂMBIO, e não uma chamada por nota
--
-- A PTAX é pública, sem chave, e não muda para trás. Guardar é mais barato do
-- que pedir de novo, e — o que importa mais — deixa o casamento REPRODUZÍVEL:
-- recasar amanhã com a cotação de amanhã mudaria o alvo de uma nota de março
-- sem que nada no dado tivesse mudado.
--
-- Fim de semana e feriado não têm cotação. `cambio_do_dia` anda para trás até
-- 5 dias — é o que o próprio mercado faz.

create table if not exists public.cambio_dia (
  data   date not null,
  moeda  text not null check (moeda in ('USD', 'EUR')),
  venda  numeric not null check (venda > 0),
  fonte  text not null default 'ptax',
  lido_em timestamptz not null default now(),
  primary key (data, moeda)
);

comment on table public.cambio_dia is
  'PTAX de venda, cacheada. A cotação não muda para trás — guardar é o que torna o casamento em moeda estrangeira reproduzível: recasar amanhã com a cotação de amanhã moveria o alvo de uma nota de março sem nada ter mudado no dado.';

alter table public.cambio_dia enable row level security;
drop policy if exists cambio_dia_leitura on public.cambio_dia;
create policy cambio_dia_leitura on public.cambio_dia for select to authenticated using (true);

/* A cotação daquele dia, ou a do último dia útil antes dele. Fim de semana e
   feriado não têm PTAX, e a compra do sábado é convertida pela sexta. */
create or replace function public.cambio_do_dia(p_data date, p_moeda text default 'USD')
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.venda
    from public.cambio_dia c
   where c.moeda = p_moeda
     and c.data <= p_data
     and c.data >= p_data - 5
   order by c.data desc
   limit 1;
$$;

revoke all on function public.cambio_do_dia(date, text) from public, anon;
grant execute on function public.cambio_do_dia(date, text) to authenticated, service_role;

/* ============================================================================
 *  A nota guarda a moeda em que foi emitida
 * ========================================================================== */

alter table public.notas_externas add column if not exists moeda text;
alter table public.notas_externas add column if not exists valor_moeda numeric;
alter table public.notas_externas add column if not exists lido_do_arquivo_em timestamptz;
alter table public.notas_externas add column if not exists leitura_erro text;

comment on column public.notas_externas.moeda is
  'A moeda em que o documento foi emitido. `valor` fica SEMPRE em reais (convertido pela PTAX do dia), para o casador não precisar saber de câmbio; `valor_moeda` guarda o número original, que é o que se confere contra a invoice.';

comment on column public.notas_externas.lido_do_arquivo_em is
  'Quando a `nota-ler-arquivo` abriu o arquivo e extraiu valor/CNPJ. Sem este carimbo a varredura releria as mesmas 483 notas em toda rodada.';

create index if not exists notas_externas_ler_arquivo_idx
  on public.notas_externas (id)
  where tem_arquivo and valor is null and lido_do_arquivo_em is null and ignorado_em is null;

/* ============================================================================
 *  O casador tolera o câmbio — e só ele
 * ========================================================================== */

comment on column public.notas_externas.valor_moeda is
  'O valor no original. Quando existe, o `valor` em reais é uma CONVERSÃO, e o casador afrouxa a comparação para ±8% naquela linha — a banda que cobre PTAX sem IOF, PTAX com IOF (3,38%) e a diferença entre a data da invoice e a data em que o cartão fechou o câmbio.';

/* ============================================================================
 *  A varredura que abre o arquivo
 *
 *  :35 é o vão livre entre o envio (:35 é IncluirAnexo — mas esta não toca no
 *  Omie) e o casar (:00/:30). Ela lê do bucket e do BCB, não do ERP, então não
 *  disputa a fila do Omie com ninguém.
 * ========================================================================== */

insert into public.internal_cron_tokens (name, token)
values ('nota-ler-arquivo', encode(gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

select cron.unschedule('nota-ler-arquivo')
 where exists (select 1 from cron.job where jobname = 'nota-ler-arquivo');

select cron.schedule('nota-ler-arquivo', '35 * * * *', $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/nota-ler-arquivo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'nota-ler-arquivo')
    ),
    body := '{"limite":25}'::jsonb
  );
$cron$);
