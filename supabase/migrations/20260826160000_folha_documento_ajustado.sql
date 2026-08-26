-- Correção de DOCUMENTO no Hub, pelo mesmo motivo da correção de salário:
-- `rh_colaboradores` é espelho e o sync reescreve tudo a cada ciclo.
--
-- O espelho lido em 26/08/2026 tinha quatro pessoas dividindo o CNPJ
-- 37.511.891/0001-50, três documentos que perderam o zero à esquerda, um
-- truncado, um com o nome colado e um em branco. Nenhum deles acha fornecedor
-- no Omie — e sem fornecedor não existe título nenhum para a pessoa.
--
-- `documento` e não `cnpj`: uma das pessoas da folha é cadastrada por CPF, e
-- chamar a coluna de CNPJ faria alguém "consertar" o CPF um dia.
--
-- A carga veio da planilha Dados Pessoal, conferida pelo financeiro. Cuidado
-- ao reler aquele arquivo: três CNPJs estão em NOTAÇÃO CIENTÍFICA
-- ("6.6804297000156E13"), e tirar a pontuação com regex gera um número de 16
-- dígitos que parece válido e não é.

alter table public.folha_depara
  add column if not exists documento_ajustado     text,
  add column if not exists documento_rh_no_ajuste text,
  add column if not exists documento_motivo       text,
  add column if not exists documento_ajustado_em  timestamptz;

comment on column public.folha_depara.documento_ajustado is
  'CNPJ ou CPF corrigido no Hub, só dígitos. Quando preenchido, manda na busca do fornecedor.';

-- O log passa a servir aos dois campos. `de`/`para` numéricos continuam sendo
-- do salário; as colunas de texto servem ao documento.
alter table public.folha_ajustes_log
  add column if not exists campo      text not null default 'valor',
  add column if not exists de_texto   text,
  add column if not exists para_texto text;

comment on column public.folha_ajustes_log.campo is
  'Qual campo foi corrigido: valor (salário) ou documento (CNPJ/CPF).';
