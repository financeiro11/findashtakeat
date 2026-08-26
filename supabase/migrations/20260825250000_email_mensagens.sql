-- A caixa de e-mail vira fonte da auditoria — e deixa rastro do que descartou.
--
-- O MOTIVO DE LER O GMAIL DIRETO, tendo a pasta do Drive: a automação que
-- copiava os anexos para lá PAROU em 10/08/2026 e ninguém percebeu. Entre 17 e
-- 25/08 chegaram quatro notas de fornecedor (FRACALOSSI, Exclusive com XML,
-- Acabamento, Ingram Micro) que não estão em pasta nenhuma. Uma esteira que
-- depende de caixa-preta de terceiro herda os silêncios dela.
--
-- E o e-mail tem três coisas que arquivo nenhum tem:
--   • o CORPO, onde metade dos fornecedores escreve CNPJ e valor em texto puro;
--   • o e-mail que traz SÓ LINK (o Bling manda "Visualizar DANFE" e nada mais);
--   • o histórico anterior a maio/2026, que o depósito nunca cobriu.
--
-- `email_mensagens` é o gêmeo de `comprovantes_drive`: o cache do que se leu da
-- origem, com o carimbo que evita reler, e — o que importa mais — o REGISTRO DO
-- DESCARTE. Mensagem que não pareceu fiscal fica aqui com `fiscal = false`. Sem
-- isso, o fornecedor cujo formato ninguém previu some sem deixar pergunta.

/* ============================================================================
 *  1. O que se leu da caixa
 * ========================================================================== */

create table if not exists public.email_mensagens (
  gmail_id        text primary key,
  thread_id       text,
  data            date,
  remetente       text,
  remetente_email text,
  assunto         text,
  -- [{ nome, mime, tamanho }] — o nome já denuncia boleto x nota fiscal
  anexos          jsonb not null default '[]'::jsonb,

  -- o que o CORPO entregou, guardado cru para poder conferir depois
  corpo_chave     text,
  corpo_cnpj      text,
  corpo_valor     numeric,
  corpo_data      date,

  -- passou pelas provas de `ehFiscal`? nulo = a leitura falhou antes de decidir
  fiscal          boolean,
  lido_em         timestamptz not null default now(),
  erro            text
);

comment on table public.email_mensagens is
  'Cache do que o Hub leu da caixa financeiro@ — inclusive o que descartou. Sem o descarte registrado, o fornecedor de formato novo some sem deixar pergunta.';
comment on column public.email_mensagens.fiscal is
  'Passou nas provas de documento fiscal (chave de acesso, CNPJ de terceiro + valor, ou nome de anexo). Falso fica registrado de propósito.';

create index if not exists email_mensagens_data_idx  on public.email_mensagens (data desc);
create index if not exists email_mensagens_fiscal_idx on public.email_mensagens (fiscal) where fiscal;
create index if not exists email_mensagens_remetente_idx on public.email_mensagens (remetente_email);

alter table public.email_mensagens enable row level security;

drop policy if exists email_mensagens_leitura on public.email_mensagens;
create policy email_mensagens_leitura
  on public.email_mensagens for select to authenticated using (true);

grant select on public.email_mensagens to authenticated;
grant all    on public.email_mensagens to service_role;
revoke all   on public.email_mensagens from anon;

/* ============================================================================
 *  2. A nota que não tem arquivo
 * ========================================================================== */

-- `drive_id` deixa de ser obrigatório: nasceu quando toda nota vinha do Drive, e
-- a do e-mail não tem id de Drive nenhum. O que identifica continua sendo
-- `chave` (`email|<gmail_id>|<anexo>`).
alter table public.notas_externas alter column drive_id drop not null;

/* O e-mail do Bling diz que a DANFE existe e manda só um link — sem arquivo.
   Isso AINDA vale: casa com o lançamento pelo CNPJ e pelo valor, e diz onde a
   nota está. Só não pode entrar na fila do ERP, que precisa de um arquivo para
   subir. Daí a coluna: a nota existe, o arquivo não. */
alter table public.notas_externas
  add column if not exists tem_arquivo boolean not null default true;

comment on column public.notas_externas.tem_arquivo is
  'Falso quando a origem só apontou a nota (e-mail com link, sem anexo). Casa e informa, mas não sobe ao ERP.';

comment on column public.notas_externas.fonte is
  'compras | reembolsos | nfs_colaboradores | eventos | parceiros | drive_mercado_livre | drive_whatsapp | drive_gmail | email. Não é enum de propósito: fonte nova entra sem migration.';

/* ============================================================================
 *  3. A fila do ERP não aceita nota sem arquivo
 * ========================================================================== */

create or replace function public.notas_externas_enfileirar(
  p_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.notas_externas
     set fila_erp = true, erro_erp = null, atualizado_em = now()
   where id = any(p_ids)
     and enviado_erp_em is null
     and ignorado_em is null
     and alvo_tipo is not null
     -- Não se manda ao ERP o que o ERP já tem: um anexo por título já basta, e
     -- o duplicado é justamente o que a conferência existe para evitar.
     and conferencia in ('falta_anexar', 'promessa_falsa')
     -- E não se manda o que não é arquivo. A nota "por link" do Bling entraria
     -- na fila e a varredura tentaria baixar uma página do Gmail, que voltaria
     -- como HTML — o erro mais confuso possível para quem estivesse olhando.
     and tem_arquivo;
  get diagnostics v_n = row_count;

  /* No CARTÃO a nota também vale localmente, e é o que tira a linha do "SEM NF"
     — mesmíssimo alcance do gatilho `comprovante_marca_com_nf` do Drive, e pelo
     mesmo motivo: lá a coluna guarda o link de onde a nota estiver, e não uma
     afirmação sobre o ERP.

     No PIX não se escreve nada: `tem_comprovante` quer dizer "o Omie tem o
     arquivo", e quem responde isso é o ERP depois do envio. */
  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || coalesce(' · linha ' || nt.linha, '')),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and nt.tem_arquivo
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return v_n;
end;
$$;

revoke all on function public.notas_externas_enfileirar(bigint[]) from public;
revoke all on function public.notas_externas_enfileirar(bigint[]) from anon;
grant execute on function public.notas_externas_enfileirar(bigint[]) to authenticated, service_role;

/* ============================================================================
 *  4. A tela precisa saber quando não há arquivo
 * ========================================================================== */

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
  tipo_documento text, parece_nota boolean, chave_fiscal text, tem_arquivo boolean
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
         nt.tipo_documento, nt.parece_nota, nt.chave_fiscal, nt.tem_arquivo
    from public.notas_externas nt
    left join public.auditoria_pix_lancamentos p
           on p_alvo_tipo = 'pix' and p.id_unico = nt.alvo_id_unico
    left join public.auditoria_cartao_lancamentos c
           on p_alvo_tipo = 'cartao' and c.id_unico = nt.alvo_id_unico
   where nt.alvo_tipo = p_alvo_tipo
     and nt.ignorado_em is null
     and (p_referencia is null
          or coalesce(p.referencia, c.referencia) = p_referencia)
   -- Nota com arquivo primeiro, depois nota sem arquivo, e o boleto por último:
   -- é a ordem do que resolve a pendência.
   order by nt.alvo_id_unico, nt.parece_nota desc, nt.tem_arquivo desc, nt.confianca, nt.id;
$$;

revoke all on function public.notas_externas_por_alvo(text, text) from public;
revoke all on function public.notas_externas_por_alvo(text, text) from anon;
grant execute on function public.notas_externas_por_alvo(text, text) to authenticated, service_role;
