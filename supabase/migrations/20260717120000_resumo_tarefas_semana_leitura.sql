-- A skill "analise-tarefas-semana" grava os números agregados em resumo_tarefas_semana.payload,
-- mas a leitura executiva (interpretação em prosa, escrita pelo agente) não tinha onde ser
-- publicada. Estas colunas permitem "lançar" essa leitura no Hub (mesmo padrão de
-- briefing_diario.conteudo_markdown): a skill grava aqui quando o usuário pedir para publicar.
alter table public.resumo_tarefas_semana
  add column if not exists leitura_md text,
  add column if not exists leitura_gerado_em timestamptz;

comment on column public.resumo_tarefas_semana.leitura_md is
  'Leitura executiva em markdown, publicada pela skill analise-tarefas-semana quando o usuário pede para lançar a análise no Hub. Nula até a primeira publicação.';
comment on column public.resumo_tarefas_semana.leitura_gerado_em is
  'Quando a leitura em prosa foi publicada — independente de resumo_tarefas_semana.gerado_em, que reflete só o recálculo do payload numérico.';
