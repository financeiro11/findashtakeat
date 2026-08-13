-- Habilita Realtime nas tabelas de recarga.
--
-- Uma inscrição via `supabase.channel()` só recebe evento se a tabela estiver na
-- publicação `supabase_realtime`. Sem isto o canal conecta, o `subscribe()` responde
-- SUBSCRIBED e nada nunca dispara — falha silenciosa, das piores de diagnosticar,
-- porque tudo indica que está funcionando.
--
-- Quem solicita a recarga está no TakeatOS; quem atende está com a tela de Recargas
-- aberta. Sem o push, o Financeiro só veria o pedido novo ao recarregar a página, e a
-- fila de ~40 por dia é trabalhada de forma contínua.
--
-- Realtime é push, não polling: o Postgres avisa quando a linha entra, em vez de o
-- navegador perguntar a cada X segundos se algo mudou.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'recargas_celulares_solicitacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recargas_celulares_solicitacoes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'recargas_celulares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recargas_celulares;
  END IF;
END $$;
