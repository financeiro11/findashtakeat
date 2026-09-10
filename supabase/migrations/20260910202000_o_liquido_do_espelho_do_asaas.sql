/* ============================================================================
 * O líquido de TODO o espelho do extrato do Asaas, numa linha.
 *
 * Serve para deduzir o SALDO DE ABERTURA da conta no Omie: o espelho começa num
 * dia qualquer (01/04/2026, depois do backfill de 10/09/2026), e antes dele o
 * ERP não tem nada. Com abertura zero a conta fecha certa no movimento e errada
 * no saldo — para sempre, e sem avisar.
 *
 * abertura = saldo de agora (lido ao vivo do Asaas) − líquido de todo o espelho
 *
 * As duas pontas são independentes, então elas se conferem: se o espelho tiver
 * buraco, a abertura sai num valor estranho e denuncia o buraco em vez de
 * escondê-lo dentro de um saldo que "bate".
 *
 * Agrega no Postgres e não no cliente porque são ~46 mil linhas e o PostgREST
 * corta em 1.000 por resposta, calado — somar no cliente daria um número menor
 * e plausível, que é o pior jeito de errar.
 * ========================================================================== */

create or replace function public.asaas_extrato_liquido_total()
returns table (
  liquido      numeric,
  linhas       bigint,
  primeiro_dia date,
  ultimo_dia   date
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select round(coalesce(sum(case when tipo = 'credito' then valor else -valor end), 0), 2),
         count(*),
         min(data_movimento),
         max(data_movimento)
  from public.asaas_extrato
  where data_movimento is not null;
$$;

revoke all on function public.asaas_extrato_liquido_total() from anon;
