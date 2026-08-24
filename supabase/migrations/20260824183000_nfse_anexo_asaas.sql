-- O sinal no Asaas mudou de mecanismo: de campo editado para arquivo anexado.
--
-- A migration anterior (20260824180000) nasceu para gravar o número da NFS-e em
-- `externalReference` da cobrança. O Asaas recusou, e recusou por escrito:
--
--     PUT /payments/pay_uw42beld2bddv6z5
--     400 invalid_object — "Só é possível editar cobranças pendentes ou vencidas."
--
-- Como nota fiscal só se emite de cobrança RECEBIDA, a regra exclui exatamente
-- as cobranças que interessam: numa cobrança que virou nota, nenhum campo é
-- editável. O que passa é `POST /payments/{id}/documents`, que ACRESCENTA um
-- arquivo em vez de alterar a cobrança — e por isso o rastro local deixa de ser
-- "o texto que carimbamos" e passa a ser "o documento que subimos".
--
-- `asaas_anexo_id` é o id do documento no Asaas: é ele que permite conferir (ou
-- remover) o anexo depois, sem depender de procurar pelo nome do arquivo.

alter table public.nf_os_omie rename column asaas_carimbo      to asaas_anexo_nome;
alter table public.nf_os_omie rename column asaas_carimbado_em to asaas_anexado_em;
alter table public.nf_os_omie rename column asaas_carimbo_erro to asaas_anexo_erro;

alter table public.nf_os_omie
  add column if not exists asaas_anexo_id text;

comment on column public.nf_os_omie.asaas_anexo_nome is
  'Nome do arquivo anexado na cobrança do Asaas (ex.: "NFS-e 16902 - OS 1629.xml").';
comment on column public.nf_os_omie.asaas_anexo_id is
  'Id do documento no Asaas, devolvido pelo upload.';
comment on column public.nf_os_omie.asaas_anexado_em is
  'Quando o anexo foi aceito pelo Asaas. Nulo = ainda na fila da varredura.';
comment on column public.nf_os_omie.asaas_anexo_erro is
  'Última falha ao anexar, em texto. Limpa quando o anexo passa.';

-- A recusa do PUT ficou gravada nas linhas do experimento; ela fala de um
-- mecanismo que não existe mais e só confundiria quem lesse a coluna depois.
update public.nf_os_omie
   set asaas_anexo_erro = null
 where asaas_anexo_erro like '%Só é possível editar cobranças%';
