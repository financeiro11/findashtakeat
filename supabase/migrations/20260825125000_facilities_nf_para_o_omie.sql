-- A NF de Facilities passa a ter caminho próprio até o título do Omie.
--
-- Até aqui a nota anexada numa compra de Facilities só chegava ao ERP por tabela
-- interposta: virava evidência da Auditoria (`facilities_nf_auditoria`), casava
-- com um achado, e o achado é que subia. Quando não havia achado correspondente
-- — e não há, porque a compra de Facilities costuma ser boleto/PIX que ninguém
-- auditou — a nota parava ali. Resultado medido em 25/08/2026: 41 compras,
-- R$ 46.240, ZERO notas anexadas e ZERO vínculos criados.
--
-- Com estas colunas a compra vira uma origem de primeira classe da varredura de
-- envio, igual ao achado e ao lançamento do cartão: tem arquivo, tem título,
-- não tem carimbo → sobe.

alter table public.facilities_compras
  add column if not exists omie_cod_titulo       text,
  add column if not exists omie_anexo_enviado_em timestamptz,
  add column if not exists omie_anexo_nome       text,
  add column if not exists omie_match_confianca  text,
  add column if not exists omie_matched_em       timestamptz;

comment on column public.facilities_compras.omie_cod_titulo is
  'Título do contas a pagar do Omie a que esta compra corresponde. Mesma chave que a auditoria usa.';
comment on column public.facilities_compras.omie_anexo_enviado_em is
  'Quando a NF desta compra foi anexada ao título no Omie. É o freio da varredura: sem ele, ela reenviaria tudo amanhã.';

create index if not exists facilities_compras_envio_pendente_idx
  on public.facilities_compras (data desc)
  where omie_anexo_enviado_em is null;

-- `nf_status` continua sendo só 'ok' | 'pendente' — é o contrato que a tela do
-- Facilities já usa para desenhar o selo, e um terceiro valor faria a compra que
-- acabou de chegar ao ERP aparecer como pendente. ONDE a nota está é outra
-- pergunta, e ela tem coluna própria: `omie_anexo_enviado_em`.
comment on column public.facilities_compras.nf_status is
  'ok (tem NF anexada no Hub) | pendente. Se ela já chegou ao Omie, quem diz é omie_anexo_enviado_em.';
