alter table public.nf_os_omie add column if not exists excluida_em timestamptz;
comment on column public.nf_os_omie.excluida_em is
  'Quando a OS foi APAGADA no Omie (ExcluirOS) para liberar o carimbo pay_ de uma cobranca cujo RPS foi recusado. A linha fica com cancelada=true, que e o campo que as cinco leituras fiscais filtram; esta coluna diz o que de fato aconteceu com ela.';
