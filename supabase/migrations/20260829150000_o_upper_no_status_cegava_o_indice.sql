/* ============================================================================
 * O `upper()` NO STATUS CEGAVA O ÍNDICE — e a fila de conserto morria nos 8s.
 *
 * A migration anterior (`20260829140000`) deixou `nf_cadastros_a_corrigir` em
 * **15,8s**, e o papel `authenticated` corta em 8. A Edge Function recebia
 * "canceling statement due to statement timeout" DENTRO de um `{"status":"ok"}`
 * — o modo de falha caro deste módulo, porque parece que rodou.
 *
 * Medido trecho a trecho: o `omie_cli` (que expande 7.043 clientes de um jsonb)
 * custa 49ms; a leitura das notas em erro do Asaas custava **11,8s**.
 *
 * A CAUSA NÃO É O VOLUME, SÃO 1.683 LINHAS. É que `upper(coalesce(status,''))
 * = 'ERROR'` não casa com `asaas_cache_status_idx (tipo, status)` — uma função
 * em cima da coluna cega o índice, e o Postgres varre a tabela inteira. Em
 * `asaas_cache` isso é caro por um motivo já conhecido aqui: o `dados` jsonb
 * mora inline e o heap é maior que o cache (ver `asaas-cache-heap-gordo`).
 *
 * E o `upper` nunca foi necessário: os seis valores gravados são
 * `AUTHORIZED`, `CANCELED`, `ERROR`, `SCHEDULED`, `SYNCHRONIZED` e
 * `CANCELLATION_DENIED` — todos em caixa alta, escritos por `mapInvoice`, que
 * copia o que o Asaas manda. O `coalesce` também não: `status` nulo nunca
 * casaria com 'ERROR' de todo jeito.
 *
 * Trocado por comparação direta, o índice volta a ser usado. `CANCELLED` (com
 * dois L) segue na lista de exclusão por segurança — é a grafia da API em
 * outros endpoints, e custa nada estar lá.
 * ========================================================================== */

create or replace function public.nf_cadastros_a_corrigir(p_limite integer default 15)
returns table (
  doc text, id_customer text, n_cod_cli bigint, nome text, ids text[],
  motivo text, ultima_recusa timestamptz, tentativas integer, os_faturada boolean,
  fonte text
)
language sql stable set search_path to 'public' as $function$
with ultimo as (
  select distinct on (e.n_cod_os)
         e.n_cod_os, e.id_asaas, e.resultado, e.erro, e.criado_em
  from public.nf_emissoes e
  where e.n_cod_os is not null
    and e.acao in ('faturar', 'criar_e_faturar')
  order by e.n_cod_os, e.criado_em desc
),
/* FONTE 1 — a prefeitura recusou a NOSSA nota. */
do_diario as (
  select u.id_asaas, u.erro, u.criado_em, u.n_cod_os, 'nosso'::text as fonte
  from ultimo u
  where u.resultado = 'erro'
    and (
      u.erro ilike '%falta preencher%'
      or u.erro like '%E0240%'
      or u.erro like '%E0921%'
      or u.erro like '%E0922%'
      or u.erro ilike '%código do município%'
    )
),
/* FONTE 2 — a prefeitura recusou a nota DELE, pelo mesmo cadastro.
 * `status = 'ERROR'` cru: é o que usa `asaas_cache_status_idx`. */
