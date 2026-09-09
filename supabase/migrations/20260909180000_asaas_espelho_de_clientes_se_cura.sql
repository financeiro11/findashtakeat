/* ---------------------------------------------------------------------------
 * O espelho de clientes do Asaas para de congelar no dia da carga.
 *
 * O SINTOMA, visto na tela de Notas Fiscais em 09/09/2026: linhas com "—" no
 * nome do cliente e "sem documento" embaixo, ao lado de uma descrição inteira
 * ("Parcela 2 de 3. Takeat - Plano Profissional") e de um valor. A pergunta que
 * abriu a investigação é a certa: **o Asaas não deixa criar cliente sem nome**.
 * Nenhum desses clientes está sem nome lá — eles não estão AQUI.
 *
 * A CAUSA. `notas_fiscais_painel` lê o nome e o CNPJ de `asaas_cache` tipo
 * 'customer' (`left join cli on cli.id_asaas = cob.cliente_ref`). Quem enche
 * esse tipo é UMA ação manual da `asaas-carga-historica` (`action: "clientes"`),
 * rodada uma única vez em 18/08/2026 — os 6.247 clientes espelhados têm todos
 * `atualizado_em` daquele dia, e nenhum foi acrescentado desde então. A
 * `asaas-sync`, que roda três vezes por dia e mantém pagamentos, assinaturas e
 * notas frescos, NUNCA tocou em clientes. Todo cliente que entrou no Asaas
 * depois de 18/08 é invisível para o Hub.
 *
 * O TAMANHO, medido hoje: 233 clientes órfãos, 475 cobranças, R$ 204.280,73 —
 * 125 delas só em setembro (R$ 49.711,64), todas classificadas "Sem nota".
 *
 * O QUE ISSO QUEBRA, além do rótulo:
 *   • `notas_fiscais_fila_emissao` faz `join cli` (não `left join`) — a cobrança
 *     de cliente não espelhado SOME DA FILA sem erro nenhum. São 242 cobranças
 *     depois do corte, R$ 115.444,69, que ninguém ia emitir e nada acusava.
 *   • o bloqueio da tela mente: diz "Cliente sem CNPJ/CPF no Asaas" quando o
 *     cadastro lá tem os dois. (A auditoria já acertava: balde `sem_cliente`.)
 *
 * A CORREÇÃO EM DUAS PARTES. Esta é a metade do banco: a pergunta "de quais
 * clientes eu tenho cobrança e não tenho cadastro?", que a `asaas-sync` passa a
 * fazer no fim de toda rodada para ir buscar só esses no `/customers/{id}`. A
 * outra metade está em `supabase/functions/asaas-sync/index.ts`.
 *
 * POR QUE UMA RPC E NÃO UM SELECT NO CLIENTE: a lista de exclusão são 6.247
 * ids, e mandá-la por `not.in` no PostgREST é uma URL de 100 KB — fora que o
 * teto de 1.000 linhas cortaria a resposta calado (ver as migrations do painel).
 * No Postgres é um anti-join que o índice coberto resolve em 56ms.
 * ------------------------------------------------------------------------- */

create or replace function public.asaas_clientes_a_espelhar(p_limite integer default 200)
returns table (cliente_ref text, cobrancas integer, ultima date)
language sql stable security invoker set search_path = public as $$
  select c.cliente_ref,
         count(*)::int,
         max(coalesce(c.data_pagamento, c.data_vencimento))
  from public.asaas_cache c
  where c.tipo = 'payment'
    and c.cliente_ref is not null
    and not exists (
      select 1 from public.asaas_cache k
      where k.tipo = 'customer' and k.id_asaas = c.cliente_ref)
  group by c.cliente_ref
  /* Ordem pela cobrança MAIS RECENTE, e não pelo volume: quando o teto de uma
     rodada não alcança a fila inteira, quem tem de ser resolvido primeiro é o
     cliente cuja cobrança está no mês aberto — é a dele que a tela mostra e a
     fila de emissão precisa hoje. O passado espera a próxima rodada. */
  order by max(coalesce(c.data_pagamento, c.data_vencimento)) desc nulls last
  limit greatest(p_limite, 0);
$$;

comment on function public.asaas_clientes_a_espelhar(integer) is
  'Clientes (cus_*) referenciados por cobranças do espelho que não têm linha tipo=customer em asaas_cache. É a fila de recuperação da asaas-sync — sem ela o cadastro do Asaas congela no dia da última carga manual, e cobrança de cliente novo perde nome, CNPJ e a fila de emissão.';

-- O grant a `anon` sai porque ele é automático em toda função nova aqui.
revoke all on function public.asaas_clientes_a_espelhar(integer) from public, anon;
grant execute on function public.asaas_clientes_a_espelhar(integer) to authenticated, service_role;
