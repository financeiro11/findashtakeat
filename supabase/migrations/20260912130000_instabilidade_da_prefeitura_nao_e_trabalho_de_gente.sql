/* ---------------------------------------------------------------------------
 * INSTABILIDADE DA PREFEITURA NÃO É TRABALHO DE GENTE.
 *
 * MEDIDO EM 12/09/2026, varrendo o que estava parado em "Precisam de você":
 * 43 OS, R$ 19.072,87. Treze delas (R$ 4.360,28) não tinham defeito de cadastro
 * nenhum — eram o webservice fora do ar:
 *
 *   12 OS · R$ 3.913,28  "Falha no processamento da NFS-e por indisponibilidade
 *                         na NFS-e Nacional."
 *    1 OS · R$   447,00  'A prefeitura respondeu "502 - Web server received an
 *                         invalid response while acting as a gateway or proxy
 *                         server." (recusa do webservice, não crítica da nota).'
 *
 * O SEGUNDO CASO É O QUE DÓI, porque a conclusão já estava escrita e foi jogada
 * fora. Aquela frase entre parênteses é NOSSA: `textoDaMensagem`, na
 * `omie-nfse-sync`, reconhece a página de erro HTTP, extrai o título e anota
 * "recusa do webservice, não crítica da nota" — o diagnóstico já feito, no
 * texto, guardado na coluna. Esta RPC então o ignorava e procurava três
 * palavras específicas (`403`, `Nenhuma resposta`, `sobrecarregados`), que eram
 * as que existiam no dia em que ela foi escrita. Qualquer outro código HTTP
 * caía em "Ver mensagem da prefeitura" → "precisa_de_gente".
 *
 * O CUSTO DO ROTULO ERRADO não é cosmético. Os três grupos da tela são AÇÕES:
 * "só reenviar" convida ao botão "Devolver à esteira", que aposenta a OS e
 * refaz a emissão sozinha; "precisam de você" convida a ligar para o cliente
 * conferir um endereço que está certo. Treze notas de R$ 4.360 estavam na fila
 * que ninguém consegue trabalhar, a um clique de existirem.
 *
 * A RÉGUA NOVA prefere a NOSSA conclusão às palavras da prefeitura:
 *
 *   • `recusa do webservice` — a frase que `textoDaMensagem` escreve. Cobre
 *     todo código HTTP de uma vez, hoje e no próximo que aparecer, porque quem
 *     a escreve já sabe que é página de erro e não crítica de nota. As três
 *     palavras antigas ficam, para o histórico gravado antes dela existir.
 *   • `indisponibilidade` / `indisponível` — o texto da própria NFS-e Nacional
 *     quando ela é que está fora. Não é o Omie, não é o cadastro, não é a
 *     prefeitura criticando: é o serviço federal.
 *
 * POR QUE NÃO CASAR POR `%502%` E AFINS: número solto casa com protocolo, com
 * CNPJ e com valor dentro da mensagem. O `403` antigo já corria esse risco; não
 * vou multiplicá-lo por quatro. Frase é mais específica que número.
 *
 * O QUE ESTA MIGRATION NÃO FAZ: reenviar. Ela recoloca as treze no grupo em que
 * o botão existe. Reenvio continua sendo clique de gente, porque emitir nota é
 * ato fiscal — e porque "Devolver à esteira" tem as guardas dele (relê o
 * `StatusOS` antes de aposentar, para não aposentar o que já virou nota).
 *
 * O corpo abaixo é o de `20260910190000` com as duas listas de instabilidade
 * estendidas — as MESMAS duas, e é por isso que elas viram um CTE de uma linha
 * em vez de ficarem escritas duas vezes: elas se contradisseram uma vez (o
 * `motivo_curto` dizia "reenviar resolve" e o `situacao` mandava para "precisa
 * de gente") e não há razão para deixar isso possível de novo.
 * ------------------------------------------------------------------------- */

