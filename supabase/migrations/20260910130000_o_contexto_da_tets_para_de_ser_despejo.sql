/* O CONTEXTO DA TETS PARA DE SER DESPEJO DE TABELA
 * ---------------------------------------------------------------------------------------
 * 09/09/2026. Medido nos `edge_logs`, o runtime da agente (user agent `python-httpx`, que
 * roda FORA deste repositório) carrega a cada rodada, sem filtro:
 *
 *   GET /rest/v1/omie_titulos?select=cod_titulo,valor,vencimento,status,fornecedor_id,
 *       favorecido_texto,documento_norm,numero_documento,categoria_codigo,observacao
 *       &tipo=eq.pagar&vencimento=gte.<-180d>&vencimento=lte.<+3d>
 *       &status=in.(aberto,atrasado,parcial)&order=vencimento.asc&limit=500   → 144,6 KB
 *   GET /rest/v1/lib_fornecedores?select=id,omie_id,documento_norm,tags&limit=5000 → 55,2 KB
 *
 * São ~50 mil tokens que entram no prompt e são REENVIADOS EM TODO PASSO do laço — cada
 * passo do agente é uma ida inteira ao modelo. Na conta de 7 dias (113 milhões de tokens
 * em 1.082 chamadas, 104 mil por chamada) isso sozinho responde por cerca de metade.
 *
 * Três defeitos, e o terceiro é o que assusta:
 *
 *   1. JSON gasta mais da METADE dos bytes repetindo nome de chave — 289 bytes por título,
 *      ~155 deles estrutura. Um CSV com cabeçalho único diz o mesmo em 45% do tamanho.
 *   2. Ele carrega as 471 linhas de `lib_fornecedores` só para saber o NOME de quem está no
 *      título. É um join, e join se faz no banco.
 *   3. `limit=500` sobre 587 candidatos: 87 títulos ficam de fora, sem erro, sem aviso.
 *      A agente decide sobre uma realidade recortada e não tem como saber disso.
 *      Mesma família de armadilha do teto de 1.000 linhas do PostgREST.
 *
 * Além disso: nesses 587 títulos, `favorecido_texto`, `documento_norm` e `observacao` estão
 * VAZIOS em 100% das linhas. Três das dez colunas pedidas não têm nada dentro — o nome e o
 * CNPJ moram no fornecedor, que é justamente o que o join resolve.
 *
 * ESTA FUNÇÃO É A METADE QUE DÁ PARA FAZER DAQUI. A outra metade é uma linha no runtime:
 * trocar as duas chamadas REST por
 *     POST /rest/v1/rpc/agente_contexto   {"p_dias_atras": 180, "p_dias_frente": 3}
 * e parar de mandar `lib_fornecedores` no prompt — o nome já vem no CSV.
 *
 * O QUE ELA NÃO FAZ, de propósito: não decide o que a agente precisa ver. A janela continua
 * a mesma (180 dias atrás, 3 à frente) para que a troca seja drop-in e comparável. Encolher
 * a janela é a próxima economia, e é decisão de quem opera a agente, não do banco.
 */

create or replace function public.agente_contexto(
  p_dias_atras  integer default 180,
  p_dias_frente integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with tit as (
    select
      t.cod_titulo,
      to_char(t.vencimento, 'DD/MM/YYYY')                                   as vencimento,
      to_char(t.valor, 'FM999999990.00')                                    as valor,
      t.status,
      /* O NOME CRU, e não o apelido. A agente fala com o Omie, e é o nome cru que se
         procura lá — o apelido é convenção de tela deste Hub. */
      coalesce(nullif(t.favorecido_texto, ''), f.nome, '?')                 as fornecedor,
      coalesce(nullif(t.documento_norm, ''), f.documento_norm, '')          as cnpj,
      coalesce(t.categoria_codigo, '')                                      as categoria,
      coalesce(t.numero_documento, '')                                      as documento
    from omie_titulos t
    left join lib_fornecedores f on f.id = t.fornecedor_id
    where t.tipo = 'pagar'
      and t.vencimento >= current_date - p_dias_atras
      and t.vencimento <= current_date + p_dias_frente
      and t.status in ('aberto', 'atrasado', 'parcial')
    order by t.vencimento asc
    /* SEM LIMIT. Ver o defeito 3 lá em cima: cortar em silêncio é pior do que devolver
       linhas demais, porque quem lê não fica sabendo do corte. Se um dia isto crescer a
       ponto de doer, o remédio é encolher a JANELA (que o chamador escolhe), não voltar a
       cortar por baixo. */
  ),
  linhas as (
    select string_agg(
      /* `;` como separador e limpo dos campos de texto: nome de fornecedor tem vírgula
         ("LTDA, ME") com frequência e ponto-e-vírgula quase nunca. Quebra de linha dentro
         do campo destruiria o formato, então some também. */
      concat_ws(';',
        cod_titulo, vencimento, valor, status,
        translate(fornecedor, ';' || chr(10) || chr(13), '   '),
        cnpj, categoria, translate(documento, ';' || chr(10) || chr(13), '   ')
      ), chr(10) order by vencimento, cod_titulo
    ) as csv,
    count(*)::int as n
    from tit
  ),
  exc as (
    select coalesce(string_agg(format('%s=%s', tipo, n), '; ' order by n desc), 'nenhuma') as resumo,
           coalesce(sum(n), 0)::int as total
    from (
      select tipo, count(*)::int as n
        from agente_excecoes where status = 'aberta'
       group by tipo
    ) x
  )
  select jsonb_build_object(
    'gerado_em', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    'janela', format('vencimento de %s a %s',
                     to_char(current_date - p_dias_atras, 'DD/MM/YYYY'),
                     to_char(current_date + p_dias_frente, 'DD/MM/YYYY')),
    'titulos_cabecalho', 'cod_titulo;vencimento;valor;status;fornecedor;cnpj;categoria;documento',
    'titulos_csv', coalesce(linhas.csv, ''),
    'titulos_n', linhas.n,
    'excecoes_abertas', exc.resumo,
    'excecoes_n', exc.total,
    /* Para quem for medir a economia sem precisar contar caractere na mão. */
    'bytes', length(coalesce(linhas.csv, ''))
  )
  from linhas, exc;
$$;

comment on function public.agente_contexto(integer, integer) is
  'Contexto de contas a pagar para a TETS, em CSV e com o nome do fornecedor já resolvido. '
  'Substitui o despejo de omie_titulos + lib_fornecedores no prompt do agente.';

revoke execute on function public.agente_contexto(integer, integer) from anon;
grant execute on function public.agente_contexto(integer, integer) to authenticated, service_role;
