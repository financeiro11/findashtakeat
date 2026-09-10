-- As duas tabelas que estavam sem RLS nenhuma.
--
-- `_nf_fila_baseline` e `_nf_fila_antes` são restos de uma investigação da fila
-- de notas: prefixo `_`, zero linhas, nenhuma policy e — o que importa — **RLS
-- desligada**, que é diferente de ter policy permissiva. Sem RLS, a tabela
-- responde a qualquer autenticado e nem aparece nas contagens de policy, então
-- passa despercebida numa auditoria que só olha `pg_policies`.
--
-- Ninguém as referencia no código (só o types.ts, que é gerado). Ligar a RLS sem
-- criar policy fecha para todo mundo menos `service_role` — e preserva o
-- conteúdo, caso alguém ainda queira olhar antes de apagar. Apagar é decisão de
-- quem investigava, não desta migration.
--
-- Conferência que vale (o alvo é zero):
--   select count(*) from pg_tables t join pg_class c
--     on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
--    where t.schemaname = 'public' and not c.relrowsecurity;

alter table if exists public._nf_fila_baseline enable row level security;
alter table if exists public._nf_fila_antes    enable row level security;

revoke all on table public._nf_fila_baseline from anon, authenticated;
revoke all on table public._nf_fila_antes    from anon, authenticated;
