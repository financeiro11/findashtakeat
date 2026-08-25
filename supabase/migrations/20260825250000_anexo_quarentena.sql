-- A fila de anexos para de se afogar no mesmo comprovante.
--
-- O QUE ACONTECEU (25/08/2026, medido nos logs do worker). A varredura das 18:35
-- anexou três comprovantes e morreu: "CPU Time exceeded". Nas cinco rodadas
-- seguintes ela morreu de novo, sempre no mesmo ponto, e ZERO notas subiram — 64
-- pendentes atrás de um item que derruba o worker.
--
-- O erro comum a gente já sabia tratar: `varrer` tem try/catch e grava o motivo
-- em `omie_anexo_envio_log`. Só que MORTE NÃO É EXCEÇÃO. Quando o worker estoura
-- o orçamento de CPU ele é morto pelo runtime — o catch não roda, o diário não
-- recebe nada, e o item volta amanhã exatamente igual. Um item assim é veneno:
-- deterministicamente na cabeça da fila, deterministicamente fatal, e invisível.
--
-- A CORREÇÃO. Registrar a TENTATIVA antes de tentar. Quem morre no meio deixa
-- para trás uma linha 'tentando' que ninguém fechou — e três dessas, sem nenhum
-- 'ok', é a definição operacional de "este arquivo derruba o worker". A fila
-- passa a pular esse título, e o motivo fica escrito onde alguém lê.
--
-- É o mesmo remédio de `omie_titulo_nome_cartao.tentativas` e do `retentar` da
-- varredura de anexos: recusa sem rastro é indistinguível de esquecimento.

/* ---------------------------------------------------------------------------
 * 'tentando' passa a ser um resultado válido
 * ------------------------------------------------------------------------- */

alter table public.omie_anexo_envio_log
  drop constraint if exists omie_anexo_envio_log_resultado_check;

alter table public.omie_anexo_envio_log
  add constraint omie_anexo_envio_log_resultado_check
  check (resultado in ('ok', 'erro', 'bloqueado', 'tentando'));

comment on column public.omie_anexo_envio_log.resultado is
  'ok | erro | bloqueado | tentando. "tentando" é gravado ANTES do envio e fica órfão quando o worker é morto no meio — é assim que se enxerga o item que derruba a rodada.';

create index if not exists omie_anexo_envio_log_titulo_idx
  on public.omie_anexo_envio_log (cod_titulo, resultado);

/* ---------------------------------------------------------------------------
 * A quarentena
 * ------------------------------------------------------------------------- */

drop view if exists public.omie_anexo_quarentena;

create view public.omie_anexo_quarentena as
select
  cod_titulo,
  count(*) filter (where resultado = 'tentando') as tentativas,
  count(*) filter (where resultado = 'erro')     as erros,
  max(criado_em)                                 as ultima_tentativa,
  max(motivo) filter (where resultado = 'erro')  as ultimo_motivo
from public.omie_anexo_envio_log
where cod_titulo is not null and cod_titulo <> ''
group by cod_titulo
-- Três tentativas sem desfecho, OU três erros — os dois querem dizer a mesma
-- coisa, e a diferença é só se ficou escrito o porquê. O comprovante de 9,7 MB
-- errava com motivo bonito em toda rodada desde as 18:35 e nunca ia subir: uma
-- quarta tentativa não deixa o arquivo menor. Insistir é gastar a fila.
having (count(*) filter (where resultado = 'tentando') >= 3
     or count(*) filter (where resultado = 'erro')     >= 3)
   -- Um 'ok' em qualquer momento absolve: o arquivo subiu, e as tentativas
   -- anteriores foram só o caminho até lá.
   and count(*) filter (where resultado = 'ok') = 0;

comment on view public.omie_anexo_quarentena is
  'Títulos que a varredura já tentou três vezes sem conseguir — por erro repetido ou por derrubar o worker sem deixar rastro. A fila os pula. Para soltar um: resolva o comprovante (menor, em PDF, ou liberando o acesso no Drive) e apague as linhas deste cod_titulo em omie_anexo_envio_log.';

grant select on public.omie_anexo_quarentena to authenticated, service_role;
