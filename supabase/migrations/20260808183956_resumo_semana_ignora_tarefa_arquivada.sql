-- ============================================================
-- fn_resumo_tarefas_semana deixa de contar tarefa arquivada.
--
-- Antes, excluir apagava a linha e ela sumia da conta sozinha. Agora arquivar
-- so esconde, entao sem este filtro a "Analise Semanal" continuaria contando
-- como concluida uma tarefa que ja saiu do quadro.
--
-- Reescreve so o WHERE, a partir da propria definicao viva da funcao: ela e
-- longa e redigita-la aqui seria a chance de introduzir divergencia. Aborta se
-- o padrao nao bater, e nao faz nada se ja estiver filtrado.
-- ============================================================
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_resumo_tarefas_semana';

  if def is null then
    raise exception 'fn_resumo_tarefas_semana nao encontrada';
  end if;

  if position('arquivada_em' in def) > 0 then
    raise notice 'ja filtra arquivada_em - nada a fazer';
    return;
  end if;

  def := regexp_replace(
    def,
    '(FROM\s+public\.tarefas\s+t\s+WHERE\s+)',
    '\1t.arquivada_em IS NULL AND ',
    'g'
  );

  if position('arquivada_em' in def) = 0 then
    raise exception 'o WHERE esperado nao foi encontrado - abortado para nao gravar funcao errada';
  end if;

  execute def;
end $$;
