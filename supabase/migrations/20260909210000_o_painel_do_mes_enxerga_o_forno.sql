/* ============================================================================
 * O PAINEL DO MÊS ENXERGA O FORNO — o que acabou de ser despachado deixa de
 * dizer "Sem nota".
 *
 * O QUE ACONTECIA. A `situacao` do painel saía inteira do ESPELHO das OS
 * (`nf_os_omie`): "em_processamento" é `faturada = true` com o RPS ainda sem
 * número. Só que `faturada` só fica verdadeiro quando o `omie-nfse-sync` volta
 * ao Omie e relê o `StatusOS` — e entre o disparo do lote e essa releitura
 * passam MINUTOS. Nessa janela a cobrança tem lote na rua e o painel do mês
 * escreve "Sem nota", em vermelho.
 *
 * Medido em 09/09/2026, na Véspera (`pay_b2b8l05efm6ocvim`): às 11:51:50 o lote
 * 5519092193 saiu com a OS 5519090302 dentro; às 11:56:16 o Omie recusou o
 * faturamento por endereço sem número. Nesses quatro minutos o Registro de
 * emissões mostrava "No forno" e o Painel do mês, a MESMA cobrança, "Sem nota"
 * — duas abas da mesma tela dizendo coisas contrárias sobre a mesma linha.
 *
 * POR QUE ISSO É CARO, e não só feio: "Sem nota" é um convite a emitir. Quem
 * olha o painel e vê vermelho manda de novo — e a segunda nota do mesmo serviço
 * não se apaga, cancela-se com prazo e justificativa. A guarda da tela
 * (`motivoBloqueio`) já recusa a linha `em_processamento`; ela só nunca chegava
 * a ser consultada, porque a situação dizia outra coisa.
 *
 * A SEGUNDA FONTE. O diário (`nf_emissoes`) sabe do lote no INSTANTE do
 * disparo — é ele quem grava `em_processamento`. Então a situação passa a olhar
 * os dois lados: o espelho, que é a verdade do Omie, e o diário, que é a verdade
 * do que acabamos de mandar. O espelho continua com a palavra final (vem antes
 * no CASE, e nota autorizada em qualquer um dos dois vem antes dos dois); o
 * diário só fala onde o espelho ainda está calado.
 *
 * O FORNO TEM PRAZO — 2h, o mesmo número do `HORAS_NO_FORNO` do Registro de
 * emissões (src/pages/operacional/NotasFiscaisLog.tsx), e pela mesma razão: o
 * lote fecha em ~2min e o RPS vira nota autorizada em mais ~1min. Passadas
 * horas, "está saindo" deixou de ser uma leitura possível do mesmo dado — em
 * 26/08/26 eram 16 cobranças (R$ 6.257) em âmbar desde a véspera, 15 recusadas
 * pelo Omie no próprio faturamento, e nenhuma ia sair nunca. Fora da janela a
 * classificação volta a ser a de sempre, e para essas ela é "Sem nota" — que aí
 * é verdade, e é o convite certo: conserte o cadastro e mande de novo.
 *
 * QUAIS PASSOS CONTAM: só os que DESPACHAM (`faturar`, `criar_e_faturar`,
 * `refazer`) — é a mesma lista que o `fecharEmProcessamento` da edge function usa
 * para achar a linha em aberto, e é ela que fecha essas linhas com `ok` ou
 * `erro` quando o desfecho aparece. `criar_os` é passo e não despacho ("a OS
 * existe no Omie, mas deste passo não sai nota"), e `previa`/`email` não são
 * desfecho de emissão nenhum.
 *
 * `notas_fiscais_painel_json` e `notas_fiscais_resumo` embrulham esta função —
 * não precisam ser tocadas, e o chip "Em processamento" e o resumo do mês passam
 * a contar o forno junto por consequência.
 * ========================================================================== */

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
),
/* O FORNO, LIDO DO DIÁRIO — o que está na rua e o espelho ainda não sabe.
 *
 * A janela de 2h vem ANTES do `distinct on`, e isso é seguro: o que ela corta é
 * sempre mais VELHO do que o que ela deixa passar, então o passo mais recente
 * dentro da janela é o passo mais recente da cobrança, ponto. E é ela que faz
 * este CTE custar quase nada — `nf_emissoes_data_idx` é `(criado_em desc)`, e
 * duas horas de diário são dezenas de linhas num diário de onze mil.
 */
forno as (
  select id_asaas
  from (
    select distinct on (e.id_asaas) e.id_asaas, e.resultado
    from public.nf_emissoes e
    where e.criado_em >= now() - interval '2 hours'
      and e.acao in ('faturar', 'criar_e_faturar', 'refazer')
    order by e.id_asaas, e.criado_em desc
  ) ultimo
  where ultimo.resultado = 'em_processamento'
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
            e que vem ANTES de "ela foi paga?". A ordem interna destes quatro não
            mudou: a nossa NFS-e primeiro, porque quando os dois emitiram é a
            nossa que a linha mostra. */
         when coalesce(oe.nfse_status, oh.nfse_status) = '004' then 'emitida_omie'
         when coalesce(oe.faturada, oh.faturada)
          and coalesce(oe.nfse_mensagem, oh.nfse_mensagem) is not null then 'nota_rejeitada'
         when coalesce(oe.faturada, oh.faturada) then 'em_processamento'
         when upper(coalesce(nfa.status,'')) = 'AUTHORIZED' then 'emitida_asaas'

         /* 2b. E, DEPOIS DE PERGUNTAR PELA NOTA, "já mandamos esta?". O espelho
            responde pelo Omie e demora; o diário responde por nós e é imediato.
            Fica aqui embaixo dos quatro de propósito: nota que existe — nossa ou
            do Asaas — é resposta melhor do que nota que está nascendo. */
         when forno.id_asaas is not null then 'em_processamento'

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
                     and oh.mes = cob.mes
left join forno on forno.id_asaas = cob.id_asaas;
$function$;

comment on function public.notas_fiscais_painel(date, date) is
  'Cobrancas do Asaas do periodo cruzadas com a NFS-e do Omie. A situacao le TRES fontes: o espelho das OS (nf_os_omie), a nota do Asaas (asaas_cache tipo=invoice) e o diario de emissoes (nf_emissoes). O diario entra so para o forno — lote despachado ha menos de 2h cuja ultima palavra ainda e em_processamento —, porque entre o disparo e a releitura do StatusOS a cobranca ficava classificada como "Sem nota", que e um convite a emitir a segunda nota do mesmo servico.';

revoke all on function public.notas_fiscais_painel(date, date) from anon;
grant execute on function public.notas_fiscais_painel(date, date) to authenticated, service_role;
