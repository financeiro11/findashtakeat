-- O SINO AVISA QUEM ESTÁ ESPERANDO A NOTA PARA PAGAR
--
-- A régua de "nota antes do pagamento" (migration 20260902150000) é um ATO
-- humano por decisão: numa rodada de cron não há a quem perguntar se o valor
-- ainda é aquele, e o do Banestes mudou três vezes em 2026. Mas ato humano tem
-- um custo que régua automática não tem: ALGUÉM PRECISA LEMBRAR.
--
-- E ninguém vai lembrar. São quatro clientes num painel de 3.000 cobranças por
-- mês; a linha do Banestes não se distingue de nenhuma outra até alguém procurar
-- por ela. Enquanto o Asaas emitia, esse lembrete era um cron dele. Trocar um
-- cron por uma pessoa sem dar à pessoa o lembrete é trocar automação por
-- esquecimento — e o sintoma só aparece quando o cliente liga cobrando a nota
-- que ele precisa para nos pagar.
--
-- Por isso o gatilho é humano e o AVISO é automático. É a divisão que o resto do
-- Hub já faz: a máquina mede e chama, a pessoa decide e assina.
--
-- Este produtor é DETERMINÍSTICO, não estatístico. As séries do `vigia-series`
-- comparam contra mediana + MAD porque a pergunta delas é "isto está fora do
-- normal?"; aqui a pergunta é "esta cobrança vence em N dias e não tem nota?",
-- que tem resposta exata. `tarefas.encalhada` já abriu esse caminho.

insert into public.sinal_serie (serie, modulo, titulo, descricao, rota, direcao, gravidade, ativa)
values (
  'notas.antes_do_pagamento', 'notas',
  'Cliente esperando a nota para pagar',
  'Cobrança de cliente que exige a NFS-e para pagar, vencendo sem nota emitida. '
    'Produtor determinístico: não compara com mediana nenhuma, olha vencimento e ausência de nota.',
  '/operacional/notas-fiscais', 'acima', 'alta', true
)
on conflict (serie) do update
  set titulo = excluded.titulo, descricao = excluded.descricao,
      rota = excluded.rota, gravidade = excluded.gravidade, ativa = true;

/**
 * Abre um sinal por cobrança que está esperando nota, e fecha o que já saiu.
 *
 * `p_dias` é a antecedência: 7 é uma semana de folga sobre o vencimento, tempo
 * de sobra para conferir o valor com o comercial antes de emitir. Cobrança já
 * VENCIDA entra também (vencimento <= hoje + 7 inclui o passado) e de propósito:
 * nesse fluxo, vencida sem nota não é inadimplência, é cliente impedido de pagar.
 */
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
      k.nome || ' está esperando a nota para pagar — ' ||
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
        'Este cliente precisa da NFS-e em mãos para conseguir pagar — o Asaas emitia sozinho até 01/09/2026 e ' ||
        'não emite mais. A cobrança não tem nota em sistema nenhum.',
      'Confira o valor com o comercial e emita em /operacional/notas-fiscais: a linha já está destravada, ' ||
        'com o selo "nota antes do pagamento".',
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

/* 11h UTC = 8h BRT: antes da janela de emissão (13h UTC), para quem chega de
   manhã já encontrar o sino aceso e ter o dia inteiro para conferir o valor.
   Função SQL pura no cron, como o `sinais_escalar` e o
   `nfse_fila_resumo_recalcular` — não gasta uma Edge Function, que é recurso
   esgotado neste projeto desde o HTTP 402 de 01/09. */
select cron.unschedule('nf-avisar-antes-do-pagamento')
where exists (select 1 from cron.job where jobname = 'nf-avisar-antes-do-pagamento');

select cron.schedule(
  'nf-avisar-antes-do-pagamento',
  '0 11 * * *',
  $cron$ select public.nfse_avisar_nota_antes_do_pagamento(7); $cron$
);
