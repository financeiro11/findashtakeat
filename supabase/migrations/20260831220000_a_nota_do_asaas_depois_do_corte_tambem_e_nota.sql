/* ---------------------------------------------------------------------------
 * A nota que o Asaas emitiu DEPOIS do corte também é nota.
 *
 * O SINTOMA, visto na tela em 31/08/2026: linhas com número de nota na coluna
 * "Nota" e o selo "Sem nota" ao lado. Flor de Sal (14508), Lunare (16616),
 * Pizza quadrada (16668) — todas com `invoice` AUTHORIZED no Asaas, todas
 * classificadas como `falta`.
 *
 * A CAUSA está na condição de data deste ramo:
 *
 *     when upper(nfa.status) = 'AUTHORIZED'
 *      and coalesce(data_pagamento, data_vencimento) < data_corte
 *          then 'emitida_asaas'
 *
 * Ela foi escrita quando o corte significava "daqui para frente quem emite
 * somos nós", e nessa leitura nota do Asaas depois do corte não existiria. Mas
 * existe: o PARALELO (`nf_config.paralelo_asaas`) mantém os dois emitindo ao
 * mesmo tempo de propósito, e das 2.040 assinaturas com cobrança recente 1.880
 * continuam sendo do Asaas. Com `data_corte = 2026-08-01`, TODA cobrança de
 * agosto cai depois do corte — e a nota que ele autorizou não tinha ramo onde
 * pousar, caindo no `else 'falta'`.
 *
 * O TAMANHO, medido em agosto/2026: das 3.007 "Sem nota" do mês, 1.035 têm
 * nota AUTHORIZED do Asaas. Um terço do buraco de R$ 1,29 mi era rótulo, não
 * receita sem nota.
 *
 * A CORREÇÃO é tirar a data da condição. A `situacao` responde "esta cobrança
 * tem nota fiscal?", e a resposta não depende de quem emitiu nem de quando: se
 * há NFS-e autorizada no portal, há. Quem responde "e de agora em diante, quem
 * emite?" é a fila (`notas_fiscais_fila_emissao`), que tem o corte na cláusula
 * dela e continua tendo.
 *
 * O QUE ISSO CONSERTA, nos três lugares onde a mesma classificação é lida:
 *   • o selo da linha passa a dizer "Emitida no Asaas" onde há nota do Asaas;
 *   • o KPI "Sem nota" para de contar 1.035 cobranças que têm nota — e com ele
 *     a cobertura do vigia (`sinal_cobertura_notas`), que soma `emitida_omie +
 *     emitida_asaas` e por isso não precisa mudar;
 *   • a caixa de seleção deixa de marcar essas linhas (`motivoBloqueio` barra
 *     `emitida_asaas`), e a auditoria passa a jogá-las no balde `nota_asaas` em
 *     vez de espalhá-las por `fila` / `sem_cadastro_omie`.
 *
 * NÃO É ISSO QUE IMPEDE A NOTA DUPLA, e nunca foi: quem impede é a fila (que
 * já não oferecia nenhuma delas — 0 de 636 na fila de hoje) e a porta ao vivo
 * `conferirNoAsaas`, que relê `/invoices?payment=` no instante da emissão. O
 * que muda aqui é o que a tela DIZ, e o que a pessoa consegue marcar antes de
 * bater na porta.
 *
 * A NOTA EM `ERROR` CONTINUA SENDO "SEM NOTA", e isso é o ponto: `ERROR` e
 * `CANCELLED` não existem no portal nacional. São as 171 de agosto que seguem
 * em `falta` porque de fato faltam. O `distinct on` do CTE `nfa` já ordena
 * AUTHORIZED na frente, então uma cobrança com as duas tentativas é lida pela
 * boa.
 *
 * `create or replace`: o `returns table` não muda, então as permissões e a
 * `notas_fiscais_painel_json` que depende dela ficam de pé.
 * ------------------------------------------------------------------------- */

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
-- O CTE `cfg` saiu junto com a condição de data: a classificação não olha mais
-- o corte, e ler `nf_config` para não usar seria mentira de leitura.
with cob as (
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
         -- A nota do Asaas, sem data: autorizada é autorizada. A ordem importa e
         -- não mudou — a nossa NFS-e (`004`) e a OS faturada continuam vindo
         -- antes, porque quando os dois emitiram é a nossa que a linha mostra.
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED' then 'emitida_asaas'
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


/* ---------------------------------------------------------------------------
 * O resumo ganha a metade que o corte escondia.
 *
 * `emitida_asaas` passa a somar os dois regimes, e sozinho ele não distingue
 * mais "o Asaas emitia" de "o Asaas AINDA está emitindo" — que é a pergunta do
 * paralelo, a que diz se dá para desligá-lo. Daí a chave nova: mesma conta,
 * recortada depois do corte. Ninguém depende dela ainda (a tela conta as
 * próprias linhas); ela existe para quem lê o resumo por SQL e para o dia em
 * que a tela quiser mostrar o placar do paralelo.
 * ------------------------------------------------------------------------- */

create or replace function public.notas_fiscais_resumo(p_de date, p_ate date)
returns jsonb
language sql stable security invoker set search_path = public as $$
select jsonb_build_object(
  'cobrancas', count(*),
  'valor_total', coalesce(sum(valor),0),
  'falta', count(*) filter (where situacao = 'falta'),
  'valor_falta', coalesce(sum(valor) filter (where situacao = 'falta'),0),
  'emitida_omie', count(*) filter (where situacao = 'emitida_omie'),
  'emitida_asaas', count(*) filter (where situacao = 'emitida_asaas'),
  'emitida_asaas_pos_corte', count(*) filter (
    where situacao = 'emitida_asaas'
      and coalesce(data_pagamento, data_vencimento) >= (select data_corte from public.nf_config where id = 1)),
  'nota_rejeitada', count(*) filter (where situacao = 'nota_rejeitada'),
  'em_processamento', count(*) filter (where situacao = 'em_processamento'),
  'nota_a_cancelar', count(*) filter (where situacao = 'nota_a_cancelar'),
  'nao_exige', count(*) filter (where situacao = 'nao_exige')
) from public.notas_fiscais_painel(p_de, p_ate);
$$;

revoke all on function public.notas_fiscais_resumo(date, date) from public, anon;
grant execute on function public.notas_fiscais_resumo(date, date) to authenticated, service_role;
