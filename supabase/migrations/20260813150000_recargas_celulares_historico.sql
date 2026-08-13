-- Histórico do chip: o que foi recarregado, e com quem ele estava.
--
-- Hoje `recargas_celulares.ultima_recarga` guarda UMA data — a última. Toda recarga
-- anterior é sobrescrita, então não há como responder "quanto gastamos nessa linha no
-- semestre" nem "essa linha recarrega demais?".
--
-- São duas tabelas porque são duas perguntas independentes:
--   historico  → quando houve recarga (evento pontual)
--   titulares  → quem estava com o chip (intervalo contínuo)
-- Um chip pode passar meses com o mesmo dono sem recarga, e pode trocar de mão entre
-- duas recargas. Uma tabela só não responderia as duas.

-- ── 1. Recargas efetivadas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recargas_celulares_historico (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  linha_id UUID NOT NULL REFERENCES public.recargas_celulares(id) ON DELETE CASCADE,

  -- Congelados no momento da recarga: o titular e o número podem mudar depois, mas o
  -- histórico tem de continuar dizendo quem recebeu AQUELE crédito.
  colaborador TEXT,
  numero TEXT,
  operadora TEXT,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,

  recarregado_em DATE NOT NULL,
  -- Quando veio de um pedido do TakeatOS, guarda o vínculo para fechar o rastro.
  solicitacao_id UUID REFERENCES public.recargas_celulares_solicitacoes(id) ON DELETE SET NULL,
  registrado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rch_linha
  ON public.recargas_celulares_historico (linha_id, recarregado_em DESC);
CREATE INDEX IF NOT EXISTS idx_rch_colaborador
  ON public.recargas_celulares_historico (colaborador, recarregado_em DESC);

-- ── 2. Quem estava com o chip, e quando ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recargas_celulares_titulares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  linha_id UUID NOT NULL REFERENCES public.recargas_celulares(id) ON DELETE CASCADE,
  colaborador TEXT NOT NULL,
  -- `ate` nulo = período aberto, é o titular atual.
  de DATE NOT NULL DEFAULT CURRENT_DATE,
  ate DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rct_linha ON public.recargas_celulares_titulares (linha_id, de DESC);

-- Um chip só tem um titular por vez: o índice parcial impede dois períodos abertos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rct_aberto
  ON public.recargas_celulares_titulares (linha_id)
  WHERE ate IS NULL;

-- ── 3. Troca de titular é registrada sozinha ────────────────────────────────
-- No trigger, e não na tela: assim vale para edição manual, importação de planilha e
-- sincronização do TakeatOS igualmente. Registrar só na UI deixaria buracos.
CREATE OR REPLACE FUNCTION public.registrar_troca_titular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.proprietario IS NOT NULL AND btrim(NEW.proprietario) <> '' THEN
      INSERT INTO public.recargas_celulares_titulares (linha_id, colaborador)
      VALUES (NEW.id, NEW.proprietario);
    END IF;
    RETURN NEW;
  END IF;

  -- Só reage a troca real de nome (ignora acerto de espaço/caixa).
  IF lower(btrim(coalesce(NEW.proprietario, ''))) IS DISTINCT FROM
     lower(btrim(coalesce(OLD.proprietario, ''))) THEN
    UPDATE public.recargas_celulares_titulares
       SET ate = CURRENT_DATE
     WHERE linha_id = NEW.id AND ate IS NULL;

    IF NEW.proprietario IS NOT NULL AND btrim(NEW.proprietario) <> '' THEN
      INSERT INTO public.recargas_celulares_titulares (linha_id, colaborador)
      VALUES (NEW.id, NEW.proprietario);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rc_troca_titular ON public.recargas_celulares;
CREATE TRIGGER trg_rc_troca_titular
  AFTER INSERT OR UPDATE OF proprietario ON public.recargas_celulares
  FOR EACH ROW EXECUTE FUNCTION public.registrar_troca_titular();

-- ── 4. Ponto de partida com o que já existe ─────────────────────────────────
-- Abre o período do titular atual de cada linha. Sem isso, o histórico só começaria a
-- existir na próxima troca, e as 67 linhas de hoje ficariam sem titular nenhum.
INSERT INTO public.recargas_celulares_titulares (linha_id, colaborador, de)
SELECT c.id, c.proprietario, COALESCE(c.created_at::date, CURRENT_DATE)
FROM public.recargas_celulares c
WHERE c.proprietario IS NOT NULL
  AND btrim(c.proprietario) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.recargas_celulares_titulares t
    WHERE t.linha_id = c.id AND t.ate IS NULL
  );

-- A última recarga conhecida vira a primeira entrada do histórico. É só um ponto de
-- partida: as recargas anteriores a ela não foram guardadas em lugar nenhum.
INSERT INTO public.recargas_celulares_historico (linha_id, colaborador, numero, valor, recarregado_em)
SELECT c.id, c.proprietario, c.numero, COALESCE(c.valor, 0), c.ultima_recarga
FROM public.recargas_celulares c
WHERE c.ultima_recarga IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recargas_celulares_historico h
    WHERE h.linha_id = c.id AND h.recarregado_em = c.ultima_recarga
  );

-- ── 5. RLS: mesmo padrão das demais tabelas de recargas ─────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recargas_celulares_historico TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recargas_celulares_titulares TO authenticated;
GRANT ALL ON public.recargas_celulares_historico TO service_role;
GRANT ALL ON public.recargas_celulares_titulares TO service_role;

ALTER TABLE public.recargas_celulares_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recargas_celulares_titulares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth all rch" ON public.recargas_celulares_historico
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth all rct" ON public.recargas_celulares_titulares
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
