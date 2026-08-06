-- Assistente — memória por usuário e log de execução.
--
-- Duas tabelas, dois propósitos:
--   • assistente_memoria   → fatos e preferências que o Assistente lembra sobre a pessoa.
--   • assistente_execucao  → o que foi perguntado, o que foi consultado e quais números
--                            saíram. É o log de auditoria E a prova por trás de cada
--                            resposta que vai para diretoria ou investidor.
--
-- NOME: `assistente_execucao` é deliberadamente distinto da tabela `auditoria` já
-- existente (achados de exceção do Omie), que NÃO é tocada por este projeto.
--
-- ESCRITA: as duas são gravadas apenas pela Edge Function, com service_role (ignora RLS).
-- Não há policy de INSERT para `authenticated` de propósito — assim ninguém planta um
-- "fato" falso sobre si mesmo, nem forja um registro de auditoria, via PostgREST.

-- ---------------------------------------------------------------------------
-- 1) Memória
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistente_memoria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  texto       text NOT NULL,
  -- Coluna GERADA, e não um índice sobre `lower(texto)`, porque o `on_conflict` do
  -- PostgREST só referencia COLUNAS: com índice por expressão, o upsert de dedup da
  -- Edge Function não teria como apontar para o conflito e falharia silenciosamente.
  texto_norm  text GENERATED ALWAYS AS (lower(texto)) STORED,
  tipo        text NOT NULL DEFAULT 'fato' CHECK (tipo IN ('fato', 'preferencia')),
  origem      text NOT NULL DEFAULT 'conversa' CHECK (origem IN ('conversa', 'manual')),
  conversa_id uuid,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  -- Dedup por pessoa: o extrator repete fatos com facilidade entre conversas.
  CONSTRAINT assistente_memoria_dedup UNIQUE (user_id, texto_norm)
);

CREATE INDEX IF NOT EXISTS assistente_memoria_user_idx
  ON public.assistente_memoria (user_id, criado_em DESC);

ALTER TABLE public.assistente_memoria ENABLE ROW LEVEL SECURITY;

-- A pessoa vê o que foi lembrado sobre ela — e só sobre ela.
DROP POLICY IF EXISTS "memoria_select_propria" ON public.assistente_memoria;
CREATE POLICY "memoria_select_propria" ON public.assistente_memoria
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- E pode apagar. Requisito do projeto: memória que não se apaga é vigilância.
DROP POLICY IF EXISTS "memoria_delete_propria" ON public.assistente_memoria;
CREATE POLICY "memoria_delete_propria" ON public.assistente_memoria
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, DELETE ON public.assistente_memoria TO authenticated;
GRANT ALL ON public.assistente_memoria TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Log de execução
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistente_execucao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversa_id uuid,
  pergunta    text NOT NULL,
  consulta    text,                                  -- qual consulta nomeada rodou
  ok          boolean NOT NULL DEFAULT false,        -- a conferência de somas passou?
  numeros     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- valor, fonte e competência de cada número
  avisos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  resposta    text,
  latencia_ms integer,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistente_execucao_user_idx
  ON public.assistente_execucao (user_id, criado_em DESC);

ALTER TABLE public.assistente_execucao ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga o próprio histórico. Sem policy de INSERT/UPDATE/DELETE: o log é
-- append-only pela função e ninguém reescreve o próprio rastro.
DROP POLICY IF EXISTS "execucao_select_propria" ON public.assistente_execucao;
CREATE POLICY "execucao_select_propria" ON public.assistente_execucao
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT SELECT ON public.assistente_execucao TO authenticated;
GRANT ALL ON public.assistente_execucao TO service_role;
