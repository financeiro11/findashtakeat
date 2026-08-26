-- Saber, sem abrir o Omie, que o e-mail da nota foi disparado.
--
-- NÃO EXISTE ENDPOINT DE E-MAIL na API do Omie. Sondado com controle em
-- 25/08/2026 (`{"action":"sondar_metodos"}`): `ListarEmails`, `ObterEmails`,
-- `ConsultarEmails`, `EnviarEmail`, `ReenviarEmail`, `EnviarNFSePorEmail` em
-- `servicos/os`, `servicos/osdocs`, `servicos/oslote` e `geral/email` — todos
-- "Method not exists", com os controles se comportando (`StatusOS` existe,
-- endpoint falso acusado). A aba "Emails Enviados" da OS é só tela.
--
-- O que dá para afirmar é o GATILHO, e ele é determinístico: a OS nasce com
-- `cEnvLink: "S"` e um destinatário, e o Omie dispara o e-mail no momento em que a
-- nota é AUTORIZADA. Guardar as duas pontas aqui deixa o diário registrar o
-- disparo na hora em que ele acontece, em vez de mandar alguém conferir no ERP.
--
-- O que estas colunas NÃO provam: entrega. Ninguém consegue provar entrega por
-- API — nem o Omie mostra isso. O diário diz "disparado", que é o que se sabe.

alter table public.nf_os_omie
  add column if not exists email_envio   boolean,
  add column if not exists email_destino text;

-- O diário ganha um passo. Sem isto o insert morre em
-- `nf_emissoes_acao_check` -- a lista de ações é fechada de propósito, para o
-- diário não virar depósito de texto solto.
alter table public.nf_emissoes drop constraint if exists nf_emissoes_acao_check;
alter table public.nf_emissoes
  add constraint nf_emissoes_acao_check
  check (acao in ('criar_os', 'faturar', 'criar_e_faturar', 'previa', 'email'));

comment on column public.nf_os_omie.email_envio is
  'A OS foi criada com cEnvLink=S: o Omie manda o link da NFS-e quando a prefeitura autoriza. NULL = OS anterior ao envio automatico (ligado em 25/08/2026).';
comment on column public.nf_os_omie.email_destino is
  'O que foi para cEnviarPara -- o e-mail do cliente no Asaas. Vazio nao impede o envio: o Omie cai no e-mail do cadastro do cliente no proprio ERP.';

/* Retroativo, e só do destinatário.
 *
 * `montarOS` põe em `cEnviarPara` exatamente o e-mail do cliente no Asaas, então
 * ele é reconstituível sem falar com o Omie. Já o `email_envio` NÃO é: OS antigas
 * nasceram com `cEnvLink: "N"`, e marcá-las como "manda e-mail" seria inventar
 * histórico. Elas ficam em NULL, que é a verdade — não se sabe, e não mandou. */
update public.nf_os_omie os
set email_destino = nullif(trim(cli.dados->>'email'), '')
from public.asaas_cache pag
join public.asaas_cache cli
  on cli.tipo = 'customer'
 and cli.id_asaas = pag.dados->>'customer'
where pag.tipo = 'payment'
  and pag.id_asaas = os.c_cod_int_os
  and os.email_destino is null;
