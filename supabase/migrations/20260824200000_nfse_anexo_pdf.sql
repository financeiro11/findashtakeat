-- A cobrança passa a receber DOIS arquivos: o espelho em PDF e o XML.
--
-- Por que o PDF é desenhado pelo Hub e não baixado de algum lugar: não existe
-- lugar. Medido em 24/08/26 —
--   • Omie: `danfe` do RPS vazio; `ObterDANFSE`, `ImprimirNFSe`, `ObterPDFNFSe`,
--     `ObterArquivoNFSe` e `servicos/nfse/*` respondem "Method not exists"; e
--     `geral/anexo/ListarAnexo` na tabela `ordem-servico` (a válida, segundo a
--     crítica do próprio Omie) devolve ZERO anexos para a OS faturada.
--   • Portal Nacional: consulta pública exige hCaptcha; a rota de DANFSe do
--     SEFIN Nacional devolve 403 (exige certificado) e o ADN, 496.
-- O XML assinado é o que se tem — e como o DANFSe é, por definição, documento
-- AUXILIAR, desenhar a representação a partir dele é legítimo. Ver _shared/danfse.ts.
--
-- O registro deixa de ser "o anexo" e passa a ser "os anexos": `asaas_anexos` é
-- uma lista de {tipo, id, nome}. Duas colunas de uso único não descreveriam dois
-- arquivos que podem chegar em rodadas diferentes — foi o que aconteceu com as
-- duas primeiras cobranças, que receberam o XML antes de o PDF existir.

alter table public.nf_os_omie
  add column if not exists asaas_anexos jsonb not null default '[]'::jsonb;

comment on column public.nf_os_omie.asaas_anexos is
  'Arquivos da nota anexados na cobrança do Asaas: [{tipo: pdf|xml, id, nome}].';

-- O que já subiu (só XML) vira o primeiro item da lista, sem perder o id.
update public.nf_os_omie
   set asaas_anexos = jsonb_build_array(
         jsonb_build_object('tipo', 'xml', 'id', asaas_anexo_id, 'nome', asaas_anexo_nome))
 where asaas_anexo_id is not null
   and asaas_anexos = '[]'::jsonb;

alter table public.nf_os_omie
  drop column if exists asaas_anexo_id,
  drop column if exists asaas_anexo_nome;

-- E quem foi anexado ANTES de o PDF existir volta para a fila: a varredura pula
-- quem tem `asaas_anexado_em`, e essas cobranças têm — mas com metade do que
-- deveriam ter. Zerar a data é o que as devolve à fila; lá, a conferência contra
-- a lista de documentos do Asaas garante que o XML não suba duas vezes.
update public.nf_os_omie
   set asaas_anexado_em = null
 where asaas_anexado_em is not null
   and not (asaas_anexos @> '[{"tipo":"pdf"}]'::jsonb);
