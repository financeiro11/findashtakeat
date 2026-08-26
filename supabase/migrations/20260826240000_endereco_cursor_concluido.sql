-- Quando a varredura de endereço terminou a volta completa.
--
-- Sem isto, `pagina = 1` é ambíguo: significa tanto "nunca começou" quanto
-- "acabou de dar a volta". Um cron de várias janelas (são 141 páginas, ~5
-- invocações) leria a segunda como a primeira e recomeçaria a varredura inteira
-- duas ou três vezes por semana, de graça, contra o limite do Omie.
alter table public.omie_clientes_endereco_cursor
  add column if not exists concluido_em timestamptz;

comment on column public.omie_clientes_endereco_cursor.concluido_em is
  'Fim da última volta completa. A varredura pula quando a volta é recente — ver `varrerEnderecos`.';
