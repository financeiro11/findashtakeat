/* ============================================================================
 * A "ASAAS Pago" deixa de ser poço: o que entra na Disponível sai dela.
 *
 * O QUE ESTAVA ERRADO. A conta `ASAAS Pago` (nCodCC 5471927663) recebe o título
 * consolidado que o financeiro lança à mão todo mês — R$ 5.875.219,61 entre
 * abril e agosto/2026, em 51 títulos, todos baixados ali. E **nada sai**:
 * varrendo os movimentos do ERP não há uma transferência, um pagamento, nada de
 * natureza "P". No Omie a conta acumula quase seis milhões que não existem em
 * lugar nenhum — o dinheiro real já foi para o Sicoob. No Hub isso não aparecia
 * porque a conta está com `incluir: false`, fora do painel de caixa.
 *
 * A IDEIA, QUE É DO FINANCEIRO: as ENTRADAS da `ASAAS Disponível` são as SAÍDAS
 * da `ASAAS Pago`. É o mesmo dinheiro andando de "faturado" para "disponível", e
 * o extrato já sabe exatamente quando cada real fez essa travessia.
 *
 * O QUE SOBRA NA CONTA PASSA A SIGNIFICAR ALGUMA COISA — e isso foi conferido
 * contra dado independente antes de aplicar (10/09/2026):
 *
 *   consolidado abr–ago      5.875.219,61
 *   − recebimentos do extrato 5.146.426,46
 *   = resíduo                   728.793,15
 *
 *   Asaas, mesmo corte: confirmado e não creditado 459.077,50
 *                     + vencido e não pago         297.834,16
 *                     =                            756.911,66   (3,7% de folga)
 *
 * Ou seja, o saldo da `ASAAS Pago` vira o "faturado que ainda não caiu". A folga
 * de 3,7% é esperada: o consolidado é de competência e os estornos abatem o
 * caixa sem voltar para o faturado.
 *
 * NÃO USA A TRANSFERÊNCIA NATIVA do Omie (`transferencia.nCodCCDestino` no
 * IncluirLancCC), e é de propósito: ela cria as DUAS pernas, e a perna da
 * Disponível já existe desde a carga do extrato. Seriam entradas em dobro. As
 * duas pernas ficam como lançamentos independentes, cada uma na categoria de
 * transferência do seu lado — que é o que o `omie-caixa-sync` já lê como
 * transferência (CATEGORIAS_TRANSFERENCIA) e o que o `omie_dre_mapa` ignora.
 * ========================================================================== */

/* A tabela nasceu com uma conta só. Agora cada lançamento diz em qual conta ele
   mora — sem isso a contrapartida e o recebimento seriam indistinguíveis, e a
   RPC de cobertura somaria as duas pernas como se fossem o mesmo extrato. */
alter table public.asaas_omie_lancamento
  add column if not exists ncodcc text not null default '5460455582';

do $$
begin
  alter table public.asaas_omie_lancamento
    add constraint asaas_omie_lancamento_natureza_chk2
    check (natureza in ('recebimento', 'taxa_meios', 'taxa_cobranca', 'taxa_nf',
                        'transferencia', 'estorno', 'outros', 'saida_pago'));
exception when duplicate_object then null;
end $$;

/* O check antigo não conhece 'saida_pago' e recusaria a contrapartida. */
alter table public.asaas_omie_lancamento
  drop constraint if exists asaas_omie_lancamento_natureza_check;

create index if not exists asaas_omie_lancamento_conta_idx
  on public.asaas_omie_lancamento (ncodcc, dia);


/* ============================================================
 *  A cobertura passa a olhar UMA conta
 * ============================================================
 * Sem o recorte, a contrapartida da `ASAAS Pago` entraria na soma como se fosse
 * movimento do extrato, e a conferência diária — que hoje fecha em R$ 0,00 —
 * passaria a acusar uma diferença do tamanho dos recebimentos do dia.
 */
/* `create or replace` NÃO substitui uma função de assinatura diferente: a versão
   de dois argumentos continuaria viva, somando as duas contas, e quem chamasse
   `asaas_omie_cobertura(de, ate)` pegaria a antiga sem erro nenhum. Derrubar é
   obrigatório — e como a nova tem default no 3º parâmetro, toda chamada de dois
   argumentos passa a cair nela. */
drop function if exists public.asaas_omie_cobertura(date, date);

create or replace function public.asaas_omie_cobertura(
  p_de date default null,
  p_ate date default null,
  p_ncodcc text default '5460455582'
)
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
    where l.ncodcc = p_ncodcc
      and (p_de is null or l.dia >= p_de)
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

revoke all on function public.asaas_omie_cobertura(date, date, text) from anon;
