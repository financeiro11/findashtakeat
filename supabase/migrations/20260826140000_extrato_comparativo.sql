-- Comparativo do mês contra o mesmo período do mês anterior, na aba Extratos do celular.
--
-- POR QUE UMA FUNÇÃO, E NÃO MAIS UMA LEITURA: o comparativo precisa de três números, não
-- de linhas. Buscar o mês anterior inteiro pelo PostgREST custaria 4 requisições e ~190 KB
-- só no Asaas (julho/26 tem 3.128 lançamentos), e cresceria junto com o volume. Aqui é UMA
-- requisição e ~200 bytes, e o `jsonb` ainda escapa do teto de mil linhas do PostgREST,
-- que é justamente o defeito que a tela acabou de corrigir.
--
-- "MESMO PERÍODO" NÃO É A MESMA COISA NAS TRÊS FONTES:
--
--   * Bancos (Sicoob, Asaas) — o extrato é contínuo e o mês corrente está pela metade. Em
--     26/08/2026 o dado vai até o dia 25, então agosto 1–25 compara com julho 1–25. Sem a
--     janela, um mês pela metade sempre "cairia" contra o mês anterior inteiro, e o número
--     diria queda todo santo mês até o dia 31.
--
--   * Cartão — a fatura é um documento FECHADO, e o ciclo não começa no dia 1: a de ago/26
--     tem compras desde 10/09/2025, porque parcela antiga entra na fatura nova. Recortar
--     por dia do mês ali não significaria nada. Fatura inteira contra fatura inteira é a
--     única leitura honesta, e é o que a pessoa confere.
--
-- O dia de corte sai do DADO (o lançamento mais recente do mês), não de `now()`: quando a
-- sync atrasa um dia, comparar agosto 1–25 contra julho 1–26 inventaria uma queda que é só
-- o dado que não chegou.
--
-- E O MOTIVO DE EXISTIR `comparavel`: o espelho não cobre o passado inteiro. O do Asaas
-- começa em 25/07/2026 (primeira carga em 29/07), então "julho 1–25" nele são 25 linhas de
-- um dia só — comparar agosto contra isso daria +136.000%, um número que parece
-- crescimento e é ausência de dado. A função devolve a data em que a cobertura começa e
-- diz se a comparação se sustenta; sem isso a tela mentiria com toda a confiança, que é
-- exatamente o defeito que ela acabou de corrigir.

create or replace function public.extrato_comparativo(p_fonte text, p_mes date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mes   date := date_trunc('month', p_mes)::date;
  v_ant   date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_dia   int;
  /** Primeira data que o espelho cobre, na fonte inteira — não no mês. */
  v_desde date;
  v_atual    jsonb;
  v_anterior jsonb;
  v_ok       boolean;
begin
  if p_fonte = 'cartao' then
    -- Fatura inteira contra fatura inteira; `v_dia` fica nulo e a tela rotula "fatura".
    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where tipo in ('pagamento','estorno')), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where tipo not in ('pagamento','estorno')), 0),
             'n',        count(*))
      into v_atual
      from cartao_lancamentos where competencia = v_mes;

    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where tipo in ('pagamento','estorno')), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where tipo not in ('pagamento','estorno')), 0),
             'n',        count(*))
      into v_anterior
      from cartao_lancamentos where competencia = v_ant;

    -- A fatura entra inteira, de um OFX só: ou ela foi importada, ou não existe.
    v_ok := (v_anterior->>'n')::int > 0;

  elsif p_fonte = 'asaas' then
    select min(data_movimento) into v_desde from asaas_extrato;
    select max(extract(day from data_movimento))::int into v_dia
      from asaas_extrato
     where data_movimento >= v_mes and data_movimento < v_mes + interval '1 month';

    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where lower(tipo) like 'cred%'), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where lower(tipo) not like 'cred%'), 0),
             'n',        count(*))
      into v_atual
      from asaas_extrato
     where data_movimento >= v_mes and data_movimento < v_mes + interval '1 month'
       and (v_dia is null or extract(day from data_movimento) <= v_dia);

    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where lower(tipo) like 'cred%'), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where lower(tipo) not like 'cred%'), 0),
             'n',        count(*))
      into v_anterior
      from asaas_extrato
     where data_movimento >= v_ant and data_movimento < v_ant + interval '1 month'
       and (v_dia is null or extract(day from data_movimento) <= v_dia);

  elsif p_fonte = 'sicoob' then
    select min(data_movimento) into v_desde from sicoob_extrato;
    select max(extract(day from data_movimento))::int into v_dia
      from sicoob_extrato
     where data_movimento >= v_mes and data_movimento < v_mes + interval '1 month';

    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where lower(tipo) like 'cred%'), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where lower(tipo) not like 'cred%'), 0),
             'n',        count(*))
      into v_atual
      from sicoob_extrato
     where data_movimento >= v_mes and data_movimento < v_mes + interval '1 month'
       and (v_dia is null or extract(day from data_movimento) <= v_dia);

    select jsonb_build_object(
             'entradas', coalesce(sum(abs(valor)) filter (where lower(tipo) like 'cred%'), 0),
             'saidas',   coalesce(sum(abs(valor)) filter (where lower(tipo) not like 'cred%'), 0),
             'n',        count(*))
      into v_anterior
      from sicoob_extrato
     where data_movimento >= v_ant and data_movimento < v_ant + interval '1 month'
       and (v_dia is null or extract(day from data_movimento) <= v_dia);

  else
    raise exception 'fonte desconhecida: %', p_fonte;
  end if;

  -- Nos bancos a pergunta não é "veio alguma coisa?", é "o espelho cobria a janela toda?".
  -- Um mês pode legitimamente não ter movimento no dia 1º (fim de semana), então olhar o
  -- primeiro dia COM LANÇAMENTO confundiria feriado com dado ausente; o que decide é onde
  -- a cobertura da fonte começa.
  if p_fonte <> 'cartao' then
    v_ok := v_desde is not null and v_desde <= v_ant and (v_anterior->>'n')::int > 0;
  end if;

  return jsonb_build_object(
    'mes',      to_char(v_mes, 'YYYY-MM'),
    'anterior_mes', to_char(v_ant, 'YYYY-MM'),
    -- Nulo no cartão (fatura inteira); nos bancos, o dia em que o dado do mês para.
    'ate_dia',  v_dia,
    'comparavel', coalesce(v_ok, false),
    'cobertura_desde', v_desde,
    'atual',    v_atual,
    'anterior', v_anterior);
end;
$$;

comment on function public.extrato_comparativo(text, date) is
  'Somas do mês e do mesmo período do mês anterior, para a aba Extratos do celular. '
  'Bancos comparam por janela de dia do mês (o mês corrente está pela metade); o cartão '
  'compara fatura inteira, porque o ciclo dela não começa no dia 1.';

-- Função em `public` nasce executável SEM LOGIN neste projeto, e o EXECUTE pode chegar
-- por PUBLIC ou por um grant direto a `anon` — revogar de um só deixa o outro de pé.
-- Sem isto, o movimento financeiro do mês responderia à anon key, que está no bundle.
-- Cada revoke em sua própria instrução: em bloco, um erro no meio aborta o resto.
revoke all on function public.extrato_comparativo(text, date) from public;
revoke all on function public.extrato_comparativo(text, date) from anon;
grant execute on function public.extrato_comparativo(text, date) to authenticated, service_role;
