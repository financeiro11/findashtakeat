-- Consertando um efeito colateral do laço que fechou o `anon`.
--
-- ===========================================================================
-- O QUE O LAÇO FEZ DE MAIS
--
-- A migration `20260830233000` percorreu TODAS as funções de `public`, revogou
-- `from public, anon` e concedeu `to authenticated, service_role`. O objetivo —
-- tirar ~100 funções do alcance da internet — foi atingido.
--
-- Mas o `grant ... to authenticated` foi generoso demais: 26 funções tinham
-- sido deliberadamente estreitadas nas migrations delas para **service_role e
-- mais ninguém**, e o laço devolveu `authenticated` a todas. Ou seja, ao fechar
-- a porta da rua, escancarou 21 portas internas (5 das 26 o front chama de
-- verdade e continuam como estão — ver o fim do arquivo).
--
-- ===========================================================================
-- A QUE MAIS IMPORTA: `disparar_automacao`
--
-- Ela recebe a URL e o NOME DO TOKEN como parâmetros:
--
--   disparar_automacao(p_jobname, p_url, p_body, p_token_nome, p_headers)
--
-- e por dentro faz `select token from internal_cron_tokens where name =
-- p_token_nome`, pendurando o resultado no header `x-cron-token` da chamada a
-- `p_url`. A tabela `internal_cron_tokens` é ilegível para o Hub (RLS sem
-- policy) — mas com EXECUTE nesta função isso não protege nada: bastava
-- chamá-la apontando `p_url` para um servidor próprio e o token saía no header.
--
-- E o token de cron vale muito: é ele que abre as funções com
-- `verify_jwt = false` (`notas-arquivar`, `vigilancia-mudancas`,
-- `integracoes-status`, `editais-sync`, ...) SEM login nenhum. Então era um
-- caminho de escalada: qualquer conta do Hub — inclusive o cargo `parcerias`,
-- que é o de menor alcance — vira chamador de cron.
--
-- Não chegou a ser exposição para a internet (o `anon` já não executa nada
-- disso), mas é exatamente o tipo de brecha que a faxina veio fechar.
--
-- ===========================================================================
-- POR QUE ESTAS 21 E NÃO AS 26
--
-- Cinco das 26 o front CHAMA de verdade, com o usuário logado:
-- `demonstracoes_categorias`, `demonstracoes_contrapartes`,
-- `notas_externas_casar`, `rescisao_situacao`, `revisao_justificativas`.
-- Nessas, o `to service_role` da migration original era incompleto — elas
-- funcionavam por causa do grant automático que o projeto dava a
-- `authenticated`. Revogar quebraria a tela, então ficam como estão.
--
-- As 21 abaixo só são chamadas por Edge Function (que fala como service_role)
-- ou pelo cron. Conferido no `src/` antes de mexer: as quatro que aparecem numa
-- busca frouxa (`cartao_importar`, `disparar_automacao`, `rescisao_registrar`,
-- `rescisao_verbas_pj`) aparecem só em COMENTÁRIO e em texto de documentação na
-- tela — nenhuma é um `.rpc()`.
--
-- O cron não é afetado: `cron.job` roda como `postgres`, o dono, que executa
-- independentemente destes grants.

do $$
declare
  f record;
  so_service text[] := array[
    'anexo_triagem_fila', 'anexo_triagem_gravar', 'automacao_diagnostico_gravar',
    'cartao_importar', 'cartao_series', 'demonstracoes_lancamentos_multi',
    'disparar_automacao', 'integracao_estado_gravar', 'nfse_carencia',
    'notas_externas_aplicar_sugestao', 'notas_externas_do_drive',
    'notas_externas_gravar_motivo', 'notas_externas_gravar_sugestao',
    'notas_externas_marcar_copias', 'omie_anexo_link_fila',
    'omie_cache_trocar_categoria', 'omie_lancamento', 'rescisao_brl',
    'rescisao_nome_chave', 'rescisao_registrar', 'rescisao_verbas_pj'
  ];
begin
  -- Por `oid::regprocedure` e não por nome: função com sobrecarga tem mais de
  -- uma assinatura, e `revoke ... from` exige a assinatura exata. É a mesma
  -- pegadinha de [[migrations-nao-batem-com-o-banco]].
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(so_service)
  loop
    execute format('revoke all on function %s from authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;
