/* ============================================================================
 * A AUDITORIA DA DEVOLUÇÃO NÃO CONFUNDE OS VELHA COM OS NOVA
 *
 * `nfse_devolvidas_a_esteira` procurava a OS nova por `c_cod_int_os =
 * carimbo_original` — e para as OS sem carimbo (que são justamente as que a
 * devolução alcança) o `carimbo_original` é a cobrança RESOLVIDA pelo
 * heurístico. Só que a mesma cobrança pode ter OS ANTIGAS do Hub com esse
 * carimbo, de tentativas anteriores. Resultado medido logo na primeira leva: 12
 * linhas anunciadas como "recusada de novo" e 1 como "nota emitida" antes de a
 * esteira ter criado UMA OS sequer.
 *
 * Auditoria que dá desfecho antes de o desfecho existir é pior do que auditoria
 * nenhuma: ela seria lida como "a devolução não funcionou" no dia seguinte.
 *
 * O CONSERTO: a OS nova tem de ser POSTERIOR à morta. `n_cod_os` do Omie é
 * crescente (é o id da linha lá), então `nova.n_cod_os > m.n_cod_os` separa as
 * duas sem precisar de carimbo de data que a tabela não tem. E a nova não pode
 * estar ela mesma aposentada, senão uma segunda devolução da mesma cobrança se
 * leria como desfecho da primeira.
 * ========================================================================== */

create or replace function public.nfse_devolvidas_a_esteira(p_dias integer default 30)
returns table(
  n_cod_os bigint, id_cobranca text, nome text, valor numeric,
  liberada_em timestamptz, motivo_da_recusa text,
  os_nova bigint, nota_nova text, situacao text
)
language sql
stable
set search_path to 'public'
as $function$
select m.n_cod_os,
       m.carimbo_original,
       coalesce(en.nome, '—'),
       m.valor,
       m.carimbo_liberado_em,
       m.nfse_mensagem,
       nova.n_cod_os,
       nullif(nova.nfse_numero, ''),
       /* OS RÓTULOS DESCREVEM O ESTADO DA COBRANÇA, não o efeito da devolução —
          e a diferença não é preciosismo. Mesmo exigindo `n_cod_os` maior, a OS
          encontrada pode ser ANTERIOR à devolução: a cobrança que a esteira já
          tinha tentado antes tem uma OS do Hub mais nova que a do n8n. Medido na
          primeira leva: 51 das 98 já tinham OS posterior antes de a esteira
          rodar uma vez. Escrever "recusada de novo" ali seria acusar esta
          operação de um desfecho que ela não produziu. */
       case
         when nova.nfse_status = '004' then 'a cobrança já tem nota'
         when nova.nfse_status = '003' then 'a OS mais nova também foi recusada'
         when nova.n_cod_os is not null then 'já tem OS mais nova, ainda sem nota'
         else 'na fila da esteira'
       end
from public.nf_os_omie m
left join public.omie_clientes_endereco en on en.codigo = m.n_cod_cli
left join lateral (
  select o.n_cod_os, o.nfse_numero, o.nfse_status
  from public.nf_os_omie o
  where o.c_cod_int_os = m.carimbo_original
    /* POSTERIOR À MORTA, e não apenas "outra": o `n_cod_os` do Omie é crescente,
       então ele ordena no tempo sem coluna de data. Sem esta linha, uma OS
       antiga da mesma cobrança era anunciada como o desfecho desta devolução. */
    and o.n_cod_os > m.n_cod_os
    and o.cancelada = false
    and o.carimbo_liberado_em is null
  order by o.n_cod_os desc
  limit 1
) nova on true
where m.carimbo_liberado_em is not null
  and m.carimbo_liberado_em >= now() - make_interval(days => greatest(p_dias, 1))
order by m.carimbo_liberado_em desc, m.valor desc;
$function$;

revoke all on function public.nfse_devolvidas_a_esteira(integer) from public, anon;
grant execute on function public.nfse_devolvidas_a_esteira(integer) to authenticated, service_role;
