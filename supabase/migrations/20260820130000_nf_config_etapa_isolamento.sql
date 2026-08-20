-- A etapa que importa agora é a de ISOLAMENTO, não a de destino.
--
-- `etapa_faturamento` nasceu de uma leitura errada do Omie: a função subia a OS
-- até a etapa 60 ("Faturado") achando que isso emitia a nota. Não emite — 60 é
-- onde a OS CAI depois de faturada. Quem fatura é `servicos/oslote/FaturarLoteOS`,
-- e ele fatura A ETAPA INTEIRA, sem aceitar filtro por OS.
--
-- Como em 20/08/26 a etapa "50" (Faturar) guardava 523 OS antigas somando R$ 188
-- mil, faturar direto ali emitiria as 523. A emissão do Hub passou a mover a OS
-- sozinha para uma etapa vazia, conferir que ela está sozinha lá, e só então
-- disparar o lote. É essa etapa que precisa ser configurável — a "20" ("Em
-- Execução") é a escolhida por estar ativa no cadastro desta empresa e sem
-- nenhuma OS morando nela; a "40" está inativa e não serve.

alter table public.nf_config
  add column if not exists etapa_isolamento text not null default '20';

comment on column public.nf_config.etapa_isolamento is
  'Etapa vazia usada como corredor: a OS entra sozinha, o FaturarLoteOS roda sobre ela e a OS sai faturada. Trocar isto para uma etapa POVOADA emite nota de todas as OS que estiverem nela.';

comment on column public.nf_config.etapa_faturamento is
  'SEM USO desde 20/08/26. Trocar a etapa da OS nao fatura nada; o faturamento e o FaturarLoteOS sobre a etapa de isolamento. Mantida so para nao quebrar leitura antiga.';
