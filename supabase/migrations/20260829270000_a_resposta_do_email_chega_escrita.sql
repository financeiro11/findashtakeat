-- A resposta do e-mail chega escrita.
--
-- O Hub já lê a caixa de entrada (`email_mensagens`, alimentada por
-- `gmail-nf-sync`): fornecedor mandando nota, cobrança, lembrete de vencimento.
-- Hoje, responder qualquer uma delas é trabalho manual inteiro — abrir o Gmail,
-- lembrar o contexto, escrever.
--
-- A IA passa a redigir a resposta. Quem envia continua sendo GENTE, num clique.
--
-- ---------------------------------------------------------------------------
-- POR QUE O ENVIO NUNCA É AUTOMÁTICO, mesmo com a autonomia que o resto desta
-- leva ganhou. Errar o desempate de uma nota custa uma linha errada num acervo
-- interno, que `notas_externas_desfazer_ia()` desfaz. Errar um e-mail custa uma
-- mensagem que saiu com o nome da empresa para uma pessoa de fora — e não existe
-- desfazer para isso. As duas coisas não têm a mesma régua porque não têm a
-- mesma consequência.
--
-- Então: `sugestao` nasce da IA e `enviado_em` só é escrito por
-- `email_resposta_marcar_enviada`, que a tela chama depois de alguém clicar.
-- O clique É o controle.
--
-- E O ESCOPO PRECISA SER RECONSENTIDO. `gmail.send` entrou na lista de escopos
-- em 29/08/2026, mas o refresh token guardado vale só para os escopos que já
-- havia quando foi emitido. Enquanto ninguém reabrir o consentimento, a sugestão
-- é escrita e mostrada normalmente, e só o botão de enviar responde que falta
-- reconectar. Metade útil funcionando é melhor que tudo esperando.

create table if not exists public.email_resposta (
  gmail_id     text primary key,
  thread_id    text,
  remetente    text,
  assunto      text,
  /* O que a IA escreveu. Texto puro: e-mail de resposta em HTML é o caminho
     mais curto para uma mensagem quebrada no cliente de quem recebe. */
  sugestao     text not null,
  /* Por que ela respondeu assim — a mesma exigência do desempate: opinião de
     IA sem justificativa é palpite que ninguém consegue conferir. */
  porque       text,
  /* `responder` | `nao_precisa` — nem todo e-mail pede resposta, e dizer isso é
     mais útil que inventar uma cordialidade. */
  veredito     text not null default 'responder',
  modelo       text,
  criada_em    timestamptz not null default now(),
  enviado_em   timestamptz,
  enviado_por  uuid,
  erro         text
);

comment on table public.email_resposta is
  'Resposta que a IA sugere para um e-mail da caixa. `enviado_em` só é preenchido depois de uma PESSOA clicar — o envio nunca é automático, porque e-mail que sai não se desfaz.';

alter table public.email_resposta enable row level security;

drop policy if exists email_resposta_leitura on public.email_resposta;
create policy email_resposta_leitura on public.email_resposta
  for select to authenticated using (true);

/** A fila: e-mails recentes que ainda não têm resposta sugerida. */
create or replace function public.email_resposta_fila(p_limite int default 10)
returns table (gmail_id text, thread_id text, remetente text, assunto text, data timestamptz)
language sql
stable
set search_path to 'public'
as $$
  select m.gmail_id, m.thread_id, m.remetente, m.assunto, m.data
    from public.email_mensagens m
   where m.data > now() - interval '7 days'
     and not exists (select 1 from public.email_resposta r where r.gmail_id = m.gmail_id)
   order by m.data desc
   limit greatest(1, least(coalesce(p_limite, 10), 30));
$$;

revoke all on function public.email_resposta_fila(int) from public;
revoke all on function public.email_resposta_fila(int) from anon;
grant execute on function public.email_resposta_fila(int) to authenticated, service_role;

/** O que a tela mostra: sugestões ainda não enviadas, mais recentes primeiro. */
create or replace function public.email_respostas_pendentes(p_limite int default 20)
returns table (
  gmail_id text, thread_id text, remetente text, assunto text,
  sugestao text, porque text, veredito text, criada_em timestamptz
)
language sql
stable
set search_path to 'public'
as $$
  select r.gmail_id, r.thread_id, r.remetente, r.assunto,
         r.sugestao, r.porque, r.veredito, r.criada_em
    from public.email_resposta r
   where r.enviado_em is null
     and r.veredito = 'responder'
   order by r.criada_em desc
   limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;

revoke all on function public.email_respostas_pendentes(int) from public;
revoke all on function public.email_respostas_pendentes(int) from anon;
grant execute on function public.email_respostas_pendentes(int) to authenticated, service_role;

/** Carimba o envio. Só quem está logado chama — o `auth.uid()` fica no registro
    para que "quem mandou este e-mail?" tenha resposta. */
create or replace function public.email_resposta_marcar_enviada(p_gmail_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'só gente logada marca e-mail como enviado';
  end if;
  update public.email_resposta
     set enviado_em = now(), enviado_por = auth.uid(), erro = null
   where gmail_id = p_gmail_id and enviado_em is null;
end;
$$;

revoke all on function public.email_resposta_marcar_enviada(text) from public;
revoke all on function public.email_resposta_marcar_enviada(text) from anon;
grant execute on function public.email_resposta_marcar_enviada(text) to authenticated, service_role;

insert into public.ia_orcamento (consumidor, rotulo, para_que, teto_dia, teto_mes_usd) values
  ('email_resposta', 'Resposta de e-mail',
   'Lê o e-mail recebido e redige uma resposta para alguém revisar e enviar.', 60, 5.00)
on conflict (consumidor) do nothing;
