/* ============================================================================
 * O extrato do Asaas dentro do Omie — o registro de quem já foi lançado.
 *
 * O BURACO QUE ISTO FECHA. A conta "ASAAS Disponível" (nCodCC 5460455582)
 * existe no plano de contas do Omie e nunca teve UM lançamento. O saldo que o
 * painel de caixa mostra para ela é emprestado: `omie-caixa-sync` sobrescreve o
 * número do ERP pelo `/finance/balance` da API do Asaas, justamente porque não
 * há extrato embaixo. Levantado em 10/09/2026: 13.220 linhas em `asaas_extrato`
 * (25/07 a 10/09), R$ 1,81 M de crédito e R$ 1,73 M de débito — nada disso no
 * ERP.
 *
 * O QUE ESTA TABELA É. Um registro por (dia × natureza) enviado, com a chave de
 * integração que foi ao Omie e o `nCodLanc` que ele devolveu. NÃO é espelho do
 * extrato — o extrato mora em `asaas_extrato` e continua sendo a fonte. É só a
 * memória do que já saiu daqui, e ela existe porque lançar duas vezes é o erro
 * que ninguém enxerga: some dentro de um razão de milhões.
 *
 * SÃO DUAS TRAVAS, DE PROPÓSITO. O `cCodIntLanc` ('ASAAS-20260903-TXM') é chave
 * primária AQUI e chave de integração LÁ — o Omie recusa a repetida por conta
 * própria. A daqui pega o clique duplo antes de gastar a chamada; a de lá pega
 * o caso em que gravamos e a resposta se perdeu. Nenhuma das duas sozinha
 * bastaria: a nossa não sabe o que o Omie tem, e a do Omie custa uma ida.
 *
 * POR QUE O LANÇAMENTO É DIÁRIO E NÃO LINHA A LINHA: ver o cabeçalho de
 * `supabase/functions/_shared/extrato-omie.ts`. Em resumo, agosto/26 tem 7.948
 * linhas no Asaas e vira 149 lançamentos no Omie, com o MESMO saldo no fim.
 * ========================================================================== */

create table if not exists public.asaas_omie_lancamento (
  -- 'ASAAS-20260903-TXM'. Também é o cCodIntLanc no Omie (teto de 20 caracteres).
  cod_int_lanc  text primary key,
  dia           date not null,
  natureza      text not null
                check (natureza in ('recebimento', 'taxa_meios', 'taxa_cobranca',
                                    'taxa_nf', 'transferencia', 'estorno', 'outros')),
  categoria     text not null,
  -- ASSINADO: positivo entrou na conta, negativo saiu. É o líquido do dia.
  valor         numeric not null,
  entradas      numeric not null default 0,
  saidas        numeric not null default 0,
  -- Quantas linhas do extrato do Asaas este lançamento resume.
  lancamentos   int not null default 0,

  status        text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'erro')),
  -- Devolvido pelo Omie no lanccIncluirResponse.
  n_cod_lanc    text,
  erro          text,
  tentativas    int not null default 0,

  enviado_em    timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists asaas_omie_lancamento_dia_idx
  on public.asaas_omie_lancamento (dia);
create index if not exists asaas_omie_lancamento_status_idx
  on public.asaas_omie_lancamento (status, dia);

alter table public.asaas_omie_lancamento enable row level security;

/* Leitura para quem está logado (a tela do caixa mostra a cobertura); a escrita
   é só da edge function, que usa a service key e passa por cima da RLS. */
drop policy if exists "asaas_omie_lancamento_select_auth" on public.asaas_omie_lancamento;
create policy "asaas_omie_lancamento_select_auth"
  on public.asaas_omie_lancamento for select to authenticated using (true);

/* O Supabase concede ao `anon` por padrão em tabela nova, e RLS sem policy para
   `anon` só faz a leitura voltar VAZIA — sem erro nenhum. Tirar o grant é o que
   transforma "vazio silencioso" em "negado". */
revoke all on public.asaas_omie_lancamento from anon;


/* ============================================================
 *  A cobertura: até onde o Omie já conhece o extrato
 * ============================================================
 * Responde à única pergunta que interessa na tela — "o Asaas e o Omie estão
 * batendo?" — comparando, por dia, o que o extrato diz com o que foi lançado.
 *
 * `liquido_extrato` é recalculado do `asaas_extrato` a cada chamada, e não lido
 * do registro de envio, de propósito: se o extrato se corrigir depois (o Asaas
 * lança atrasado, e o sync tem 3 dias de sobreposição), a diferença aparece em
 * vez de ficar congelada no número que enviamos.
 */
create or replace function public.asaas_omie_cobertura(p_de date default null, p_ate date default null)
returns table (
  dia              date,
  liquido_extrato  numeric,
  liquido_enviado  numeric,
  diferenca        numeric,
  linhas_extrato   bigint,
  lancamentos      bigint,
  pendentes        bigint,
  com_erro         bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with extrato as (
    select e.data_movimento as dia,
           sum(case when e.tipo = 'credito' then e.valor else -e.valor end) as liquido,
           count(*) as linhas
    from public.asaas_extrato e
    where e.data_movimento is not null
      and (p_de is null or e.data_movimento >= p_de)
      and (p_ate is null or e.data_movimento <= p_ate)
    group by 1
  ),
  enviado as (
    select l.dia,
           sum(l.valor) filter (where l.status = 'enviado') as liquido,
           count(*) as lancamentos,
           count(*) filter (where l.status = 'pendente') as pendentes,
           count(*) filter (where l.status = 'erro') as com_erro
    from public.asaas_omie_lancamento l
    where (p_de is null or l.dia >= p_de)
      and (p_ate is null or l.dia <= p_ate)
    group by 1
  )
  select coalesce(x.dia, n.dia)                                   as dia,
         round(coalesce(x.liquido, 0), 2)                         as liquido_extrato,
         round(coalesce(n.liquido, 0), 2)                         as liquido_enviado,
         round(coalesce(x.liquido, 0) - coalesce(n.liquido, 0), 2) as diferenca,
         coalesce(x.linhas, 0)                                    as linhas_extrato,
         coalesce(n.lancamentos, 0)                               as lancamentos,
         coalesce(n.pendentes, 0)                                 as pendentes,
         coalesce(n.com_erro, 0)                                  as com_erro
  from extrato x
  full outer join enviado n on n.dia = x.dia
  order by 1;
$$;

revoke all on function public.asaas_omie_cobertura(date, date) from anon;
