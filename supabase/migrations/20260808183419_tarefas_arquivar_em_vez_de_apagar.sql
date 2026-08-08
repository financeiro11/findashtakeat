-- ============================================================
-- Tarefa arquivada em vez de apagada.
--
-- O desktop apagava a linha (delete). No celular um toque errado nao pode
-- destruir tarefa do time para sempre, entao as duas telas passam a arquivar:
-- a linha continua no banco e da para desfazer.
--
-- Espelha o idioma que o Hub ja usa em omie_reclassificacoes (ignorado_em) e a
-- coluna `archived` de workspace_pages. Quem arquivou fica em tarefas_log, que
-- ja grava usuario e usuario_id - nao duplicamos aqui.
-- ============================================================

alter table public.tarefas
  add column if not exists arquivada_em timestamptz;

comment on column public.tarefas.arquivada_em is
  'Nulo = tarefa viva. Preenchido = fora das listas, mas recuperavel. Substitui o delete.';

-- As duas telas listam sempre "as vivas"; o indice cobre exatamente esse filtro.
create index if not exists tarefas_vivas_idx
  on public.tarefas (status, ordem) where arquivada_em is null;

create index if not exists tarefas_arquivadas_idx
  on public.tarefas (arquivada_em) where arquivada_em is not null;
