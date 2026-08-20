-- Por que a nota não saiu — a resposta já vinha, e era descartada.
--
-- O `StatusOS` do Omie devolve, dentro de ListaRpsNfse[], um array `mensagens`
-- com a recusa da prefeitura em português. O espelho guardava número, RPS,
-- status, lote e XML — e deixava a mensagem cair no chão. Resultado: 277 OS
-- faturadas paradas no status '003' (RPS enviado, nota nunca autorizada) sem que
-- nada na tela dissesse o motivo, o que faz a fila parecer lentidão da prefeitura
-- quando é erro de cadastro nosso.
--
-- Medido em 20/08/26, lendo as presas uma a uma:
--   E0240 : O CEP informado para o endereço nacional do tomador do serviço não
--           existe ou não pertence ao município do endereço do tomador.
--
-- É a mesma família do que derrubou 7 das 211 OS do lote manual de junho ("falta
-- preencher o E-mail", "CEP não pertence à faixa válida para o estado RJ"): nada
-- de fiscal, nada de certificado — cadastro de cliente. Com a mensagem gravada,
-- a lista do que está preso vira lista do que precisa ser corrigido.

alter table public.nf_os_omie
  add column if not exists nfse_mensagem text;

comment on column public.nf_os_omie.nfse_mensagem is
  'Recusa da prefeitura para o RPS (StatusOS > ListaRpsNfse[].mensagens), em português. Preenchida so quando existe: status 004 vem sem mensagem.';
