/* ============================================================================
 * asaas_cache — o heap estreito, e por que o painel voltou a estourar o tempo.
 *
 * SINTOMA. "Não foi possível carregar o período · canceling statement due to
 * statement timeout" ao abrir /operacional/notas-fiscais. Na segunda tentativa
 * a tela abria normalmente — o que faz parecer soluço de rede, e não é.
 *
 * A MEDIDA. `pg_stat_statements` para `notas_fiscais_painel_json`: média 4,93 s,
 * máximo 7,38 s, mínimo 1,17 s. O `statement_timeout` do papel `authenticated`
 * no Supabase é 8 s. Ou seja: a chamada não estourava por acidente, ela vivia
 * a um segundo do teto e a variação normal do cache decidia a sorte de cada
 * abertura.
 *
 * A CAUSA, e ela não está no SQL do painel — está no formato da tabela:
 *
 *   heap de asaas_cache ............. 264 MB (130 mil linhas)
 *   shared_buffers da instância ..... 224 MB
 *   páginas tocadas numa abertura ... 32.995 buffers ≈ 264 MB
 *
 * Uma abertura do painel varre MAIS PÁGINAS DO QUE CABE NO CACHE INTEIRO do
 * banco. Não existe "ficar quente": qualquer sync do Asaas, qualquer outra tela,
 * expulsa as páginas, e a próxima abertura lê tudo do disco de novo.
 *
 * POR QUE 264 MB PARA 130 MIL LINHAS. O `dados` jsonb está INLINE no heap — a
 * TOAST desta tabela tem 8 KB, quer dizer, está vazia. A linha de `payment` tem
 * 1.605 bytes, dos quais 1.486 são o `dados`. Cabem ~4 linhas por página de
 * 8 KB. O efeito é que o jsonb se cobra mesmo quando ninguém o lê: um
 * `select count(*)` das 4.115 cobranças de agosto custa 5.664 buffers, e
 * `select tipo, count(*) from asaas_cache` levou 10,6 s medidos.
 *
 * TIRAR O JSONB DA PÁGINA foi a primeira ideia, e NÃO funciona — vale registrar
 * para ninguém tentar de novo. `toast_tuple_target` parece ser o botão disso,
 * mas ele regula o ALVO depois que o toaster entra, não a ENTRADA: o Postgres
 * só chama o toaster quando a tupla passa de `TOAST_TUPLE_THRESHOLD` (~2.032
 * bytes), e essa é constante de compilação. Numa reescrita o `dados` vem do heap
 * antigo já comprimido (1.486 B), a tupla nova dá ~1.725, não alcança a porta, e
 * fica inline. Medido: com `toast_tuple_target = 512` o heap foi de 264 MB para
 * 239 MB e a TOAST continuou com 248 kB — a diferença foi tupla morta que a
 * reescrita levou, não o jsonb saindo. O ajuste foi revertido ao padrão, porque
 * para linha NOVA ele VALERIA (o sync grava o jsonb cru, ~3,5 KB) e isso mudaria
 * por baixo o custo das funções que ainda leem `dados` inteiro.
 *
 * O QUE FUNCIONA, e é o que este arquivo faz: não impedir que a página seja
 * gorda, e sim PARAR DE PRECISAR DELA. Os campos que o painel lê linha a linha
 * viram coluna estreita — e aí some o custo que dominava, que não era ler a
 * página, era DESCOMPRIMIR o jsonb de 1,4 KB e varrer a árvore dele três vezes
 * por linha para tirar `description`, `customer` e `refunds`. É a mesma medicina
 * de 20260818190000 (`pagamento_ref`), agora para os outros campos.
 *
 *   painel .......... 2.124 ms → 93 ms
 *
 * O resto — fazer o painel não tocar no heap de jeito nenhum — é 20260827170000.
 *
 * POR QUE TUDO NUM ALTER SÓ. Adicionar coluna gerada STORED reescreve a tabela.
 * Dez colunas em dez comandos seriam dez reescritas de 264 MB, cada uma com lock
 * exclusivo.
 *
 * ARMADILHA DE MEDIÇÃO herdada de 20260818190000 e que continua valendo: logo
 * depois da reescrita as estatísticas estão velhas e o planejador escolhe mal.
 * O `analyze` no fim do arquivo não é enfeite.
 * ========================================================================== */


