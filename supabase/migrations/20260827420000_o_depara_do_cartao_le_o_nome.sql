/* ==========================================================================
 * O de-para do cartão passa a aprender pelo NOME, não pelo valor.
 *
 * O QUE ESTAVA ERRADO
 * `cartao_omie_titulos()` devolve título do Omie sem nome de lojista — a
 * contraparte de todo gasto de cartão é o carimbo "Lancamento Fatura Cartao".
 * Sem nome, `casar()` (src/lib/cartao/depara.ts) tinha de adivinhar por VALOR
 * exato + data ±45 dias. Valor é um proxy fraco, e o erro é silencioso: em
 * 27/08/2026 o de-para em produção dizia
 *
 *     GOOGLE ADS    → 2.02.92  "3.2.7.1 Pessoal - Onboarding"   (4 de 7 votos)
 *     GOL LINHAS A  → 2.02.91  "3.1.4.1 Softwares - Comercial"  (3 de 5 votos)
 *
 * quando os 59 títulos de Google Ads que a analista lançou à mão estão, TODOS,
 * em 2.02.95 "3.1.3.7 Adsense - Marketing". A sugestão errada chegava à tela
 * com selo de confiança e ninguém tinha por que desconfiar.
 *
 * A FONTE CERTA JÁ ESTAVA NO BANCO
 * `omie_titulo_texto.observacao` guarda o texto do título, e num gasto de cartão
 * esse texto É o MEMO da fatura — o mesmo de colunas posicionais que
 * `_shared/cartao-memo.ts` já sabe ler:
 *
 *   Conta a Pagar importada automaticamente em 04/08/2026 às 12:51.
 *   |OPENAI *CHATGPT SUBS          OPENAI.COM - R$ 525,00  U$ 102,79
 *
 * Nos títulos parcelados lançados à mão não há o "|" nem o prefixo: a observação
 * inteira é o MEMO ("MERCADOLIVRE*MERCADO  01/12   LIMEIRA"). `memoDaObservacao`
 * trata os dois casos, e por isso esta função NÃO filtra por "|" — exigir o pipe
 * jogaria fora 793 dos 2.639 títulos aproveitáveis (medido em 27/08/2026).
 *
 * Assim o par (nome → categoria) é LIDO, não inferido. Não sobra ambiguidade
 * para desempatar.
 *
 * ONDE ESTA FUNÇÃO NÃO DECIDE NADA
 * Ela devolve `contraparte` e `observacao` crus e deixa `lojistaDoTitulo()`
 * dizer o que é lojista de cartão e qual é o nome. O filtro por nome de
 * contraparte no WHERE abaixo é só para não trafegar 5 mil títulos que serão
 * descartados no cliente — quem tem a palavra final continua sendo o único
 * leitor de MEMO do repositório, não um LIKE em SQL.
 * ========================================================================== */


/* ============================================================
 *  Os títulos de cartão com o texto que diz o lojista
 * ============================================================
 * Paginada porque são ~2.6 mil linhas e a API corta consultas grandes. A ordem
 * é por `cod_titulo`, que é único: sem ordem TOTAL, a fronteira entre duas
 * páginas repete uma linha e engole outra, e o de-para aprenderia com um
 * histórico furado (o mesmo cuidado que o laço de `cartao_lancamentos` já toma).
 *
 * `nao_gerado_pelo_hub` é a trava contra o de-para aprender da PRÓPRIA saída.
 * Assim que o Hub começar a lançar, os títulos que ele criou entram no cache do
 * Omie com a categoria que esta tela sugeriu. Reaprender sobre eles faria um
 * chute de baixa confiança voltar no mês seguinte como "unânime, 40 votos" —
 * o erro deixaria de ser corrigível porque estaria se citando. `cartao_envios_omie`
 * é o registro de tudo que o Hub criou lá, e é por ele que se exclui.
 */
create or replace function public.cartao_omie_lojistas(
  p_offset int default 0,
  p_limite int default 1000
)
returns table (
  cod_titulo          text,
  data                date,
  valor               numeric,
  codigo_categoria    text,
  descricao_categoria text,
  contraparte         text,
  observacao          text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cat as (
    select c->>'codigo' as codigo, c->>'descricao' as descricao
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'categorias'
  ),
  cli as (
    select distinct on (c->>'codigo') c->>'codigo' as codigo, c->>'nome' as nome
    from omie_cache, lateral jsonb_array_elements(dados) c
    where chave = 'clientes'
    order by c->>'codigo'
  ),
  mov as (
    select distinct on (m->'detalhes'->>'nCodTitulo') m->'detalhes' as det
    from omie_cache, lateral jsonb_array_elements(dados) m
    where chave = 'movimentos'
      and m->'detalhes'->>'nValorTitulo' is not null
      and m->'detalhes'->>'cGrupo' = 'CONTA_A_PAGAR'
      and nullif(m->'detalhes'->>'cCodCateg', '') is not null
    order by m->'detalhes'->>'nCodTitulo'
  )
  select
    det->>'nCodTitulo' as cod_titulo,
    to_date(nullif(coalesce(det->>'dDtRegistro', det->>'dDtEmissao', det->>'dDtPrevisao'), ''), 'DD/MM/YYYY') as data,
    (det->>'nValorTitulo')::numeric as valor,
    det->>'cCodCateg' as codigo_categoria,
    cat.descricao as descricao_categoria,
    cli.nome as contraparte,
    t.observacao
  from mov
  join public.omie_titulo_texto t
    on t.cod_titulo = (det->>'nCodTitulo')::bigint
  left join cat on cat.codigo = det->>'cCodCateg'
  join cli on cli.codigo = det->>'nCodCliente'
  where nullif(btrim(coalesce(t.observacao, '')), '') is not null
    -- Prefiltro de tráfego, não de verdade: espelha `ehCartao()`, que continua
    -- sendo quem decide no cliente. Pega "Lancamento Fatura Cartao" (2.678
    -- movimentos) e "Lancamento cartão itau" (10).
    and translate(lower(cli.nome), 'ãáàâçéêíóôõú', 'aaaaceeioou') like '%cartao%'
    and translate(lower(cli.nome), 'ãáàâçéêíóôõú', 'aaaaceeioou') ~ '(lancamento|fatura)'
    -- Nada que o próprio Hub criou. Ver a nota acima.
    and not exists (
      select 1 from public.cartao_envios_omie e
      where e.cod_titulo = det->>'nCodTitulo'
    )
  order by det->>'nCodTitulo'
  offset greatest(p_offset, 0)
  limit least(greatest(p_limite, 1), 5000);
$$;


/* ============================================================
 *  Permissões
 * ============================================================
 * Função nova em `public` nasce chamável por `anon` (o grant vem do papel
 * PUBLIC). Esta lê categoria e observação de conta a pagar — revogar de `anon`
 * é obrigatório, nominalmente, como as demais deste módulo.
 */
revoke all on function public.cartao_omie_lojistas(int, int) from public;
revoke all on function public.cartao_omie_lojistas(int, int) from anon;
grant execute on function public.cartao_omie_lojistas(int, int) to authenticated;

comment on function public.cartao_omie_lojistas(int, int) is
  'Títulos de cartão do Omie com a observação que carrega o MEMO da fatura — a '
  'fonte do de-para lojista→categoria. Exclui o que o próprio Hub lançou, para '
  'o aprendizado não se citar. O nome do lojista sai de lojistaDoTitulo() no '
  'cliente, nunca daqui.';
