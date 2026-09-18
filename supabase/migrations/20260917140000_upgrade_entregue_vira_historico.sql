-- ============================================================================
-- Upgrade entregue.
--
-- `upgrade` guarda a PRÓXIMA melhoria de uma automação que já roda. Não havia
-- como dizer "esta ficou pronta": a única saída era tirar da linha de produção
-- (que se lê como desistência) ou apagar o texto no editor (que apaga também o
-- registro de que a melhoria foi feita). As duas deixavam a seta acesa ou
-- sumiam com a história.
--
-- Concluir move o texto para cá, com a data e a tarefa que o fez, e limpa
-- `upgrade` — a seta apaga, o item sai da fila e sobra espaço para escrever o
-- próximo upgrade. Lista, porque uma automação evolui mais de uma vez.
--
-- Formato de cada item: {"texto": text, "em": timestamptz, "tarefa_id": uuid|null}
-- ============================================================================

alter table public.automacoes_catalogo
  add column if not exists upgrades_entregues jsonb not null default '[]'::jsonb;

comment on column public.automacoes_catalogo.upgrades_entregues is
  'Upgrades já entregues, do mais antigo ao mais novo: [{texto, em, tarefa_id}]. `upgrade` é só o próximo.';