/* ------------------------------------------------------------------
 * 1) Os campos quentes, materializados — uma reescrita só
 * ------------------------------------------------------------------
 * GERADAS e não preenchidas pelas syncs, pelo mesmo motivo do `pagamento_ref`:
 * valem para as linhas que já existem e para as que `asaas-sync` e
 * `asaas-carga-historica` escreverem depois, sem que nenhuma das duas precise
 * saber que elas existem.
 *
 * Datas ficam como TEXTO de propósito: `texto::date` é STABLE (depende do
 * DateStyle da sessão) e o Postgres recusa expressão não-imutável em coluna
 * gerada. Quem precisa da data converte na hora — o custo que importava era
 * abrir o jsonb, e esse já não existe mais.
 *
 * Os dez campos saíram de uma varredura do `prosrc` das 11 funções que leem
 * `asaas_cache`: são todos os que aparecem em mais de uma. O que ficou de fora
 * é o endereço lido por `omie_clientes_a_criar`, que roda sobre um punhado de
 * clientes e pode pagar a ida à TOAST.
 */
alter table public.asaas_cache
  add column if not exists cliente_ref text
    generated always as (dados->>'customer') stored,
  add column if not exists assinatura_ref text
    generated always as (dados->>'subscription') stored,
  add column if not exists descricao text
    generated always as (dados->>'description') stored,
  add column if not exists documento text
    generated always as (regexp_replace(coalesce(dados->>'cpfCnpj',''), '[^0-9]', '', 'g')) stored,
  add column if not exists nome text
    generated always as (coalesce(dados->>'name', dados->>'company')) stored,
  add column if not exists email text
    generated always as (dados->>'email') stored,
  add column if not exists nota_numero text
    generated always as (dados->>'number') stored,
  -- Quantidade, e não booleano: `estornos > 0` responde a mesma pergunta que
  -- `jsonb_array_length(dados->'refunds') > 0` respondia, sem abrir o jsonb.
  add column if not exists estornos integer
    generated always as (
      case when jsonb_typeof(dados->'refunds') = 'array'
           then jsonb_array_length(dados->'refunds') else 0 end) stored,
  add column if not exists confirmado_em text
    generated always as (dados->>'confirmedDate') stored,
  add column if not exists pago_cliente_em text
    generated always as (dados->>'clientPaymentDate') stored;


/* ------------------------------------------------------------------
 * 3) Os índices sobre expressão, agora sobre coluna
 * ------------------------------------------------------------------
 * `asaas_cache_payment_customer_idx` indexava `(dados->>'customer')`; com a
 * coluna, o índice fica menor e a manutenção deixa de reabrir o jsonb a cada
 * escrita. O antigo sai só depois que o novo existe.
 */
create index if not exists asaas_cache_payment_cliente_ref_idx
  on public.asaas_cache (cliente_ref) where tipo = 'payment';

drop index if exists public.asaas_cache_payment_customer_idx;

-- Duplicata exata de `asaas_cache_pagamento_ref_idx`, criada antes da coluna
-- gerada existir: mesmo predicado, mesma chave, escrito de dois jeitos.
drop index if exists public.asaas_cache_invoice_payment_idx;


/* ------------------------------------------------------------------
 * 4) O painel, sem abrir o jsonb
 * ------------------------------------------------------------------
 * Mesma assinatura, mesma regra de classificação, mesmos números — só o caminho
 * até os campos mudou. `create or replace` porque o `returns table` não muda.
 */
