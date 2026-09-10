/* ============================================================================
 * O espelho do Asaas no Omie vira LINHA A LINHA.
 *
 * 10/09/2026, Alessandra Azevedo (contabilidade Hult): "os lançamentos no Omie
 * devem ser um espelho do Asaas... todas as movimentações lançadas no Asaas
 * também devem constar no Omie, com os mesmos valores e informações, evitando
 * divergências entre os sistemas."
 *
 * O resumo diário (46.240 linhas viram 784 lançamentos) deixa de bastar. Cada
 * linha do extrato passa a ser um lançamento, com `cCodIntLanc` = o próprio
 * `id_transacao` do Asaas.
 *
 * A VIRADA É DIA A DIA, e isso é o ponto: para cada dia entram TODAS as linhas
 * dele e só então saem os 5–6 lançamentos diários daquele mesmo dia. Fazer o
 * contrário — apagar tudo e recarregar, ou carregar tudo e depois apagar —
 * deixaria a conta zerada ou dobrada pelas ~26 horas que o backfill leva. Dia a
 * dia, o pior estado possível é UM dia dobrado, e ele se resolve na rodada
 * seguinte.
 *
 * O que NÃO muda: a contrapartida na "ASAAS Pago" segue DIÁRIA. Ela não é
 * movimentação do Asaas — é a perna interna que impede aquela conta de virar
 * poço — e além disso a "ASAAS Pago" precisa continuar dentro do cache de
 * movimentos, porque é lá que mora o consolidado que é receita da DRE.
 * ========================================================================== */

/* 'diario'  = o lançamento-resumo (chave 'ASAAS-<dia>-<sigla>')
   'linha'   = uma linha do extrato (chave = id_transacao do Asaas) */
alter table public.asaas_omie_lancamento
  add column if not exists modo text not null default 'diario';

do $$
begin
  alter table public.asaas_omie_lancamento
    add constraint asaas_omie_lancamento_modo_chk check (modo in ('diario', 'linha'));
exception when duplicate_object then null;
end $$;

/* 'removido' = o lançamento diário que saiu do Omie porque as linhas daquele dia
   entraram. Fica na tabela, e não é apagado, porque é o registro de que aquele
   dia foi virado — e de que o `nCodLanc` que está ali já não existe no ERP. */
alter table public.asaas_omie_lancamento
  drop constraint if exists asaas_omie_lancamento_status_check;

do $$
begin
  alter table public.asaas_omie_lancamento
    add constraint asaas_omie_lancamento_status_chk2
    check (status in ('pendente', 'enviado', 'erro', 'removido'));
exception when duplicate_object then null;
end $$;

create index if not exists asaas_omie_lancamento_modo_idx
  on public.asaas_omie_lancamento (modo, dia, status);


/* ============================================================
 *  Em que pé está a virada, dia a dia
 * ============================================================
 * Responde as duas perguntas do backfill numa consulta só: quantas linhas do
 * extrato daquele dia ainda não foram ao ERP, e se os lançamentos diários dele
 * já saíram. Um dia está VIRADO quando faltam zero linhas e não sobrou nenhum
 * diário ativo.
 *
 * `security invoker` de propósito: quem lê é a edge function com service key, e
 * a tela (se um dia existir) deve ver pela régua de quem está logado.
 */
create or replace function public.asaas_omie_virada(p_limite int default 400)
returns table (
  dia               date,
  linhas_extrato    bigint,
  linhas_no_omie    bigint,
  linhas_faltando   bigint,
  diarios_ativos    bigint,
  virado            boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with dias as (
    select e.data_movimento as dia, count(*) as linhas
    from public.asaas_extrato e
    where e.data_movimento is not null
    group by 1
  ),
  feitas as (
    select l.dia, count(*) as n
    from public.asaas_omie_lancamento l
    where l.modo = 'linha' and l.status = 'enviado'
    group by 1
  ),
  diarios as (
    select l.dia, count(*) as n
    from public.asaas_omie_lancamento l
    where l.modo = 'diario' and l.status = 'enviado' and l.ncodcc = '5460455582'
    group by 1
  )
  select d.dia,
         d.linhas,
         coalesce(f.n, 0),
         greatest(d.linhas - coalesce(f.n, 0), 0),
         coalesce(x.n, 0),
         (d.linhas - coalesce(f.n, 0) <= 0 and coalesce(x.n, 0) = 0)
  from dias d
  left join feitas f on f.dia = d.dia
  left join diarios x on x.dia = d.dia
  order by d.dia
  limit p_limite;
$$;

revoke all on function public.asaas_omie_virada(int) from anon;
