-- Workspace do Playbook: opção de OCULTAR uma nota da barra lateral/landing sem
-- arquivá-la (arquivar tem semântica de "concluída/lixeira"). Nota oculta continua
-- ativa; some das listas padrão e reaparece no filtro "Ocultas".
ALTER TABLE public.workspace_pages
  ADD COLUMN IF NOT EXISTS oculta boolean NOT NULL DEFAULT false;
