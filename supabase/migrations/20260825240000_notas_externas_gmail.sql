-- A caixa de e-mail entra na auditoria — pela porta que já existia.
--
-- O que se descobriu antes de escrever qualquer linha disto: os anexos do
-- e-mail JÁ ESTÃO NO DRIVE. Uma automação que roda na caixa `financeiro@`
-- (rótulo `anexos-salvos`, 455 mensagens) despeja tudo em
-- "06. Notas Fiscais 2026 / 0. Gmail / AAAA-MM /" — a pasta IRMÃ das duas que o
-- Hub já lê há meses. Não faltava integração com o Gmail; faltava uma entrada
-- no array de pastas.
--
-- E o nome do arquivo é dado estruturado:
--
--   2026-08-10_32260827250919000190550000001309411003058314-nfe.pdf
--   └ data do e-mail   └ chave de acesso da NF-e
--
-- Os dígitos 7 a 20 da chave são o CNPJ do emitente e o 3 a 6 são o mês da
-- emissão. Conferido contra o e-mail que trouxe o arquivo: essa chave é a NF
-- 130941 da FRACALOSSI, CNPJ 27.250.919/0001-90 — exatamente o que o corpo do
-- e-mail diz. Ou seja: identidade, de graça, sem baixar o PDF e sem OCR. É a
-- chave `exata` da `notas_externas_casar`.
--
-- TRÊS COISAS QUE ESTA MIGRATION EXISTE PARA PERMITIR:
--   1. `pasta = 'gmail'` cabia na tabela? Não: o check aceitava só duas.
--   2. o XML da nota (melhor fonte que existe) era descartado como "tipo não
--      tratado" enquanto o PDF ao lado ia para o OCR;
--   3. boleto não é nota — e metade do que chega por e-mail é boleto.

/* ============================================================================
 *  1. A terceira pasta, e o que ela traz
 * ========================================================================== */

alter table public.comprovantes_drive drop constraint if exists comprovantes_drive_pasta_ck;
alter table public.comprovantes_drive
  add constraint comprovantes_drive_pasta_ck
  check (pasta in ('mercado_livre', 'whatsapp', 'gmail'));

-- `xml` é leitura de campo, exata; `nome_chave` é a nota que só o NOME
-- entregou — sem valor, mas com CNPJ e mês, que já casa por identidade.
alter table public.comprovantes_drive drop constraint if exists comprovantes_drive_lido_ck;
alter table public.comprovantes_drive
  add constraint comprovantes_drive_lido_ck
  check (lido_como is null or lido_como in ('danfe', 'ocr', 'nome_arquivo', 'xml', 'nome_chave'));

alter table public.comprovantes_drive
  add column if not exists chave_fiscal   text,
  add column if not exists tipo_documento text;

comment on column public.comprovantes_drive.chave_fiscal is
  'Os 44 dígitos da NF-e, com DV conferido. Carrega o CNPJ do emitente — é a chave forte do casamento.';
comment on column public.comprovantes_drive.tipo_documento is
  'nota | boleto | recibo | extrato | outro, pelo nome do arquivo. Boleto não tira o lançamento do SEM NF.';

/* ============================================================================
 *  2. As mesmas duas colunas do lado de quem casa
 * ========================================================================== */

alter table public.notas_externas
  add column if not exists chave_fiscal   text,
  add column if not exists tipo_documento text;

/* Derivada, e não escrita: quem chega pelas planilhas não tem `tipo_documento`
   — o formulário pede a NF e é isso que a pessoa anexa — então a ausência vale
   como nota. Coluna gerada não sai do lugar quando alguém esquece de atualizar
   os dois lados. */
alter table public.notas_externas
  add column if not exists parece_nota boolean
  generated always as (coalesce(tipo_documento, 'nota') = 'nota') stored;

comment on column public.notas_externas.parece_nota is
  'Falso quando o arquivo é boleto, extrato ou recibo. Marcar um lançamento como COM NF por causa de um boleto é dar por resolvido o que segue sem documento fiscal.';

create index if not exists notas_externas_chave_idx
  on public.notas_externas (chave_fiscal) where chave_fiscal is not null;

/* ============================================================================
 *  3. Do Drive para as notas — agora com as três pastas
 * ========================================================================== */

