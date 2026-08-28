-- O item que ficou sem a frase ganha uma segunda chance, antes de alguém ler.
--
-- O QUE ACONTECEU NA ESTREIA (28/08/2026). A rodada gravou quatro notícias e
-- três saíram SEM o "por que importa". Os logs contaram o porquê: as quatro
-- redações foram pedidas ao Gemini em paralelo — pareciam independentes, e são —
-- e das quatro, uma respondeu, duas voltaram "Falha ao consultar a IA" e a
-- quarta estourou o prazo de 20s.
--
-- Duas correções, e elas resolvem coisas diferentes:
--
--   1. A rodada passou a redigir EM SÉRIE, com uma segunda tentativa. É o
--      conserto da causa. Seis chamadas em série com o modelo lite são ~20s,
--      que cabem de sobra no que resta do worker depois das buscas.
--
--   2. Este cron, que é o conserto do ESTRAGO — e continua fazendo falta mesmo
--      com a causa corrigida. A redação vai falhar de novo em algum dia: o
--      Gemini soluça, o worker acaba o tempo, a rodada grava o que tem. Sem uma
--      segunda passada, o card fica mudo até alguém marcar como lido. E card
--      mudo não parece defeito: parece notícia sem importância.
--
-- NÃO GASTA CRÉDITO DE RASPAGEM. É só IA sobre o que já está no banco — e é
-- justamente por isso que vale rodar todo dia sem pensar duas vezes. Consertar
-- redação buscando tudo de novo seria pagar Firecrawl por um erro do Gemini.
--
-- 10:55 UTC = 07:55 BRT: quinze minutos depois da varredura (07:40) e uma hora
-- antes de a skill de briefing rodar (09:00), que é quando a tela é aberta.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'briefing-noticias-redigir') then
    perform cron.unschedule('briefing-noticias-redigir');
  end if;
  perform cron.schedule('briefing-noticias-redigir', '55 10 * * *', $cmd$
    select public.disparar_automacao(
      'briefing-noticias-redigir',
      'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/briefing-noticias',
      '{"action":"redigir","limite":8}'::jsonb,
      'briefing-noticias',
      '{}'::jsonb,
      150000
    );
  $cmd$);
end $$;