create or replace function public.nfse_recusas_a_tratar(p_dias integer default 30)
returns table(
  n_cod_os bigint, c_num_os text, id_cobranca text, cnpj_cpf text, nome text,
  valor numeric, data_faturamento date, motivo text, motivo_curto text,
  cep text, cep_generico boolean, cep_valido boolean, emitivel boolean,
  situacao text, consertado_em timestamptz, o_que_foi_feito text
)
language sql stable set search_path to 'public' as $function$
with recusa as (
  select o.n_cod_os, o.c_num_os, o.c_cod_int_os, o.cnpj_cpf, o.n_cod_cli,
         o.valor, o.data_faturamento, o.nfse_mensagem,
         /* A RÉGUA, UMA VEZ SÓ. Ela governa o rótulo E a situação, que é o que
            impede os dois de discordarem. */
         (   o.nfse_mensagem ilike '%recusa do webservice%'
          or o.nfse_mensagem ilike '%indisponibilidade%'
          or o.nfse_mensagem ilike '%indisponível%'
          or o.nfse_mensagem ilike '%indisponivel%'
          /* As três de antes de `textoDaMensagem` anotar a conclusão. Ficam
             para as recusas já gravadas — não custa nada e não há por que
             reclassificar histórico. */
          or o.nfse_mensagem ilike '%403%'
          or o.nfse_mensagem ilike '%Nenhuma resposta%'
          or o.nfse_mensagem ilike '%sobrecarregados%') as instavel
  from public.nf_os_omie o
  where o.cancelada = false
    and o.nfse_status = '003'
    and coalesce(o.nfse_numero, '') = ''
    and o.carimbo_liberado_em is null
    and o.data_faturamento >= current_date - make_interval(days => greatest(p_dias, 1))
),
conserto as (
  select r.n_cod_os,
         max(k.criado_em) as consertado_em,
         (array_agg(k.resultado order by k.criado_em desc))[1] as resultado
  from recusa r
  join public.nf_cadastro_correcoes k
    on k.doc = r.cnpj_cpf
   and k.criado_em > r.data_faturamento::timestamptz
  where (k.resultado->'omie'->>'ok')::boolean is true
  group by r.n_cod_os
)
select r.n_cod_os, r.c_num_os, r.c_cod_int_os, r.cnpj_cpf,
       coalesce(en.nome, '—'),
       r.valor, r.data_faturamento,
       coalesce(r.nfse_mensagem, '(sem mensagem)'),
       case
         /* A INSTABILIDADE VEM PRIMEIRO, e essa ordem é a correção. Uma
            mensagem de webservice fora do ar pode conter qualquer coisa no
            corpo — inclusive um `E0240` de uma tentativa anterior citada no
            HTML —, e julgar pelo código antes de julgar pela natureza da
            resposta rotulava defeito de cadastro sobre um servidor caído. */
         when r.instavel then 'Instabilidade da prefeitura — reenviar resolve'
         when r.nfse_mensagem ilike '%E0240%'  then 'CEP do cliente não confere com o município'
         when r.nfse_mensagem ilike '%E0921%'
           or r.nfse_mensagem ilike '%E0922%'  then 'Código do município do cliente'
         when r.nfse_mensagem ilike '%E0207%'  then 'CPF não existe no cadastro da Receita'
         when r.nfse_mensagem ilike '%E1235%'  then 'Telefone do cliente inválido'
         when r.nfse_mensagem ilike '%falta preencher%' then 'Cadastro incompleto no Omie'
         else 'Ver mensagem da prefeitura'
       end,
       en.cep, en.cep_generico, en.cep_valido, en.emitivel,
       case
         when r.instavel then 'so_reenviar'
         when c.n_cod_os is not null then 'consertado'
         else 'precisa_de_gente'
       end,
       c.consertado_em,
       case
         when c.n_cod_os is null then null
         else concat_ws(', ',
           nullif(c.resultado->'omie'->'escrito'->>'endereco', ''),
           nullif(c.resultado->'omie'->'escrito'->>'endereco_numero', ''),
           nullif(c.resultado->'omie'->'escrito'->>'cep', ''))
       end
from recusa r
left join public.omie_clientes_endereco en on en.codigo = r.n_cod_cli
left join conserto c on c.n_cod_os = r.n_cod_os
order by r.data_faturamento desc, r.valor desc;
$function$;

revoke all on function public.nfse_recusas_a_tratar(integer) from public, anon;
grant execute on function public.nfse_recusas_a_tratar(integer) to authenticated, service_role;

comment on function public.nfse_recusas_a_tratar(integer) is
  'As NFS-e recusadas pela prefeitura, agrupadas pela AÇÃO que resolvem: '
  'so_reenviar (webservice fora do ar ou NFS-e Nacional indisponível — o '
  '"Devolver à esteira" basta), consertado (o cadastro foi corrigido depois da '
  'recusa) e precisa_de_gente (o resto). A régua de instabilidade governa o '
  'rótulo e a situação ao mesmo tempo, de propósito: escritas em dois lugares, '
  'elas se contradisseram.';
