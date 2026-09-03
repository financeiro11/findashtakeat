-- REFAZER A NOTA DEIXA RASTRO
--
-- Cancelar uma NFS-e e emitir outra no lugar é a operação mais irreversível
-- deste módulo, e até hoje ela acontecia em dois sistemas, na mão, sem registro
-- em lugar nenhum: alguém cancelava no painel do Asaas, corrigia o valor da
-- cobrança, esperava o espelho e mandava emitir aqui. Quatro passos, duas telas,
-- e um buraco no meio — se o espelho não tivesse atualizado, a nota nova saía
-- com o valor velho (conserto em `curarEspelho`, 02/09/2026).
--
-- O histórico do Banestes mostra que isso não é raro: três notas canceladas e
-- refeitas em 2026 (jan, jul e out/25), sempre pelo mesmo motivo — o valor do
-- contrato mudou depois de a nota sair.
--
-- Esta migration abre espaço no diário para o ato. Duas ações novas:
--
--   `cancelar_asaas` — a nota do Asaas foi cancelada por nós, com justificativa.
--   `refazer`        — o ato inteiro, do cancelamento à nova emissão.
--
-- E `asaas_nf_desligamento` ganha um terceiro alvo. O nome da tabela ficou
-- estreito (ela nasceu para o desligamento de 01/09), mas o que ela guarda é
-- exatamente o que precisa ser guardado aqui: A FOTO DO QUE FOI APAGADO, antes
-- de apagar. Criar uma segunda tabela com a mesma função só para o nome ficar
-- bonito espalharia a prova em dois lugares — e é a prova que importa quando a
-- contabilidade perguntar, meses depois, por que a nota 16172 não existe mais.

alter table public.nf_emissoes drop constraint if exists nf_emissoes_acao_check;
alter table public.nf_emissoes add constraint nf_emissoes_acao_check
  check (acao = any (array[
    'criar_os', 'faturar', 'criar_e_faturar', 'previa', 'email',
    'cancelar_asaas', 'refazer'
  ]));

alter table public.asaas_nf_desligamento drop constraint if exists asaas_nf_desligamento_alvo_check;
alter table public.asaas_nf_desligamento add constraint asaas_nf_desligamento_alvo_check
  check (alvo = any (array['assinatura', 'nota_agendada', 'nota_refeita']));

comment on column public.asaas_nf_desligamento.alvo is
  'assinatura = invoiceSettings apagado no corte de 01/09/2026; nota_agendada = NFS-e SCHEDULED '
  'cancelada no mesmo corte; nota_refeita = NFS-e cancelada para ser reemitida pelo Omie, com a '
  'justificativa em `erro` e o objeto original em `config`.';
