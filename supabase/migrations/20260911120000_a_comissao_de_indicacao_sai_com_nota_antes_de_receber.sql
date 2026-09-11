-- A COMISSÃO DE INDICAÇÃO SAI COM NOTA ANTES DE RECEBER
--
-- Pedido de 11/09/2026, a partir de uma cobrança concreta: R$ 350 em boleto,
-- vencendo 15/09, descrição "Referente a indicação para cliente". É comissão que
-- um parceiro nos deve por um cliente que indicamos, e o processo é o inverso do
-- da mensalidade — o boleto e a NOTA saem juntos, antes de qualquer dinheiro
-- entrar. Acontece de vez em quando e sempre assim.
--
-- A RÉGUA QUE ISSO PEDE JÁ EXISTE, e é o ponto: não se cria uma quarta. A de
-- `nf_nota_antes_do_pagamento` (migration 20260902150000) alcança PENDING e
-- OVERDUE para quem está na lista, exige motivo escrito e NÃO entra na fila
-- automática — cada nota sai de um clique, o que é exatamente o que uma comissão
-- ocasional pede. E fiscalmente nada muda: a comissão entra na mesma
-- classificação de serviço das mensalidades (decisão do Henrique, 11/09/2026),
-- então o molde do `montarOS` continua servindo sem uma linha de diferença.
--
-- O QUE FALTAVA É O SENTIDO, e é por isso que isto é uma migration e não um
-- `insert`. A lista nasceu com uma população só — quatro clientes cujo processo
-- interno exige a nota para liberar o pagamento — e o Hub inteiro escreve essa
-- frase na cara: o selo da linha no painel, o aviso antes de emitir, o corpo do
-- sinal que o sino acende às 8h. Dita sobre um parceiro que nos paga comissão, a
-- frase é falsa nas duas pontas: ele não precisa da nota para pagar, e não é ele
-- quem está esperando — somos nós que emitimos junto com a cobrança.
--
-- Duas populações, uma régua, dois motivos. `tipo` é o que separa as duas sem
-- duplicar a régua. Sem ele a lista viraria folclore pelo outro lado: daqui a um
-- ano, um CNPJ ali dentro e ninguém sabendo se é cliente que paga contra nota ou
-- parceiro que nos deve comissão — que são coisas opostas com a mesma trava.
--
-- O RAIO DA LISTA É POR CNPJ, e continua sendo (decisão do Henrique: "para o
-- PARCEIRO, em lista"). Vale dizer em voz alta o que isso implica, porque a tela
-- passa a dizer: parceiro que TAMBÉM é cliente nosso — e há vários, o Sampa
-- Burger indica e assina — fica com a mensalidade pendente destravada junto. Não
-- é vazamento: nenhuma delas sai sozinha, todas continuam exigindo o clique.

alter table public.nf_nota_antes_do_pagamento
  add column if not exists tipo text not null default 'paga_contra_nota';

/* O `drop` antes do `add` deixa a migration repetível sem herdar uma versão
   velha da lista de valores — é o mesmo cuidado do `drop function` da 20260902150000,
   por outro motivo: aqui o que sobreviveria não é uma assinatura ambígua, é uma
   restrição que recusa o valor novo. */
alter table public.nf_nota_antes_do_pagamento
  drop constraint if exists nf_nota_antes_tipo_conhecido;
alter table public.nf_nota_antes_do_pagamento
  add constraint nf_nota_antes_tipo_conhecido
  check (tipo in ('paga_contra_nota', 'comissao'));

comment on column public.nf_nota_antes_do_pagamento.tipo is
  'Por que a nota sai antes do dinheiro. `paga_contra_nota`: o processo do CLIENTE '
  'exige a NFS-e para liberar o pagamento (Banestes e os outros três do desligamento '
  'do Asaas). `comissao`: PARCEIRO que nos deve comissão de indicação — a nota '
  'acompanha a cobrança, e quem espera não é ele. A régua é a mesma (PENDING e '
  'OVERDUE, sempre por ato humano); o que muda é a frase que a tela e o sino dizem.';

comment on table public.nf_nota_antes_do_pagamento is
  'CNPJ/CPF cuja NFS-e sai ANTES do pagamento. Destrava a linha no painel de Notas '
  'Fiscais para emissão manual; NUNCA entra na fila automática. Duas populações, '
  'separadas por `tipo`: cliente que paga contra nota e parceiro de comissão.';

-- ---------------------------------------------------------------------------
-- O SINO PASSA A DIZER A VERDADE DE CADA UM DOS DOIS.
--
-- Este produtor junta com a lista por CNPJ e varre TODA cobrança pendente do
-- documento — foi assim que ele nasceu e está certo, porque é o esquecimento que
-- ele existe para cobrir. O que estava embutido era a frase: "Este cliente
-- precisa da NFS-e em mãos para conseguir pagar", escrita em texto fixo no corpo
-- e na ação do sinal.
--
-- Com um parceiro de comissão na lista, essa frase apareceria todo dia às 8h
-- sobre a mensalidade dele, mandando emitir uma nota que ninguém está esperando.
-- Aviso que erra o motivo é pior do que aviso que não existe: ele treina quem lê
-- a ignorar a série inteira.
--
-- A do parceiro é deliberadamente uma PERGUNTA e não uma ordem ("confira se esta
-- é a comissão"), porque a lista é por CNPJ e o Hub não tem como saber qual das
-- cobranças dele é a comissão. Prometer certeza que não existe seria o mesmo
-- erro numa casa decimal mais fina.
-- ---------------------------------------------------------------------------
create or replace function public.nfse_avisar_nota_antes_do_pagamento(p_dias integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_novos integer := 0;
begin
  /* PRIMEIRO FECHAR, DEPOIS ABRIR. A ordem importa: quem já resolveu não pode
     receber o sinal de novo no mesmo instante em que ele é fechado. */
  update public.sinais s
  set resolvido_em = now(), atualizado_em = now()
  where s.serie = 'notas.antes_do_pagamento'
    and s.resolvido_em is null
    and exists (
      select 1 from public.asaas_cache c
      where c.tipo = 'payment'
        and s.assinatura = 'notas.antes_do_pagamento:' || c.id_asaas
        and (
          -- Saiu nota nossa...
          exists (select 1 from public.nf_os_omie o
                   where o.cancelada = false and o.nfse_status = '004'
                     and o.c_cod_int_os = c.id_asaas)
          -- ...ou do Asaas...
          or exists (select 1 from public.asaas_cache n
                      where n.tipo = 'invoice' and n.pagamento_ref = c.id_asaas
                        and n.status not in ('ERROR', 'CANCELED', 'CANCELLED'))
          -- ...ou a cobrança deixou de existir como cobrança a pagar.
          or upper(coalesce(c.status, '')) not in ('PENDING', 'OVERDUE')
        )
    );

  with candidatas as (
    select c.id_asaas, c.valor, c.data_vencimento, c.descricao,
           coalesce(a.nome, cli.nome, 'cliente sem nome') as nome,
           a.tipo,
           (c.data_vencimento - current_date) as dias
    from public.asaas_cache c
    join public.asaas_cache cli
      on cli.tipo = 'customer' and cli.id_asaas = c.dados->>'customer'
    join public.nf_nota_antes_do_pagamento a
      on a.doc = cli.documento and a.ativo
    where c.tipo = 'payment'
      and upper(coalesce(c.status, '')) in ('PENDING', 'OVERDUE')
      and c.valor > 0
      and c.data_vencimento is not null
      and c.data_vencimento <= current_date + greatest(coalesce(p_dias, 7), 0)
      and not exists (
        select 1 from public.nf_os_omie o
        where o.cancelada = false and o.nfse_status = '004' and o.c_cod_int_os = c.id_asaas
      )
      and not exists (
        select 1 from public.asaas_cache n
        where n.tipo = 'invoice' and n.pagamento_ref = c.id_asaas
          and n.status not in ('ERROR', 'CANCELED', 'CANCELLED')
      )
  ),
  inseridos as (
    insert into public.sinais (serie, chave, assinatura, titulo, corpo, acao, valor, gravidade)
    select
      'notas.antes_do_pagamento',
      k.id_asaas,
      'notas.antes_do_pagamento:' || k.id_asaas,
      k.nome ||
        case k.tipo
          when 'comissao' then ' tem cobrança sem nota — '
          else ' está esperando a nota para pagar — '
        end ||
        case when k.dias < 0 then 'venceu há ' || abs(k.dias) || ' dia' || case when abs(k.dias) = 1 then '' else 's' end
             when k.dias = 0 then 'vence hoje'
             else 'vence em ' || k.dias || ' dia' || case when k.dias = 1 then '' else 's' end
        end,
      /* O `G` e o `D` do `to_char` seguem o `lc_numeric` do servidor, que aqui é
         `C` — saía "R$ 260.00" num texto em português. A troca em dois passos
         (vírgula → marcador → ponto) é o jeito de inverter os dois separadores
         sem que o segundo `replace` desfaça o primeiro. */
      'R$ ' || replace(replace(replace(
                 to_char(k.valor, 'FM999,999,990.00'),
                 ',', '#'), '.', ','), '#', '.') || ' · vencimento ' ||
        to_char(k.data_vencimento, 'DD/MM/YYYY') || '. ' ||
        case k.tipo
          when 'comissao' then
            'Este parceiro está na lista de nota antes de receber por causa de comissão de indicação: ' ||
            'nela a NFS-e acompanha a cobrança, em vez de esperar o pagamento. A cobrança não tem nota ' ||
            'em sistema nenhum.'
          else
            'Este cliente precisa da NFS-e em mãos para conseguir pagar — o Asaas emitia sozinho até ' ||
            '01/09/2026 e não emite mais. A cobrança não tem nota em sistema nenhum.'
        end,
      case k.tipo
        when 'comissao' then
          'Confira se esta cobrança é a comissão — a lista é por CNPJ e alcança tudo o que este parceiro tem ' ||
          'em aberto, mensalidade inclusive. Sendo a comissão, emita em /operacional/notas-fiscais: a linha ' ||
          'já está destravada, com o selo "comissão · nota antes de receber".'
        else
          'Confira o valor com o comercial e emita em /operacional/notas-fiscais: a linha já está destravada, ' ||
          'com o selo "nota antes do pagamento".'
      end,
      k.valor,
      'alta'
    from candidatas k
    -- A dedupe é por sinal ABERTO, e não por sinal existente: cobrança que teve
    -- a nota cancelada e precisa de outra merece um aviso novo.
    where not exists (
      select 1 from public.sinais s
      where s.assinatura = 'notas.antes_do_pagamento:' || k.id_asaas
        and s.resolvido_em is null
    )
    returning 1
  )
  select count(*)::int into v_novos from inseridos;

  return v_novos;
end;
$$;

revoke all on function public.nfse_avisar_nota_antes_do_pagamento(integer) from anon;
revoke all on function public.nfse_avisar_nota_antes_do_pagamento(integer) from authenticated;

/* A descrição da série também falava de uma população só. O `sinal_serie` é o
   que a aba de Monitoramento lê para explicar de onde vem o sinal. */
update public.sinal_serie
set titulo = 'Cobrança esperando nota antes do pagamento',
    descricao = 'Cobrança de quem está na lista de nota antes do pagamento, vencendo sem nota emitida — '
                'cliente cujo processo exige a NFS-e para pagar, ou parceiro de comissão de indicação. '
                'Produtor determinístico: não compara com mediana nenhuma, olha vencimento e ausência de nota.'
where serie = 'notas.antes_do_pagamento';
