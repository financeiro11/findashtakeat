-- O NÚMERO DA FILA SAI DO CAMINHO DA TELA.
--
-- `notas_fiscais_fila_resumo()` existia para a tela mostrar "N cobranças na fila"
-- sem trazer as N linhas. Ela resolvia isso chamando
-- `notas_fiscais_fila_emissao(100000)` e contando — barato enquanto a janela era
-- de um mês (~2.500 cobranças).
--
-- Em 01/09/2026 o `data_corte` voltou para 01/01/2026 para emitir o atrasado do
-- ano. A janela passou de ~2.500 para **20.560 cobranças**, e cada uma atravessa
-- quatro `not exists` correlacionados. Resultado medido: a fila com limite 20
-- foi de ~1s para 8,5s (5,2s depois do índice novo), e o resumo SEM limite passou
-- a estourar o `statement_timeout`. O papel `authenticated` corta em 8s — ou
-- seja, **a aba Notas Fiscais quebraria para quem está logado**, enquanto o cron
-- (service_role, sem timeout) seguiria emitindo sem ninguém notar.
--
-- O CONSERTO NÃO É ACELERAR A CONTA, É TIRÁ-LA DO CLIQUE. Um contador de fila
-- não precisa ser exato ao segundo: precisa estar certo o bastante para a pessoa
-- decidir se aperta o botão. O cron calcula (sem limite de tempo) e guarda; a
-- tela lê uma linha. É o mesmo desenho do cache de observação do cartão.
--
-- O que se perde, dito por inteiro: o número pode estar até 15 minutos velho, e
-- logo depois de uma rodada ele mostra a fila de antes dela. `calculado_em` vai
-- junto para a tela poder dizer de quando é.

create table if not exists public.nf_fila_resumo_cache (
  id           smallint primary key default 1 check (id = 1),
  cobrancas    integer not null default 0,
  valor        numeric not null default 0,
  calculado_em timestamptz not null default now()
);

insert into public.nf_fila_resumo_cache (id) values (1) on conflict (id) do nothing;

alter table public.nf_fila_resumo_cache enable row level security;

drop policy if exists "nf_fila_resumo_cache_leitura" on public.nf_fila_resumo_cache;
create policy "nf_fila_resumo_cache_leitura"
  on public.nf_fila_resumo_cache for select to authenticated using (true);

revoke all on public.nf_fila_resumo_cache from anon;

-- Quem faz a conta cara. Roda pelo cron (dono `postgres`, sem statement_timeout),
-- nunca no clique de ninguém.
create or replace function public.nfse_fila_resumo_recalcular()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.nf_fila_resumo_cache c
  set cobrancas = t.n, valor = t.v, calculado_em = now()
  from (
    select count(*)::integer as n, coalesce(sum(f.valor), 0) as v
    from public.notas_fiscais_fila_emissao(100000) f
  ) t
  where c.id = 1;
$function$;

comment on function public.nfse_fila_resumo_recalcular() is
  'Recalcula o contador da fila e guarda em nf_fila_resumo_cache. Cara: roda no cron, nunca na tela.';

-- A tela lê UMA linha. `calculado_em` viaja junto para ela poder dizer a idade do
-- número em vez de fingir que ele é de agora. A coluna nova exige DROP (mudança
-- de tipo de retorno); é acréscimo, então quem já lia `cobrancas`/`valor` segue
-- lendo igual.
drop function if exists public.notas_fiscais_fila_resumo();

create function public.notas_fiscais_fila_resumo()
returns table(cobrancas integer, valor numeric, calculado_em timestamptz)
language sql
stable
set search_path to 'public'
as $function$
  select c.cobrancas, c.valor, c.calculado_em
  from public.nf_fila_resumo_cache c where c.id = 1;
$function$;

-- A cada 15 min, deslocado dos :00/:05 da emissão e do espelho.
select cron.schedule(
  'nf-fila-resumo-recalcular',
  '7,22,37,52 * * * *',
  $cron$ select public.nfse_fila_resumo_recalcular(); $cron$
);

-- A CARGA INICIAL NÃO MORA AQUI, e a tentativa de pô-la aqui é o que provou o
-- ponto: rodar a conta dentro da migration estourou o statement_timeout da
-- sessão e derrubou a migration INTEIRA por atomicidade. Ela é cara por
-- definição — o lugar dela é o cron, que roda como `postgres` e não tem
-- timeout. Até a primeira passada (no máximo 15 min), a tela mostra 0 com
-- `calculado_em` antigo, e é por isso que `calculado_em` é devolvido.
