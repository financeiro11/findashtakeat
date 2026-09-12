/* ---------------------------------------------------------------------------
 * TENTATIVA QUE NÃO ESCREVEU NADA NÃO TRANCA A PRÓXIMA.
 *
 * O DEFEITO, medido em 12/09/2026 logo depois de a máquina aprender a consertar
 * telefone e código do município: duas OS (R$ 718,66) que a capacidade nova
 * resolveria continuavam fora da fila. Não por falta de capacidade — por
 * memória. `nf_cadastros_a_corrigir` tem a guarda "não se repete o conserto
 * depois da mesma recusa", e ela olhava se existia QUALQUER linha automática
 * posterior à recusa:
 *
 *     and not exists (select 1 from nf_cadastro_correcoes k
 *                      where k.doc = … and k.origem = 'automatico'
 *                        and k.criado_em > pc.ultima_recusa)
 *
 * As duas tinham uma linha assim, gravada por uma rodada que abriu o cadastro,
 * concluiu `nada_a_propor` e NÃO ESCREVEU NADA — porque naquele dia a máquina
 * não sabia mexer no campo que a prefeitura acusou. A guarda passou a proteger
 * uma decisão que nunca aconteceu.
 *
 * É UM PADRÃO, não um caso: toda vez que a máquina fica mais capaz, as guardas
 * continuam lembrando das falhas da máquina antiga. A resposta não é datar a
 * capacidade (um "a partir de tal versão, tente de novo" que envelhece mal e
 * ninguém entende em três meses) — é dizer o que a guarda de fato protege.
 *
 * O QUE ELA PROTEGE é a escrita repetida: reabrir o mesmo cadastro todo dia
 * depois da mesma recusa e reescrever o endereço em cima do que já está lá.
 * Uma rodada que LEU e não escreveu não tem nada para proteger — não gastou
 * escrita, não desfez decisão de ninguém, não mudou o cadastro. Ela é só uma
 * anotação de que a máquina olhou.
 *
 * E O FREIO CONTRA INSISTIR JÁ EXISTE, é a outra guarda: `tentativas < 3`, que
 * conta TODAS as linhas automáticas, inclusive as que não escreveram. Quem
 * falha sempre é tentado três vezes e vai para a pilha humana — que é onde uma
 * falha repetida pertence, e era a intenção escrita quando o teto nasceu. A
 * diferença é que agora as três tentativas acontecem de fato, em vez de a
 * primeira consumir a vez das outras duas.
 *
 * O CUSTO DE ESTAR ERRADO, dos dois lados: com a guarda frouxa, um cliente
 * irresolvível custa três rodadas de consulta em vez de uma (a Receita e duas
 * chamadas ao Omie, dentro do teto de quinze por rodada). Com a guarda apertada,
 * uma nota fica sem sair para sempre — a única coisa que a fila destravaria
 * nunca é tentada. Os dois erros não têm o mesmo tamanho.
 *
 * A EXPRESSÃO `(k.resultado->'omie'->>'ok')::boolean is true` é a MESMA que
 * `nfse_recusas_a_tratar` usa para decidir se uma recusa está "consertada". As
 * duas perguntas são a mesma pergunta — "esta rodada escreveu no Omie?" — e
 * responder diferente em cada lugar é como a tela passa a dizer "consertado"
 * sobre quem a fila considera intocado.
 *
 * SÓ O LADO OMIE conta, e não o Asaas: a recusa da prefeitura é sobre o
 * cadastro do ERP. Uma escrita no Asaas que não chegou ao Omie não consertou a
 * nota, e tratá-la como conserto trancaria a fila pelo sistema errado.
 *
 * A GUARDA DA EDIÇÃO À MÃO CONTINUA ABSOLUTA (`origem = 'edicao'`, sem data):
 * quem digitou decidiu, e a máquina não redecide — ver `20260911140000`. Ela não
 * é afetada por isto, e nem deveria: consulta pode estar velha, pessoa não fica
 * velha.
 *
 * O corpo abaixo é o de `20260912120000` com UMA linha acrescentada dentro do
 * primeiro `not exists`. Está inteiro de propósito: `create or replace` de
 * função `sql` não emenda, substitui.
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
      /* Telefone, desde 12/09/2026 — antes disso a máquina não sabia consertá-lo
         e pô-lo na fila só enchia a lista de casos devolvidos intactos. */
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
       /* O TETO CONTA TUDO, inclusive as rodadas que não escreveram — é ele o
          freio contra insistir, agora que a guarda abaixo só olha escrita. */
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
          /* A LINHA NOVA — ver o cabeçalho. Só a rodada que ESCREVEU no Omie
             tranca a seguinte; a que leu e não soube o que propor é anotação,
             não decisão. Mesma expressão que `nfse_recusas_a_tratar` usa para
             chamar uma recusa de "consertada". */
          and (k.resultado->'omie'->>'ok')::boolean is true
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
  'telefone (E1235) e código do município. Fica de fora: quem já teve o cadastro '
  'ESCRITO com sucesso depois da última recusa, quem já teve três tentativas '
  'automáticas (contando as que não escreveram nada) e quem uma pessoa editou à '
  'mão (origem = ''edicao''), porque decisão humana não se desmancha sozinha. '
  'Tentativa que só leu e não escreveu NÃO tranca a próxima: ela não protege '
  'decisão nenhuma, e trancava justamente os casos que a máquina aprendeu a '
  'resolver depois.';
