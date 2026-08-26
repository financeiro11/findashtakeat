-- Conserto automático do cadastro que a emissão recusou por endereço.
--
-- POR QUE VIRA ROTINA. O conserto manual (diálogo "Corrigir cadastro") provou o
-- caminho, mas ele só acontece se alguém abrir a aba e reparar. Das 16 emissões
-- mortas em 26/08/26, 15 eram a mesma coisa — o cadastro do Omie sem o número do
-- endereço — e a Receita tinha a resposta para todas. Esperar que alguém repare é
-- o desenho que produziu 12h de silêncio da primeira vez; do corte (01/09) em
-- diante são ~100 notas/dia e o mesmo silêncio custaria muito mais.
--
-- O GATILHO É A PRÓPRIA RECUSA, e é ele que autoriza a escrita. A regra do módulo
-- ("não se mexe no endereço de cliente que já existe no ERP") continua valendo
-- para todo mundo: o que muda é que um cadastro que o Omie OU a prefeitura acabou
-- de recusar não é mais um cadastro sobre o qual não temos nada a dizer. Só entra
-- quem falhou, e só sai o que a Receita/CEP responde.

/* ------------------------------- os freios -------------------------------- */

alter table public.nf_config
  -- 'off' | 'omie' | 'omie_asaas'. Nasce em 'omie': é o lado que destrava a nota.
  -- Escrever no Asaas (a ORIGEM do dado, que evita a recaída no mês seguinte) é
  -- decisão maior e fica opt-in — ele é o cadastro que o cliente vê na cobrança.
  add column if not exists cadastro_auto text not null default 'omie',
  -- Teto por rodada: cada cliente custa uma consulta à BrasilAPI + duas ao Omie.
  add column if not exists cadastro_auto_teto integer not null default 15;

comment on column public.nf_config.cadastro_auto is
  'Conserto automático de endereço recusado: off | omie | omie_asaas. Ver nf_cadastros_a_corrigir.';

alter table public.nf_cadastro_correcoes
  -- 'manual' (o diálogo) | 'automatico' (a rodada). Separar os dois é o que
  -- permite a guarda de reincidência sem contar o conserto que uma pessoa fez.
  add column if not exists origem text not null default 'manual';

/* ------------------------- quem entra no conserto -------------------------- */
/*
 * As três condições, e cada uma tapa um buraco diferente:
 *
 *   1. o ÚLTIMO passo de faturamento da OS é `erro` com cara de endereço —
 *      não basta "já falhou alguma vez": nota que saiu depois não se reabre;
 *   2. não houve conserto AUTOMÁTICO depois dessa recusa — senão a rodada
 *      reescreveria o mesmo endereço todo dia, para sempre;
 *   3. menos de 3 tentativas automáticas no total — se duas idas à Receita não
 *      resolveram, o problema não é o que a Receita sabe. Fica para a pessoa.
 */
create or replace function public.nf_cadastros_a_corrigir(p_limite integer default 15)
returns table(
  doc text, id_customer text, n_cod_cli bigint, nome text,
  ids text[], motivo text, ultima_recusa timestamptz, tentativas integer,
  os_faturada boolean
)
language sql
stable
set search_path to 'public'
as $function$
with ultimo as (
  -- Um por OS, o mais recente. `criar_os` é passo anterior e `email` é posterior
  -- à nota: nenhum dos dois responde "esta emissão terminou".
  select distinct on (e.n_cod_os)
         e.n_cod_os, e.id_asaas, e.resultado, e.erro, e.criado_em
  from public.nf_emissoes e
  where e.n_cod_os is not null
    and e.acao in ('faturar', 'criar_e_faturar')
  order by e.n_cod_os, e.criado_em desc
),
recusadas as (
  select u.*
  from ultimo u
  where u.resultado = 'erro'
    /* A recusa por endereço, nas duas vozes: a do Omie ("falta preencher o
     * Número do Endereço") e a da prefeitura (E0240 do CEP, E0921/E0922 do
     * código do município). Ver nfse-presas-cadastro-do-tomador. */
    and (
      u.erro ilike '%falta preencher%'
      or u.erro like '%E0240%'
      or u.erro like '%E0921%'
      or u.erro like '%E0922%'
      or u.erro ilike '%código do município%'
    )
),
comdoc as (
  select r.*,
         p.dados->>'customer' as id_customer,
         regexp_replace(coalesce(c.dados->>'cpfCnpj',''), '\D', '', 'g') as doc,
         coalesce(c.dados->>'name', c.dados->>'company', '—') as nome,
         coalesce(o.faturada, false) as os_faturada
  from recusadas r
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
         (array_agg(d.erro order by d.criado_em desc))[1] as motivo,
         max(d.criado_em)   as ultima_recusa,
         bool_and(d.os_faturada) as os_faturada
  from comdoc d
  where length(d.doc) in (11, 14)
  group by d.doc
)
select pc.doc, pc.id_customer, oc.codigo, pc.nome, pc.ids, pc.motivo,
       pc.ultima_recusa,
       (select count(*)::int from public.nf_cadastro_correcoes k
         where k.doc = pc.doc and k.origem = 'automatico') as tentativas,
       pc.os_faturada
from porcliente pc
join omie_cli oc on oc.doc = pc.doc          -- sem cadastro no Omie é outro caso: `criar`
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

comment on function public.nf_cadastros_a_corrigir(integer) is
  'Clientes cuja última tentativa de faturamento foi recusada por endereço e que ainda não foram consertados automaticamente depois disso.';

revoke all on function public.nf_cadastros_a_corrigir(integer) from anon;
