-- Histórico de movimentações/alterações dos cards de Tarefas (kanban).
-- Preenchido pelo próprio app (com a sessão do usuário) a cada criação/movimentação/
-- edição/exclusão de card, para a aba "Histórico" em /tarefas mostrar data, hora,
-- usuário, qual card e o que foi alterado.
create table if not exists public.tarefas_log (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid,                 -- SEM foreign key de propósito: o log sobrevive à exclusão do card
  tarefa_titulo text,             -- título no momento da ação (mostra qual card mesmo depois de excluído)
  acao text not null,             -- 'criada' | 'movida' | 'editada' | 'excluida'
  descricao text,                 -- texto legível do que mudou (ex.: 'moveu de "Backlog" para "Em andamento"')
  usuario text,                   -- nome de quem fez (profiles.nome)
  usuario_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_tarefas_log_created on public.tarefas_log(created_at desc);
create index if not exists idx_tarefas_log_tarefa on public.tarefas_log(tarefa_id);

alter table public.tarefas_log enable row level security;

-- O app registra logado como 'authenticated'; todos leem e inserem. É append-only:
-- não há policy de UPDATE nem DELETE (histórico não se altera).
create policy "tarefas_log_read" on public.tarefas_log
  for select to authenticated using (true);
create policy "tarefas_log_insert" on public.tarefas_log
  for insert to authenticated with check (true);