create or replace function public.notas_externas_do_drive()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  insert into public.notas_externas (
    chave, fonte, linha, ordem, enviado_em, nome, cnpj, valor,
    o_que_e, detalhe, drive_id, link, diz_anexado,
    chave_fiscal, tipo_documento, visto_em, atualizado_em
  )
  select 'drive|' || cd.drive_id,
         'drive_' || cd.pasta,
         null, 1,
         cd.data, cd.emitente, cd.cnpj_norm, cd.valor,
         cd.descricao,
         -- O nome do arquivo costuma ser a melhor descrição que existe:
         -- "Kelven Silva - Reparo de Notebooks - 04-08" foi escrito por quem
         -- estava lá, e nenhum OCR chega perto.
         cd.nome_arquivo,
         cd.drive_id,
         'https://drive.google.com/file/d/' || cd.drive_id || '/view',
         false,
         cd.chave_fiscal, cd.tipo_documento, now(), now()
    from public.comprovantes_drive cd
   where cd.lido_como is not null
     and cd.erro is null
     /* Só entra o que TEM COMO CASAR, senão a lista de "sem_alvo" enche de
        coisa que ninguém consegue resolver:
          • a data é obrigatória — as regras 2, 3 e 4 são todas por janela, e
            `notas_externas_casar` já descarta nota sem ela;
          • e valor OU CNPJ, porque com CNPJ a regra 2 (documento + janela)
            alcança mesmo sem valor, e com valor a regra 3 alcança sem CNPJ. */
     and cd.data is not null
     and (cd.valor is not null or cd.cnpj_norm is not null)
     /* NOTA QUE NÓS EMITIMOS NÃO EXPLICA PAGAMENTO NENHUM. Chega bastante pela
        caixa — o Focus NFe devolve por e-mail cada NFS-e que a Takeat emite, e
        ela é RECEITA. Casá-la com um PIX de saída marcaria como resolvido um
        gasto que segue sem documento. */
     and coalesce(cd.cnpj_norm, '') <> '37511891000150'
  on conflict (chave) do update
    set enviado_em     = excluded.enviado_em,
        nome           = excluded.nome,
        cnpj           = excluded.cnpj,
        valor          = excluded.valor,
        o_que_e        = excluded.o_que_e,
        detalhe        = excluded.detalhe,
        chave_fiscal   = excluded.chave_fiscal,
        tipo_documento = excluded.tipo_documento,
        visto_em       = now(),
        atualizado_em  = now();

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.notas_externas_do_drive() is
  'Traz para `notas_externas` o que a comprovantes-drive-sync já leu das TRÊS pastas (Mercado Livre, WhatsApp e Gmail). Idempotente: a chave é o id do arquivo no Drive.';

/* ============================================================================
 *  4. A tela precisa saber se é nota ou boleto
 * ========================================================================== */

-- Mudaram as colunas de saída, e o Postgres exige DROP antes de um
-- `create or replace` que mexe nelas.
drop function if exists public.notas_externas_por_alvo(text, text);

create function public.notas_externas_por_alvo(
  p_alvo_tipo text default 'pix',
  p_referencia text default null
)
returns table(
  alvo_id_unico text, nota_id bigint, fonte text, link text, drive_id text,
  nome text, o_que_e text, detalhe text, valor numeric, enviado_em date,
  competencia text, casamento text, confianca text, conferencia text,
  diz_anexado boolean, status_planilha text, erp_anexos integer,
  fila_erp boolean, enviado_erp_em timestamptz, erro_erp text,
  tipo_documento text, parece_nota boolean, chave_fiscal text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nt.alvo_id_unico, nt.id, nt.fonte, nt.link, nt.drive_id,
         nt.nome, nt.o_que_e, nt.detalhe, nt.valor, nt.enviado_em,
         nt.competencia, nt.casamento, nt.confianca, nt.conferencia,
         nt.diz_anexado, nt.status_planilha, nt.erp_anexos,
         nt.fila_erp, nt.enviado_erp_em, nt.erro_erp,
         nt.tipo_documento, nt.parece_nota, nt.chave_fiscal
    from public.notas_externas nt
    left join public.auditoria_pix_lancamentos p
           on p_alvo_tipo = 'pix' and p.id_unico = nt.alvo_id_unico
    left join public.auditoria_cartao_lancamentos c
           on p_alvo_tipo = 'cartao' and c.id_unico = nt.alvo_id_unico
   where nt.alvo_tipo = p_alvo_tipo
     and nt.ignorado_em is null
     and (p_referencia is null
          or coalesce(p.referencia, c.referencia) = p_referencia)
   -- A nota antes do boleto: é ela que a auditoria está cobrando.
   order by nt.alvo_id_unico, nt.parece_nota desc, nt.confianca, nt.id;
$$;

revoke all on function public.notas_externas_por_alvo(text, text) from public;
revoke all on function public.notas_externas_por_alvo(text, text) from anon;
grant execute on function public.notas_externas_por_alvo(text, text) to authenticated, service_role;
