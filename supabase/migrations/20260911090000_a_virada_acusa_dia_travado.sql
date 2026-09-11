/* ============================================================================
 * A virada passa a acusar dia TRAVADO.
 *
 * O MODO DE FALHA QUE FALTAVA. Um dia só tem os resumos diários removidos depois
 * que TODAS as suas linhas entraram no ERP. Se uma linha falhar em definitivo —
 * cinco tentativas e sai da fila —, aquele dia nunca completa: os resumos ficam,
 * as linhas que entraram ficam, e o dia passa a contar DUAS VEZES no Omie. Para
 * sempre, e sem ninguém perceber, porque a rotina segue respondendo 200 e
 * trabalhando nos outros dias.
 *
 * Foi exatamente a forma silenciosa de um problema que já aconteceu na forma
 * barulhenta: dez linhas com acento decomposto ("Café" como `Cafe` + U+0301, que
 * o Omie recusa com "Parâmetro informado não é um hash válido") travaram o
 * backfill inteiro por 6h23 em 11/09/2026. Aquilo parou tudo e por isso foi
 * visto. Um dia travado não para nada — e é pior.
 *
 * `travado` = tem linha que desistiu (tentativas no teto) e ainda tem resumo
 * ativo. A pergunta "algo encalhou?" passa a ser uma consulta:
 *
 *   select * from asaas_omie_virada() where travado;
 *
 * O teto de dias subiu de 400 para 2000: o espelho cresce um dia por dia, e em
 * 400 dias a função começaria a cortar dias calada — o mesmo tipo de defeito que
 * ela existe para denunciar.
 * ========================================================================== */

drop function if exists public.asaas_omie_virada(int);

create or replace function public.asaas_omie_virada(p_limite int default 2000)
returns table (
  dia               date,
  linhas_extrato    bigint,
  linhas_no_omie    bigint,
  linhas_faltando   bigint,
  linhas_desistidas bigint,
  diarios_ativos    bigint,
  virado            boolean,
  travado           boolean
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
  desistidas as (
    select l.dia, count(*) as n
    from public.asaas_omie_lancamento l
    where l.modo = 'linha' and l.status = 'erro' and coalesce(l.tentativas, 0) >= 5
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
         coalesce(v.n, 0),
         (d.linhas - coalesce(f.n, 0) <= 0 and coalesce(v.n, 0) = 0),
         (coalesce(x.n, 0) > 0 and coalesce(v.n, 0) > 0)
  from dias d
  left join feitas f on f.dia = d.dia
  left join desistidas x on x.dia = d.dia
  left join diarios v on v.dia = d.dia
  order by d.dia
  limit p_limite;
$$;

revoke all on function public.asaas_omie_virada(int) from anon;
