/* ---------------------------------------------------------------------------
 * A EDIÇÃO À MÃO VENCE O CONSERTO AUTOMÁTICO.
 *
 * O QUE MUDOU NO HUB. `omie-clientes-criar` ganhou a ação `editar_cadastro`: a
 * tela de Notas Fiscais passa a deixar digitar e-mail, telefone, nome e endereço
 * do cliente, gravando no Omie e no Asaas. Ela existe porque há recusa que
 * consulta nenhuma resolve — "Para emitir a NFS-e falta preencher o E-mail" é a
 * principal, e e-mail não está em cadastro federal nenhum.
 *
 * O BURACO QUE ISSO ABRIU, e que esta migration fecha. `nf_cadastros_a_corrigir`
 * monta a fila do conserto automático (12:45 UTC, quinze minutos antes da
 * emissão) e tem duas guardas: nada de repetir o conserto depois da mesma
 * recusa, e três tentativas encerram o assunto. As duas contam APENAS
 * `origem = 'automatico'` — ninguém mais escrevia ali. Com a edição à mão, o
 * roteiro vira este:
 *
 *   1. a nota é recusada por endereço;
 *   2. uma pessoa olha, vê que a Receita está errada (logradouro com o nome da
 *      cidade, número "00", CEP de uma unidade que mudou de rua) e digita o
 *      endereço certo;
 *   3. a nota ainda falha por outro motivo, ou simplesmente o dia vira;
 *   4. às 12:45 a rodada não enxerga a edição, consulta a Receita de novo e
 *      escreve por cima — desfazendo a decisão de quem olhou.
 *
 * E desfazendo em silêncio: a tela mostraria o endereço da Receita outra vez,
 * como se ninguém tivesse digitado nada.
 *
 * A REGRA: cadastro que uma pessoa editou sai da fila do conserto automático.
 * Não é "sai até a próxima recusa" — é sai. Depois que alguém digitou, a máquina
 * não tem mais nada a propor sobre aquele endereço: se continua falhando, é caso
 * humano, e caso humano volta pela tela, que é de onde ele saiu. A guarda por
 * recusa mais nova continua valendo para o automático; esta é absoluta porque a
 * fonte é outra — uma consulta pode estar velha, uma pessoa não fica velha.
 *
 * NÃO TOCA NO PRÉ-VOO (`nfse_preparo_montar`), e não precisa: lá a fila é
 * montada a partir de `omie_clientes_endereco`, e a edição atualiza o espelho na
 * mesma chamada. Cadastro com e-mail e endereço preenchidos deixa de bater na
 * condição (`emitivel`) e o `delete` da montagem o tira sozinho.
 *
 * O corpo abaixo é o de `20260829150000` com UMA cláusula acrescentada no fim do
 * `where`. Está inteiro de propósito: `create or replace` de função `sql` não
 * emenda, substitui — e a assinatura e as colunas de saída são as mesmas, então
 * não há overload novo nascendo aqui.
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
  /* A CLÁUSULA NOVA. Sem data na comparação de propósito: a edição à mão não
     "expira" com a próxima recusa. Quem digitou decidiu, e a máquina não
     redecide — ver o cabeçalho. O índice `nf_cadastro_correcoes_doc_origem_idx`
     (doc, origem, criado_em desc) já serve esta consulta.

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
  'Fila do conserto automático de endereço. Fica de fora: quem já foi consertado '
  'depois da última recusa, quem já teve três tentativas automáticas, e quem uma '
  'pessoa editou à mão (origem = ''edicao''), porque decisão humana não se '
  'desmancha sozinha.';
