/* ---------------------------------------------------------------------------
 * A RECUSA DE TELEFONE ENTRA NA FILA DO CONSERTO AUTOMÁTICO.
 *
 * O QUE MUDOU NO HUB (12/09/2026). `aplicarCorrecao` passou a aceitar o motivo
 * da recusa e a tratá-lo como AUTORIZAÇÃO para sobrescrever o campo que ele
 * nomeia — ver `camposAcusados` em `omie-clientes-criar`. Até aqui a regra era
 * "só sobre campo vazio", e ela está certa como regra geral: o cadastro é de
 * terceiro. O ponto cego era o campo PREENCHIDO E COMPROVADAMENTE ERRADO, e a
 * prova vem de fora: a prefeitura recusou a nota dizendo qual campo recusou.
 *
 * O BURACO QUE ISSO NÃO FECHAVA SOZINHO, e que esta migration fecha. A fila do
 * conserto tem duas fontes, e a primeira (`do_diario`, "a prefeitura recusou a
 * NOSSA nota") filtra por uma lista fechada de erros:
 *
 *     falta preencher · E0240 · E0921 · E0922 · código do município
 *
 * Todos de ENDEREÇO, porque endereço era tudo que a máquina sabia consertar.
 * O E1235 — "Telefone do cliente inválido" — nunca esteve lá. Resultado medido
 * em 11/09/2026: quatro OS (R$ 2.723) recusadas por telefone que a rodada
 * automática nem enxergava, paradas em "precisa de você" desde então. A
 * capacidade nova ficaria inalcançável por essas quatro: a função saberia
 * consertar um caso que a fila não lhe entrega.
 *
 * A segunda fonte (`do_asaas`, "a prefeitura recusou a nota DELE pelo mesmo
 * cadastro") já casava `ilike '%telefone%'` desde 29/08/2026. As duas passam a
 * concordar — o que é o ponto: a mesma recusa, vinda pelo nosso RPS ou pelo
 * dele, tem de dar na mesma fila.
 *
 * O CÓDIGO E A FRASE, como no resto da lista. O código (`E1235`) é o que o
 * Omie repassa quando repassa; a frase solta entra ao lado porque a mensagem é
 * reescrita mais de uma vez no caminho ("Telefone inválido", "telefone do
 * tomador") e o código não sobrevive a toda reescrita. Um falso positivo aqui
 * custa uma tentativa das três e uma linha em `nf_cadastro_correcoes` dizendo
 * "nada a propor"; um falso negativo custa uma nota que ninguém emite.
 *
 * O corpo abaixo é o de `20260911140000` com DUAS linhas acrescentadas no
 * `where` de `do_diario`. Está inteiro de propósito: `create or replace` de
 * função `sql` não emenda, substitui — e a assinatura e as colunas de saída são
 * as mesmas, então não há overload novo nascendo aqui.
 * ------------------------------------------------------------------------- */

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
      /* AS DUAS LINHAS NOVAS. O telefone só era conserto de máquina depois de
         12/09/2026; antes disso pô-lo na fila seria encher a lista de casos que
         a rodada abriria e devolveria intactos. */
      or u.erro like '%E1235%'
      or u.erro ilike '%telefone%'
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
  /* Sem data na comparação de propósito: a edição à mão não "expira" com a
     próxima recusa. Quem digitou decidiu, e a máquina não redecide — ver o
     cabeçalho de `20260911140000`. O índice
     `nf_cadastro_correcoes_doc_origem_idx` (doc, origem, criado_em desc) já
     serve esta consulta.

     `'edicao'` EXATO, e não `like 'edicao%'`: a Edge Function grava
     `'edicao_falhou'` quando o clique não escreveu nada (o Omie recusou, o CEP
     digitado não existe, os valores já eram iguais). Tentativa sem efeito não é
     decisão, e desligar a rodada automática de um cliente por causa dela seria
     trocar um conserto que funciona por um que não aconteceu. */
  and not exists (
        select 1 from public.nf_cadastro_correcoes k
        where k.doc = pc.doc and k.origem = 'edicao'
      )
order by pc.ultima_recusa desc
limit greatest(p_limite, 0);
$function$;

revoke all on function public.nf_cadastros_a_corrigir(integer) from public, anon;
grant execute on function public.nf_cadastros_a_corrigir(integer) to authenticated, service_role;

comment on function public.nf_cadastros_a_corrigir(integer) is
  'Fila do conserto automático de cadastro do tomador: endereço, contato, '
  'telefone (E1235, desde 12/09/2026) e código do município. Fica de fora: quem '
  'já foi consertado depois da última recusa, quem já teve três tentativas '
  'automáticas, e quem uma pessoa editou à mão (origem = ''edicao''), porque '
  'decisão humana não se desmancha sozinha.';
