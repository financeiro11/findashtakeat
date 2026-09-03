-- A cobrança já paga deixa de assustar quem pagou.
--
-- Pedido do usuário em 02/09/2026, com a tela do portal do Omie na mão: a OS 2635
-- (Casa de Carnes Luana, R$ 390, NFS-e 18270) mostrando "Atrasada" em vermelho e
-- oferecendo "Outra forma de pagamento" para uma cobrança que o cliente liquidou
-- no Asaas em fevereiro. O link daquela página é o mesmo que a emissão manda por
-- e-mail (`cEnvLink: "S"` no payload da OS). Ou seja: a nota chega ao cliente
-- acompanhada de um pedido de pagamento do dinheiro que ele já pagou.
--
-- ===========================================================================
-- DE ONDE VEM O "ATRASADA"
--
-- Não é da nota — é da PARCELA que a OS carrega. `montarOS` escreve
-- `Parcelas: [{ dDtVenc: <vencimento original do Asaas> }]`, e ao faturar o Omie
-- abre um título a receber em aberto naquela data. Como a fila emite nota de
-- cobrança antiga (a mais velha vence em 19/11/2025), o título nasce vencido.
--
-- Medido no dia: 1.428 OS com nota autorizada e vencimento no passado, somando
-- R$ 592.364,65 de dívida aparente. 1.023 delas já saíram com o link por e-mail.
--
-- ===========================================================================
-- POR QUE BAIXAR, E POR QUE NESTA CONTA
--
-- A decisão do financeiro foi explícita: "se já foi recebido no Asaas e só falta
-- a nota, essa cobrança tem que ir como paga". Então o título não some — ele é
-- baixado, e o cliente passa a ver "Recebida".
--
-- A contrapartida é `nCodCC 5481161165` = "Adiantamento de Cliente", que é o
-- conceito exato do que aconteceu (o cliente pagou antes de a nota existir) e
-- que está com `incluir: false` em `omie_caixa_conta` — o saldo dela não entra
-- no caixa do painel. É isso que permite baixar 1.428 títulos sem inventar
-- R$ 592 mil de dinheiro em conta bancária. Baixar no Sicoob ou no ASAAS
-- Disponível dobraria um caixa que já registrou esse dinheiro.
--
-- FICA UM FIO SOLTO, DE PROPÓSITO: a receita do Asaas entra no Omie como um
-- título consolidado mensal ("Lancamentos Asaas pago", categoria 1.01.03 —
-- R$ 1,17 mi em jul/26), e cada OS entra na MESMA categoria 1.01.03. Pelo que
-- se lê aqui, a receita está sendo reconhecida duas vezes. A baixa não cria nem
-- resolve isso; foi separada da urgência a pedido do financeiro e continua em
-- aberto.
--
-- ===========================================================================
-- POR QUE A MARCA MORA NO ESPELHO
--
-- O Omie não devolve "este título veio da OS tal" de graça: achar o título custa
-- um `ListarContasReceber` por cliente. Sem carimbar o que já foi baixado, uma
-- segunda rodada refaz as 1.428 buscas para descobrir que não há o que fazer —
-- e a trava por método do Omie transforma isso em rodada perdida.
--
-- `titulo_cod` guarda o achado mesmo quando a baixa falha: da segunda vez a
-- busca é pulada e só o `LancarRecebimento` é repetido.

alter table public.nf_os_omie
  add column if not exists titulo_cod             bigint,
  add column if not exists titulo_baixado_em      timestamptz,
  add column if not exists titulo_baixa_erro      text,
  add column if not exists titulo_baixa_tentativas int not null default 0;

comment on column public.nf_os_omie.titulo_cod is
  'codigo_lancamento_omie do título a receber que o faturamento desta OS gerou. Guardado mesmo com baixa falha, para não repetir a busca.';
comment on column public.nf_os_omie.titulo_baixado_em is
  'Quando o título foi baixado em "Adiantamento de Cliente". Nulo = o cliente ainda vê "Atrasada" no portal.';
comment on column public.nf_os_omie.titulo_baixa_erro is
  'A frase do Omie na última recusa. Preenchido não impede nova tentativa — é o que explica a fila que não anda.';

-- A fila da varredura: OS com nota autorizada, vencimento no passado e sem baixa.
-- Parcial porque é exatamente o conjunto que a rodada lê, e ele encolhe até zero.
create index if not exists nf_os_omie_baixa_pendente_idx
  on public.nf_os_omie (data_previsao)
  where titulo_baixado_em is null and nfse_status = '004' and not cancelada;