do_asaas as (
  select n.pagamento_ref as id_asaas,
         n.dados->>'statusDescription' as erro,
         ((n.dados->>'effectiveDate')::date)::timestamptz as criado_em,
         null::bigint as n_cod_os,
         'asaas'::text as fonte
  from public.asaas_cache n
  where n.tipo = 'invoice'
    and n.status = 'ERROR'
    and n.pagamento_ref is not null
    and (n.dados->>'effectiveDate') ~ '^\d{4}-\d{2}-\d{2}$'
    and (
      n.dados->>'statusDescription' ilike '%E0240%'
      or n.dados->>'statusDescription' ilike '%CEP informado%'
      or n.dados->>'statusDescription' ilike '%E0921%'
      or n.dados->>'statusDescription' ilike '%E0922%'
      or n.dados->>'statusDescription' ilike '%telefone%'
      or n.dados->>'statusDescription' ilike '%Dados Pessoa%'
      or n.dados->>'statusDescription' ilike '%formul%'
    )
    /* Nota boa dele para a MESMA cobrança encerra o assunto. O índice que serve
     * aqui é `asaas_cache_painel_nota_idx (pagamento_ref) INCLUDE (status)`,
     * que responde sem tocar no heap — de novo, só com o status cru. */
    and not exists (
      select 1 from public.asaas_cache b
      where b.tipo = 'invoice' and b.pagamento_ref = n.pagamento_ref
        and b.status not in ('ERROR', 'CANCELLED', 'CANCELED')
    )
    and not exists (
      select 1 from public.nf_os_omie o
      where o.cancelada = false and o.nfse_status = '004'
        and o.c_cod_int_os = n.pagamento_ref
    )
),
evidencia as (
  select * from do_diario
  union all
  select * from do_asaas
),
comdoc as (
  select r.*,
         p.dados->>'customer' as id_customer,
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         coalesce(c.dados->>'name', c.dados->>'company', '—') as nome,
         coalesce(o.faturada, false) as os_faturada
  from evidencia r
  join public.asaas_cache p on p.tipo = 'payment' and p.id_asaas = r.id_asaas
  join public.asaas_cache c on c.tipo = 'customer' and c.id_asaas = p.dados->>'customer'
  left join public.nf_os_omie o on o.n_cod_os = r.n_cod_os
),
omie_cli as (
  select regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') as doc,
         min((c->>'codigo')::bigint) as codigo
  from public.omie_cache, jsonb_array_elements(dados) c
  where chave = 'clientes'
    and regexp_replace(coalesce(c->>'cnpj_cpf',''), '\D', '', 'g') <> ''
  group by 1
),
porcliente as (
  select d.doc,
         min(d.id_customer) as id_customer,
         min(d.nome)        as nome,
         array_agg(d.id_asaas order by d.criado_em desc) as ids,
         (array_agg(d.erro  order by d.criado_em desc))[1] as motivo,
         max(d.criado_em)   as ultima_recusa,
         bool_and(d.os_faturada) as os_faturada,
         case when count(distinct d.fonte) > 1 then 'ambas' else min(d.fonte) end as fonte
  from comdoc d
  where length(d.doc) in (11, 14)
  group by d.doc
)
select pc.doc, pc.id_customer, oc.codigo, pc.nome, pc.ids, pc.motivo,
       pc.ultima_recusa,
       (select count(*)::int from public.nf_cadastro_correcoes k
         where k.doc = pc.doc and k.origem = 'automatico') as tentativas,
       pc.os_faturada,
       pc.fonte
from porcliente pc
join omie_cli oc on oc.doc = pc.doc
where not exists (
        select 1 from public.nf_cadastro_correcoes k
        where k.doc = pc.doc and k.origem = 'automatico'
          and k.criado_em > pc.ultima_recusa
      )
  and (select count(*) from public.nf_cadastro_correcoes k
        where k.doc = pc.doc and k.origem = 'automatico') < 3
order by pc.ultima_recusa desc
limit greatest(p_limite, 0);
$function$;

revoke all on function public.nf_cadastros_a_corrigir(integer) from public, anon;
grant execute on function public.nf_cadastros_a_corrigir(integer) to authenticated, service_role;

/* O índice que fecha a conta do `nf_cadastro_correcoes`: a função o consulta
 * três vezes por cliente (duas no `where`, uma na coluna `tentativas`). */
create index if not exists nf_cadastro_correcoes_doc_origem_idx
  on public.nf_cadastro_correcoes (doc, origem, criado_em desc);
