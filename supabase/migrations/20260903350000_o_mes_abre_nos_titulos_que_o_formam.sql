-- O mês da ficha passa a abrir nos títulos que o formam.
--
-- A tela mostra "julho: R$ 17.383" e não havia como perguntar de onde saiu. Com
-- isto, cada mês abre nos lançamentos — categoria, valor, vencimento e o
-- `nCodTitulo`, que é por onde se acha a linha no Omie.
--
-- SEM `security definer`: roda como quem chamou, e a policy
-- `pode_ver_remuneracao()` de `remuneracao_lancamento` continua valendo. Quem
-- não tem o cargo recebe zero linhas — e não é só a tela que esconde.
--
-- Uma pessoa por vez, sob demanda, em vez de mandar os 1.064 lançamentos no
-- bloco do painel: são 152 pessoas × 6 meses, e ninguém abre mais que um punhado
-- deles numa sessão.

create or replace function public.remuneracao_lancamentos(
  p_pessoa      uuid,
  p_competencia date
)
returns table (
  cod_titulo text,
  bloco      text,
  categoria  text,
  valor      numeric,
  vencimento date,
  pagamento  date,
  fonte      text
)
language sql
stable
set search_path to 'public'
as $$
  select l.origem_ref, l.bloco, l.categoria, l.valor, l.vencimento, l.pagamento, l.fonte
  from public.remuneracao_lancamento l
  where l.pessoa_id = p_pessoa
    and l.competencia = p_competencia
  -- Fixo primeiro, depois o resto pelo valor: é a ordem em que a pessoa lê o
  -- mês dela — o salário e então o que veio por cima.
  order by (case l.bloco when 'fixo' then 0 when 'prolabore' then 1
                         when 'premiacao' then 2 when 'escala' then 3 else 4 end),
           l.valor desc
$$;

comment on function public.remuneracao_lancamentos(uuid, date) is
  'Os lançamentos que formam um mês de uma pessoa — o drill-down da ficha até o título do Omie.';

revoke all on function public.remuneracao_lancamentos(uuid, date) from anon;
grant execute on function public.remuneracao_lancamentos(uuid, date) to authenticated;
