-- Fecha para `anon` as funções do módulo DRE/DFC criadas ANTES das justificativas.
--
-- Mesmo problema descrito em 20260804160100: o Supabase concede EXECUTE a
-- anon/authenticated/service_role em toda função nova de `public`, e o
-- `revoke ... from public` das migrations originais não desfaz isso (é grant de
-- ROLE, não do pseudo-papel PUBLIC).
--
-- Conferido em produção: antes destes revokes,
--   POST /rest/v1/rpc/demonstracoes_lancamentos
--   {"p_tipo":"dre","p_rubrica":"Servidor","p_mes":"Jun-26"}
-- com a anon key (pública — está no bundle do front) devolvia data, contraparte,
-- CNPJ, categoria e valor dos lançamentos do Omie SEM nenhum login. Depois
-- devolve 42501 permission denied.
--
-- Nada quebra: a DRE/DFC vive dentro do AppLayout, que exige sessão, então estas
-- funções sempre foram chamadas como `authenticated` — papel que segue com
-- EXECUTE. É reversível com o grant equivalente.
--
-- ESCOPO: só o módulo DRE/DFC. O banco tem outras funções abertas a anon e
-- algumas são assim DE PROPÓSITO — a família `*_via_token`
-- (registrar_comprovante_via_token, salvar_justificativa_via_token,
-- resolver_token, validar_token_para_id_unico) atende link público de fornecedor,
-- que não tem login. Revogar em bloco quebraria esse fluxo. As demais
-- (importar_auditoria, preview_msg_*, fn_resumo_tarefas_semana,
-- auditoria_pix_fix_tem_comprovante, criar_token_e_registrar) precisam de decisão
-- caso a caso e ficaram de fora.

revoke execute on function public.demonstracoes_lancamentos(text, text, text) from anon;
revoke execute on function public.demonstracoes_reclassificacoes(text) from anon;
revoke execute on function public.demonstracoes_reclassificacoes_celula(text, text, text) from anon;
revoke execute on function public.reclassificacao_ignorar(uuid, text, text) from anon;
revoke execute on function public.reclassificacao_reabrir(uuid) from anon;

-- Recomputa todos os alertas varrendo o cache inteiro do Omie. É chamada pelo
-- trigger de `omie_cache` (que roda como definer e não depende deste grant);
-- exposta a anon, era um botão anônimo de trabalho pesado repetido à vontade.
revoke execute on function public.omie_reclassificacoes_detectar() from anon;