create or replace function public.notas_fiscais_painel(p_de date, p_ate date)
returns table (
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text,
  valor numeric, data_vencimento date, data_pagamento date, status_asaas text,
  estornado boolean, nf_asaas_status text, nf_asaas_numero text,
  n_cod_os bigint, os_etapa text, os_faturada boolean,
  nfse_numero text, nfse_status text, nfse_xml text, nfse_chave text,
  nfse_mensagem text, situacao text
)
language sql stable security invoker set search_path = public as $$
with cfg as (select data_corte from public.nf_config where id = 1),
cob as (
  select c.id_asaas,
         c.descricao,
         c.cliente_ref as cus,
         c.valor, c.data_vencimento, c.data_pagamento, c.status,
         (c.status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS')
          or c.estornos > 0) as estornado,
         (c.status in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) as recebida,
         date_trunc('month', coalesce(c.data_vencimento, c.data_pagamento))::date as mes
  from public.asaas_cache c
  where c.tipo = 'payment'
    and coalesce(c.data_pagamento, c.data_vencimento) between p_de and p_ate
),
cli as (
  select c.id_asaas, c.documento as doc, c.nome
  from public.asaas_cache c
  where c.tipo = 'customer'
    and c.id_asaas in (select cus from cob where cus is not null)
),
nfa as (
  select distinct on (n.pagamento_ref)
         n.pagamento_ref as pay, n.status, n.nota_numero as numero
  from public.asaas_cache n
  where n.tipo = 'invoice'
    and n.pagamento_ref in (select id_asaas from cob)
  order by n.pagamento_ref,
           case upper(n.status) when 'AUTHORIZED' then 0 when 'ERROR' then 1 else 2 end,
           n.data_efetiva desc nulls last
),
os_exato as (
  select c_cod_int_os, n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false and c_cod_int_os is not null and c_cod_int_os <> ''
),
os_heur as (
  select distinct on (cnpj_cpf, valor, date_trunc('month', data_previsao))
         cnpj_cpf, valor,
         date_trunc('month', data_previsao)::date as mes,
         n_cod_os, etapa, faturada, nfse_numero, nfse_status, nfse_xml,
         nfse_verificacao, nfse_mensagem
  from public.nf_os_omie
  where cancelada = false
    and (c_cod_int_os is null or c_cod_int_os = '')
    and cnpj_cpf is not null and data_previsao is not null
  order by cnpj_cpf, valor, date_trunc('month', data_previsao), n_cod_os
)
select cob.id_asaas, cob.descricao, cli.nome, cli.doc, cob.valor,
       cob.data_vencimento, cob.data_pagamento, cob.status, cob.estornado,
       nfa.status, nfa.numero,
       coalesce(oe.n_cod_os, oh.n_cod_os),
       coalesce(oe.etapa, oh.etapa),
       coalesce(oe.faturada, oh.faturada),
       coalesce(oe.nfse_numero, oh.nfse_numero),
       coalesce(oe.nfse_status, oh.nfse_status),
       coalesce(oe.nfse_xml, oh.nfse_xml),
       coalesce(oe.nfse_verificacao, oh.nfse_verificacao),
       coalesce(oe.nfse_mensagem, oh.nfse_mensagem),
       case
         when not cob.recebida and not cob.estornado then 'nao_exige'
         when cob.estornado and (coalesce(oe.nfse_status, oh.nfse_status) = '004'
              or upper(coalesce(nfa.status,'')) = 'AUTHORIZED') then 'nota_a_cancelar'
         when not cob.recebida then 'nao_exige'
         when coalesce(oe.nfse_status, oh.nfse_status) = '004' then 'emitida_omie'
         when coalesce(oe.faturada, oh.faturada)
          and coalesce(oe.nfse_mensagem, oh.nfse_mensagem) is not null then 'nota_rejeitada'
         when coalesce(oe.faturada, oh.faturada) then 'em_processamento'
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED'
          and coalesce(cob.data_pagamento, cob.data_vencimento) < (select data_corte from cfg)
              then 'emitida_asaas'
         else 'falta'
       end
from cob
left join cli on cli.id_asaas = cob.cus
left join nfa on nfa.pay = cob.id_asaas
left join os_exato oe on oe.c_cod_int_os = cob.id_asaas
left join os_heur  oh on oe.n_cod_os is null
                     and oh.cnpj_cpf = cli.doc
                     and oh.valor = cob.valor
                     and oh.mes = cob.mes;
$$;

revoke all on function public.notas_fiscais_painel(date, date) from public, anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;


/* ------------------------------------------------------------------
 * 5) Estatísticas — ver a armadilha lá em cima
 * ------------------------------------------------------------------ */
analyze public.asaas_cache;
