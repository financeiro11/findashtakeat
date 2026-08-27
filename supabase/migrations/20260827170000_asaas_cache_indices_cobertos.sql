/* ============================================================================
 * asaas_cache — os índices que cobrem o painel, para o heap sair do caminho.
 *
 * CONTINUAÇÃO DIRETA de 20260827160000, que materializou os campos quentes e
 * levou o painel de 2.124 ms para 93 ms quente. (Lá está registrado por que
 * `toast_tuple_target` NÃO serve para tirar o jsonb da página — e o `reset` no
 * fim deste arquivo é o que desfaz aquela tentativa no banco que já a recebeu.)
 *
 * O QUE SOBROU, e é o que fazia a tela estourar: 20.612 buffers ≈ 165 MB por
 * abertura, contra 224 MB de `shared_buffers`. Quente são 93 ms; frio, os mesmos
 * buffers custaram 1,6 ms cada. Não adianta ser rápido quando o cache colabora
 * se o dia começa com ele frio.
 *
 * A SAÍDA é não tocar no heap. Com os campos quentes já em coluna estreita, um
 * índice que os CARREGUE JUNTO (`include`) responde o painel inteiro sem abrir
 * uma página de tabela: ~15 MB de índice no lugar de 165 MB de heap — e 15 MB
 * ficam no cache o dia inteiro.
 *
 * O `vacuum` no fim NÃO é higiene: `index only scan` só dispensa o heap nas
 * páginas marcadas como all-visible no mapa de visibilidade, e a reescrita de
 * 20260827160000 deixou o mapa zerado. Sem ele, os índices existem e o
 * planejador continua indo ao heap. (Roda fora do arquivo, porque `vacuum` não
 * aceita transação e o CLI roda o arquivo inteiro dentro de uma.)
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) As cobranças do mês — o recorte que abre a tela
 * ------------------------------------------------------------------
 * Chave: a MESMA expressão do recorte (`coalesce(pagamento, vencimento)`), que
 * já era índice desde 20260818190000. O que muda é o `include`: os oito campos
 * que o CTE `cob` lê, para a varredura terminar dentro do índice.
 */
create index if not exists asaas_cache_painel_cobranca_idx
  on public.asaas_cache ((coalesce(data_pagamento, data_vencimento)))
  include (id_asaas, valor, status, data_pagamento, data_vencimento,
           descricao, cliente_ref, estornos)
  where tipo = 'payment';

drop index if exists public.asaas_cache_payment_competencia_idx;


/* ------------------------------------------------------------------
 * 2) Os clientes citados — nome e documento sem ir à tabela
 * ------------------------------------------------------------------
 * Eram 2.836 idas ao heap pela chave primária, 11.264 buffers espalhados por
 * 239 MB. Aqui viram 2.836 sondagens num índice de ~500 KB.
 */
create index if not exists asaas_cache_painel_cliente_idx
  on public.asaas_cache (id_asaas)
  include (documento, nome)
  where tipo = 'customer';


/* ------------------------------------------------------------------
 * 3) A nota do Asaas — o maior consumidor isolado
 * ------------------------------------------------------------------
 * 4.110 sondagens que devolviam a linha inteira (width=1485) para ler dois
 * campos: 14.042 buffers. Superset exato de `asaas_cache_pagamento_ref_idx`,
 * que sai junto por ter virado prefixo deste.
 */
create index if not exists asaas_cache_painel_nota_idx
  on public.asaas_cache (pagamento_ref)
  include (status, nota_numero, data_efetiva)
  where tipo = 'invoice';

drop index if exists public.asaas_cache_pagamento_ref_idx;


/* ------------------------------------------------------------------
 * 4) O TOAST volta ao padrão
 * ------------------------------------------------------------------
 * Ele não resolveu o acervo (ver 20260827160000), e para linha NOVA resolveria —
 * mas resolver ali significa mudar POR BAIXO o custo das funções que ainda leem
 * `dados` inteiro (`notas_fiscais_fila_emissao`, `nfse_cadastros_a_preparar`,
 * `asaas_metricas`), que não foram convertidas nesta leva. Mudança silenciosa em
 * caminho que ninguém mediu é como o problema deste arquivo nasceu.
 */
alter table public.asaas_cache reset (toast_tuple_target);


analyze public.asaas_cache;
