-- Fecha as duas funções da migration anterior para o papel `anon`.
--
-- POR QUE ISTO É NECESSÁRIO (e não é redundante com o `revoke ... from public`):
-- o Supabase concede EXECUTE a `anon`, `authenticated` e `service_role` em TODA
-- função nova criada em `public`. Esse grant é por ROLE; `revoke ... from public`
-- mexe só no pseudo-papel PUBLIC e não o desfaz. O resultado é que a função nasce
-- chamável por PostgREST com a anon key — que é pública, está no bundle do front.
--
-- Conferido em produção antes e depois: antes do revoke,
--   POST /rest/v1/rpc/demonstracoes_contrapartes  com a anon key
-- devolvia fornecedor, valor, CNPJ e categoria do Omie SEM login; depois devolve
-- 42501 permission denied. A tabela `demonstracoes_justificativas` já estava
-- coberta pela RLS (policy `to authenticated`), então só as funções precisavam.
--
-- As funções mais antigas do módulo (`demonstracoes_lancamentos`,
-- `demonstracoes_reclassificacoes`, etc.) tinham o MESMO grant e a mesma
-- exposição; foram fechadas na migration seguinte, 20260804160200.

revoke execute on function public.demonstracoes_contrapartes(text, text[]) from anon;
revoke execute on function public.justificativa_decidir(uuid, text, text) from anon;
