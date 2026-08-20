-- Emissão de NFS-e tem TRÊS desfechos, não dois.
--
-- O diário de `nf_emissoes` só aceitava 'ok' e 'erro'. Só que o faturamento do
-- Omie é assíncrono: `FaturarLoteOS` devolve um lote e a nota nasce minutos
-- depois (a OS 1628 levou 3 min entre o disparo às 11:18 e o DONE às 11:21).
-- Quando a espera da Edge Function acaba antes do lote, o que existe não é
-- fracasso — é nota a caminho da prefeitura.
--
-- Gravar isso como 'erro' tem consequência prática: a fila do que falta emitir
-- engorda com nota que já está sendo emitida, e quem olhar a fila vai mandar
-- emitir de novo. Nota duplicada não se apaga, cancela-se com prazo e
-- justificativa. Daí o terceiro valor.

alter table public.nf_emissoes drop constraint if exists nf_emissoes_resultado_check;

alter table public.nf_emissoes
  add constraint nf_emissoes_resultado_check
  check (resultado = any (array['ok'::text, 'erro'::text, 'em_processamento'::text]));

comment on column public.nf_emissoes.resultado is
  'ok = nota emitida; erro = o Omie recusou; em_processamento = lote disparado e ainda RUNNING (a nota pode nascer depois — não é para reemitir).';
