-- REFAZER NOTA DO OMIE PELO HUB (15/09/2026).
--
-- Até aqui a nota emitida pelo Omie só se cancelava na tela do Omie: a varredura
-- de 25/08/2026 procurou cancelamento em `servicos/os` e `servicos/nfse` e não
-- achou nada. O método mora em `servicos/osp` ("Faturamento de OS"):
-- `CancelarOS` cancela a OS e, com `cCancelarNfse = "S"`, a NFS-e na prefeitura.
-- Junto dele, `AssociarCodIntOS` troca o carimbo da OS — é o que solta o
-- `pay_…` da OS cancelada para a nota nova sair NA MESMA cobrança.
--
-- O diário (`nf_emissoes.acao`) tem CHECK fechado, então as duas ações novas
-- precisam entrar aqui antes de a função gravá-las.

alter table public.nf_emissoes drop constraint if exists nf_emissoes_acao_check;
alter table public.nf_emissoes add constraint nf_emissoes_acao_check check (acao = any (array[
  'criar_os', 'faturar', 'criar_e_faturar', 'previa', 'email', 'cancelar_asaas', 'refazer',
  'cancelar_omie', 'soltar_carimbo'
]));
