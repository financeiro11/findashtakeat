-- Alerta de reclassificação só em mês DESTRAVADO.
--
-- Mês travado é mês fechado: o valor na tela vem do tracker, o omie-sync nem
-- encosta na coluna, e corrigir a classificação lá não mudaria nada aqui — a
-- correção é no ERP e ponto. Avisar sobre o que não se vai mexer é ruído puro:
-- com as travas de hoje (30 meses fechados, só Jul-26 aberto), isso é a
-- diferença entre 91 alertas e 26.
--
-- O CORTE É NA LEITURA, NÃO NA DETECÇÃO. A tabela continua guardando o alerta
-- do mês travado; destravar o mês (o painel permite, migration 20260803120000)
-- faz os avisos aparecerem na hora, sem esperar a próxima passada no Omie.

create or replace function public.demonstracoes_reclassificacoes(p_tipo text)
returns table (
  rubrica     text,
  mes         text,
  alertas     bigint,
  severidade  text,
  valor_total numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.rubrica,
    r.mes,
    count(*) as alertas,
    case
      when bool_or(r.severidade = 'alta')  then 'alta'
      when bool_or(r.severidade = 'media') then 'media'
      else 'baixa'
    end as severidade,
    sum(r.valor) as valor_total
  from omie_reclassificacoes r
  where r.tipo = p_tipo
    and r.status = 'aberto'
    and not exists (
      select 1 from demonstracoes_mes_trancado t where t.col_key = r.mes
    )
  group by r.rubrica, r.mes;
$$;

-- O drill-down segue a mesma regra: mês travado abre a lista de lançamentos
-- normalmente, mas sem nenhum destaque de reclassificação. Se o detalhe
-- mostrasse o que a célula não marcou, as duas telas se contradiriam.
create or replace function public.demonstracoes_reclassificacoes_celula(
  p_tipo    text,
  p_rubrica text,
  p_mes     text
)
returns table (
  id               uuid,
  cod_titulo       text,
  fornecedor       text,
  rubrica_padrao   text,
  valor            numeric,
  valor_padrao     numeric,
  severidade       text,
  status           text,
  hist_lancamentos integer,
  hist_no_padrao   integer,
  ignorado_motivo  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, cod_titulo, fornecedor, rubrica_padrao, valor, valor_padrao,
         severidade, status, hist_lancamentos, hist_no_padrao, ignorado_motivo
  from omie_reclassificacoes
  where tipo = p_tipo and rubrica = p_rubrica and mes = p_mes
    and not exists (
      select 1 from demonstracoes_mes_trancado t where t.col_key = p_mes
    );
$$;
