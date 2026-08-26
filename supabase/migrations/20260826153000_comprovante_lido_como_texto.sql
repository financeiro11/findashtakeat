-- comprovantes_drive.lido_como ganha 'texto'
--
-- Até aqui a lista era danfe | ocr | nome_arquivo | xml | nome_chave, e ela
-- descrevia COMO o dado foi obtido — o que é justamente o que se quer saber
-- quando um valor parece errado.
--
-- Faltava um caso, e ele apareceu em 26/08/2026: PDF com senha de abertura.
-- O boleto da INFORMA MARKETS e a fatura da VERISURE chegam cifrados todo mês
-- (senha = os cinco primeiros dígitos do CNPJ da casa). Depois de decifrar,
-- o texto vem inteiro — 1.798 e 2.264 caracteres —, mas não é DANFE, e mandar
-- os bytes ainda cifrados para o OCR só rende `400 INVALID_ARGUMENT`.
-- A leitura passou a ser feita sobre o TEXTO extraído, e isso é uma procedência
-- diferente de 'ocr': ninguém olhou pixel nenhum. Quem for conferir o valor
-- precisa saber disso.

alter table public.comprovantes_drive
  drop constraint if exists comprovantes_drive_lido_ck;

alter table public.comprovantes_drive
  add constraint comprovantes_drive_lido_ck
  check (
    lido_como is null
    or lido_como = any (array['danfe', 'ocr', 'nome_arquivo', 'xml', 'nome_chave', 'texto'])
  );

comment on column public.comprovantes_drive.lido_como is
  'Procedência do dado: danfe (texto do PDF), texto (texto de PDF que só abriu com senha), ocr (imagem lida pelo modelo), xml, nome_arquivo, nome_chave.';
