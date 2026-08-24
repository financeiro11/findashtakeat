-- O carimbo da NFS-e de volta na cobrança do Asaas.
--
-- A integração com o Asaas nasceu de mão única: o Hub lia a cobrança, emitia a
-- nota pelo Omie e não devolvia nada. Quem abria o portal do Asaas para conferir
-- se a cobrança virou nota não encontrava sinal nenhum — nem de sucesso, nem de
-- falha —, porque nunca houve escrita naquele lado. Estas três colunas são o
-- rastro LOCAL dessa escrita: o que foi carimbado, quando, e o que o Asaas
-- respondeu quando recusou.
--
-- `asaas_carimbado_em` é o que torna a varredura idempotente: quem já tem data
-- não é oferecido de novo. `asaas_carimbo_erro` guarda a última recusa para que a
-- cobrança continue na fila sem virar tentativa infinita silenciosa.

alter table public.nf_os_omie
  add column if not exists asaas_carimbo      text,
  add column if not exists asaas_carimbado_em timestamptz,
  add column if not exists asaas_carimbo_erro text;

comment on column public.nf_os_omie.asaas_carimbo is
  'Texto gravado em externalReference da cobrança do Asaas (ex.: "NFS-e 16902 · OS 1629").';
comment on column public.nf_os_omie.asaas_carimbado_em is
  'Quando o carimbo foi aceito pelo Asaas. Nulo = ainda na fila da varredura.';
comment on column public.nf_os_omie.asaas_carimbo_erro is
  'Última recusa do Asaas ao carimbo, em texto. Limpa quando o carimbo passa.';
