-- Exceção de data de pagamento, presa a UMA competência.
--
-- A regra continua valendo: vencimento no dia 5 do mês seguinte e, quando o
-- dia 5 cai no fim de semana, a previsão anda para a segunda.
--
-- Mas mês de exceção existe. Setembro/2026 antecipou o pagamento de segunda
-- (07/09) para a sexta anterior (04/09), por decisão interna, só naquele mês.
-- Mexer em `previsaoDe` para acomodar isso transformaria a exceção de um mês
-- na regra de todos os meses seguintes, e ninguém lembraria de desfazer.
--
-- Por isso a exceção é DADO, não código: uma linha, uma competência, com o
-- motivo escrito. A prévia mostra as duas datas lado a lado — a que a regra
-- daria e a que vai valer — para a diferença nunca passar despercebida.

alter table public.folha_envios_omie
  add column if not exists previsao_ajustada date,
  add column if not exists previsao_motivo   text;

comment on column public.folha_envios_omie.previsao_ajustada is
  'Data de pagamento que substitui a da regra NESTA competência. Nulo = vale a regra.';

-- Competência agosto/2026: registra 31/08, vence 05/09 (sábado), a regra daria
-- previsão 07/09 (segunda). Antecipado para sexta, 04/09.
insert into public.folha_envios_omie (competencia, estado, previsao_ajustada, previsao_motivo)
values (date '2026-08-01', 'pendente', date '2026-09-04',
        'Exceção de setembro/2026: pagamento antecipado da segunda (07/09) para a sexta anterior (04/09), por decisão interna. Só este mês.')
on conflict (competencia) do update set
  previsao_ajustada = excluded.previsao_ajustada,
  previsao_motivo   = excluded.previsao_motivo;
