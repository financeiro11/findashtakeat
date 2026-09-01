-- A SOMBRA 1 casa por cnpj+valor+MÊS DO FATURAMENTO, e não tinha índice.
-- O `nf_os_omie_casamento_idx` serve as sombras 2 e 3 (que usam `data_previsao`)
-- e deixava a primeira varrendo a tabela para cada cobrança. Custava pouco com
-- ~2.500 cobranças na janela; com o corte em 01/01/2026 são 20.560, e o custo
-- virou 8,5s por chamada da fila. Com o índice: 5,2s.
create index concurrently if not exists nf_os_omie_sombra_competencia_idx
  on public.nf_os_omie (cnpj_cpf, valor, data_faturamento)
  where cancelada = false and nfse_status = '004';
