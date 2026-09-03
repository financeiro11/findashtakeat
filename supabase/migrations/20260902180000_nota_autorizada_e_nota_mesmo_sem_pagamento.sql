-- NOTA AUTORIZADA É NOTA, MESMO SOBRE COBRANÇA NÃO PAGA
--
-- Este é o MESMO defeito de 31/08/2026 (`a_nota_do_asaas_depois_do_corte_tambem_e_nota`),
-- pela terceira vez e por outra porta. Lá, o ramo `emitida_asaas` exigia
-- `competência < data_corte` e a nota de agosto não tinha onde pousar: a tela
-- imprimia o número da nota na coluna "Nota" com o selo **"Sem nota"** ao lado.
-- Aqui, o ramo `nao_exige` é o PRIMEIRO do `case` e engole qualquer cobrança não
-- recebida — tenha nota ou não. O sintoma é idêntico, trocando o selo: o número
-- da nota impresso ao lado do selo **"Não exige"**.
--
-- O caso que revelou: `pay_2l683nmgtgavbhr6`, Banestes, R$ 52.588,16, vencendo
-- 10/09 e ainda pendente. O Asaas emitiu para ela a NFS-e **17579 em 31/08**, no
-- valor ANTIGO de R$ 52.855,16 — a última nota dele antes do desligamento, na
-- cadência de sempre. Uma nota autorizada, com chave de 50 dígitos, existindo no
-- portal nacional, classificada pelo Hub como "não exige nota".
--
-- A REGRA QUE JÁ ESTAVA ESCRITA E NÃO FOI SEGUIDA ATÉ O FIM: a `situacao`
-- responde **"esta cobrança tem nota fiscal?"**. Nota autorizada é nota, não
-- importa quem emitiu, quando, nem se o dinheiro entrou. `nao_exige` responde
-- outra pergunta — "esta cobrança vai gerar receita a tributar?" — e ela só vale
-- quando a primeira já respondeu "não tem nota".
--
-- POR QUE ISTO NÃO APARECEU ANTES, e por que aparece agora: até 02/09/2026,
-- cobrança PENDENTE com nota autorizada era uma combinação sem dono. Ninguém
-- olhava, porque o Hub não emitia sobre pendente e o Asaas era problema dele.
-- Com a régua de "nota antes do pagamento" (20260902150000), essa combinação
-- deixou de ser exceção e virou o ESTADO NORMAL de quatro clientes. É a lição de
-- [[nfse-fila-e-candidatas]] outra vez: **uma guarda pode estar errada por anos
-- sem sintoma se a população que a exercita não existe ainda.**
--
-- A SEGUNDA CONSEQUÊNCIA, que sozinha já justificaria a mudança: `faturada` e
-- `nfse_status='004'` também estavam atrás do `nao_exige`. Ou seja, a nota que
-- NÓS emitirmos hoje sobre uma cobrança pendente — que é exatamente o que a
-- régua nova faz — apareceria como "Não exige" enquanto estivesse no forno, e
-- como "Não exige" depois de autorizada. O painel esconderia o próprio trabalho.
--
-- IMPACTO MEDIDO ANTES DE APLICAR: são **3 cobranças** em todo o ano de 2026
-- (R$ 54.408,16) pendentes ou vencidas com nota autorizada, uma delas em
-- setembro. A mudança é cirúrgica; o que ela destrava é o botão "Refazer a nota",
-- que só aparece em `emitida_asaas`.

create or replace function public.notas_fiscais_painel(p_de date, p_ate date)
returns table(
  id_asaas text, descricao text, cliente_asaas text, cnpj_cpf text, valor numeric,
  data_vencimento date, data_pagamento date, status_asaas text, estornado boolean,
  nf_asaas_status text, nf_asaas_numero text, n_cod_os bigint, os_etapa text,
  os_faturada boolean, nfse_numero text, nfse_status text, nfse_xml text,
  nfse_chave text, nfse_mensagem text, situacao text
)
language sql
stable
set search_path to 'public'
as $function$
-- O CTE `cfg` saiu junto com a condição de data: a classificação não olha o
-- corte, e ler `nf_config` para não usar seria mentira de leitura.
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
         /* 1. O ESTORNO COM NOTA continua no topo. É o único caso em que a
            existência da nota é um PROBLEMA e não uma resposta: dinheiro
            devolvido com nota de pé é nota a cancelar. */
         when cob.estornado and (coalesce(oe.nfse_status, oh.nfse_status) = '004'
              or upper(coalesce(nfa.status,'')) = 'AUTHORIZED') then 'nota_a_cancelar'

         /* 2. "ESTA COBRANÇA TEM NOTA?" — a pergunta que a `situacao` responde,
            e que agora vem ANTES de "ela foi paga?". A ordem interna destes
            quatro não mudou: a nossa NFS-e primeiro, porque quando os dois
            emitiram é a nossa que a linha mostra. */
         when coalesce(oe.nfse_status, oh.nfse_status) = '004' then 'emitida_omie'
         when coalesce(oe.faturada, oh.faturada)
          and coalesce(oe.nfse_mensagem, oh.nfse_mensagem) is not null then 'nota_rejeitada'
         when coalesce(oe.faturada, oh.faturada) then 'em_processamento'
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED' then 'emitida_asaas'

         /* 3. Só agora "ela foi paga?". Sem nota em lugar nenhum e sem dinheiro,
            não há o que tributar — mas isso só se sabe depois de perguntar pela
            nota, nunca antes. A nota em ERROR/CANCELLED não conta e continua
            caindo aqui, de propósito: não existe no portal nacional. */
         when not cob.recebida then 'nao_exige'
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
$function$;

revoke all on function public.notas_fiscais_painel(date, date) from anon;
