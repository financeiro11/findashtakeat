/* ---------------------------------------------------------------------------
 * O diário do webhook do Asaas.
 *
 * POR QUE EXISTE. O espelho `asaas_cache` enche três vezes por dia (07:45, 12:30
 * e 17:00 BRT). Em 15/09/2026 uma cobrança editada de R$ 14.880 para R$ 505 e
 * uma cobrança nova não apareciam na tela de Notas Fiscais — as duas só
 * chegariam na varredura seguinte. O `asaas-webhook` fecha esse buraco: o Asaas
 * avisa, a função grava a linha em segundos.
 *
 * O QUE ESTA TABELA FAZ, e são duas coisas:
 *
 * 1) IDEMPOTÊNCIA. O Asaas entrega "pelo menos uma vez" — o mesmo evento pode
 *    chegar duas vezes, e a documentação manda guardar o `id` e não reprocessar.
 *    A função grava a linha ANTES de mexer no espelho; se o id já existe com
 *    resultado final, responde 200 e para ali. Resultado 'recebido' ou 'erro'
 *    NÃO conta como final: é o evento cuja gravação caiu no meio, e a repetição
 *    do Asaas precisa poder terminá-lo.
 *
 * 2) TRILHA. Quando um número da tela divergir do Asaas, a primeira pergunta é
 *    "o aviso chegou?". Sem esta tabela a resposta estaria só no log da função,
 *    que some em dias.
 *
 * `resultado`: 'recebido' (gravado o evento, espelho ainda não) | 'gravado' |
 * 'ignorado' (evento que não mexe no espelho) | 'erro' (ver `erro`).
 *
 * RLS ligada e SEM policy: só a service role (a própria função) lê e escreve. O
 * payload tem nome, CNPJ, e-mail e valor de cliente — não é para sessão logada.
 *
 * RETENÇÃO. Nenhum cron por enquanto. O `payload` inteiro engorda o heap (ver o
 * que aconteceu com o `asaas_cache`), e passado o mês a linha só serve de
 * trilha. Quando pesar, um `delete ... where recebido_em < now() - interval
 * '60 days'` resolve — o Asaas guarda os eventos por 14 dias, então nada abaixo
 * disso é necessário para idempotência.
 * ------------------------------------------------------------------------- */

create table if not exists public.asaas_webhook_eventos (
  id           text primary key,            -- `id` do evento no Asaas (evt_...)
  evento       text not null,               -- PAYMENT_UPDATED, INVOICE_AUTHORIZED, ...
  objeto_id    text,                        -- pay_..., inv_..., cus_...
  recebido_em  timestamptz not null default now(),
  resultado    text not null default 'recebido',
  erro         text,
  payload      jsonb
);

create index if not exists asaas_webhook_eventos_objeto_idx
  on public.asaas_webhook_eventos (objeto_id, recebido_em desc);
create index if not exists asaas_webhook_eventos_recebido_idx
  on public.asaas_webhook_eventos (recebido_em desc);

alter table public.asaas_webhook_eventos enable row level security;

revoke all on table public.asaas_webhook_eventos from anon, authenticated, public;
grant select, insert, update, delete on table public.asaas_webhook_eventos to service_role;

comment on table public.asaas_webhook_eventos is
  'Diário do asaas-webhook: um evento do Asaas por linha (id = id do evento). Serve de idempotência (entrega é pelo-menos-uma-vez) e de trilha. Só service role. Sem retenção automática — ver a migration 20260915200000.';
