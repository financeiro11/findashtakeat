-- O link que sai do Hub aponta para a Vercel, não para a Lovable.
--
-- `hub_base_url()` é o domínio que vai DENTRO das mensagens: o link permanente
-- da auditoria (`/l/<token>`), o texto da consolidada e o da solicitação de
-- ajuste. Ele ficou em `findashtakeat.lovable.app` desde que nasceu, mas a
-- publicação mudou para a Vercel em agosto de 2026 — e em 17/09/2026 o endereço
-- antigo responde **404**.
--
-- Ou seja: não é só um nome desatualizado. Todo link de auditoria já enviado
-- está morto, inclusive os que os líderes abriram dezenas de vezes. O token não
-- muda quando a mensagem é reenviada (`criar_token_e_registrar` reaproveita o
-- mesmo e só reativa a linha), então reenviar a cobrança entrega o MESMO link,
-- agora num domínio que abre.
--
-- Este valor é repetido em três lugares que precisam concordar, e a lista fica
-- aqui porque quem trocar o domínio de novo vai chegar neste arquivo primeiro:
--   1. esta função, que escreve o link nas mensagens e no retorno do token;
--   2. `VITE_HUB_URL` no `.env` (e no `.env.example`), usado pelos botões de
--      compartilhar de notas e tarefas — ver `baseDoHub()` em src/lib/compartilhar.ts;
--   3. as duas janelas da auditoria, que trocam o `{{TOKEN}}` da prévia pelo
--      link real. Elas procuravam o domínio escrito por extenso; passaram a usar
--      expressão regular justamente para não morrerem na próxima mudança.

create or replace function public.hub_base_url()
returns text
language sql
immutable
as $function$ select 'https://hub-findash.vercel.app'::text $function$;
