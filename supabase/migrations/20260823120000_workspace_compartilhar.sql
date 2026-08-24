-- Anotações · compartilhar uma nota por link.
--
-- Duas formas, porque são dois destinatários diferentes:
--
--   1) LINK DO TIME — `/notas/<id>`. Não precisa de nada aqui: `workspace_pages` já é
--      `to authenticated using (true)`, ou seja, quem tem login no Hub já lê e edita
--      qualquer nota. O que faltava era a URL, e isso é rota no front.
--
--   2) LINK PÚBLICO — `/n/<token>`. Para quem NÃO tem conta. Mesmo desenho do link do
--      líder da auditoria (`/l/<token>`, `magic_tokens`): a pessoa anônima nunca toca a
--      tabela, só duas funções SECURITY DEFINER que decidem o que devolver. Aqui ela
--      LÊ e COMENTA — não edita o conteúdo. Editar por link anônimo significaria dar a
--      quem repassasse o endereço o poder de apagar a nota do time.
--
-- O link público cobre UMA nota — a que foi apontada. Subpágina de uma nota
-- compartilhada não vaza junto: quem quiser compartilhar a subpágina gera o link dela.

-- ---------------------------------------------------------------------------
-- 1) O link público
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_links (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique,
  page_id            uuid not null references public.workspace_pages(id) on delete cascade,
  permite_comentario boolean not null default true,
  criado_por         uuid references auth.users(id) on delete set null,
  criado_por_nome    text,
  criado_em          timestamptz not null default now(),
  -- Revogar não apaga a linha: o histórico de quem abriu e quantas vezes continua
  -- valendo depois de fechar a porta.
  revogado_em        timestamptz,
  -- NULL = sem prazo, o padrão (mesma decisão do link do líder em 08/2026).
  expira_em          timestamptz,
  acessos            integer not null default 0,
  ultimo_acesso      timestamptz
);

comment on table public.workspace_links is
  'Link público de uma anotação (/n/<token>). Leitura + comentário, nunca edição.';

create index if not exists workspace_links_page_idx on public.workspace_links(page_id);

-- Um link ativo por nota. Sem isto, cada clique em "Criar link" geraria um endereço
-- novo e revogar um deixaria os outros vivos — ninguém consegue fechar a porta assim.
create unique index if not exists workspace_links_ativo_idx
  on public.workspace_links(page_id) where revogado_em is null;

-- ---------------------------------------------------------------------------
-- 2) Comentários — a via de volta de quem só tem o link
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_comentarios (
  id            uuid primary key default gen_random_uuid(),
  page_id       uuid not null references public.workspace_pages(id) on delete cascade,
  -- Por qual link entrou. NULL = escrito de dentro do Hub.
  link_id       uuid references public.workspace_links(id) on delete set null,
  autor_nome    text not null,
  autor_user_id uuid references auth.users(id) on delete set null,
  texto         text not null,
  origem        text not null default 'hub',
  resolvido     boolean not null default false,
  criado_em     timestamptz not null default now(),
  constraint workspace_comentarios_origem_ck check (origem in ('hub', 'link')),
  constraint workspace_comentarios_texto_ck  check (char_length(texto) between 1 and 4000)
);

comment on table public.workspace_comentarios is
  'Comentários de uma anotação. origem=link são de quem abriu por /n/<token>, sem conta no Hub.';

create index if not exists workspace_comentarios_page_idx
  on public.workspace_comentarios(page_id, criado_em);

-- ---------------------------------------------------------------------------
-- 3) RLS — anônimo não enxerga tabela nenhuma; só as duas funções abaixo
-- ---------------------------------------------------------------------------
alter table public.workspace_links       enable row level security;
alter table public.workspace_comentarios enable row level security;

drop policy if exists "auth all workspace_links" on public.workspace_links;
create policy "auth all workspace_links"
  on public.workspace_links for all
  to authenticated using (true) with check (true);

drop policy if exists "auth all workspace_comentarios" on public.workspace_comentarios;
create policy "auth all workspace_comentarios"
  on public.workspace_comentarios for all
  to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) A porta do anônimo: abrir a nota
-- ---------------------------------------------------------------------------
create or replace function public.resolver_nota_publica(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link   public.workspace_links%rowtype;
  v_pg     public.workspace_pages%rowtype;
  v_coment jsonb;
begin
  select * into v_link from public.workspace_links where token = p_token;
  if not found then
    return jsonb_build_object('erro', 'Link inválido');
  end if;

  if v_link.revogado_em is not null then
    return jsonb_build_object('erro', 'Este link foi revogado por quem compartilhou.');
  end if;

  if v_link.expira_em is not null and v_link.expira_em < now() then
    return jsonb_build_object('erro', 'Este link expirou. Peça um novo a quem compartilhou.');
  end if;

  select * into v_pg from public.workspace_pages where id = v_link.page_id;
  if not found then
    return jsonb_build_object('erro', 'Esta anotação não existe mais.');
  end if;

  update public.workspace_links
     set acessos = acessos + 1, ultimo_acesso = now()
   where id = v_link.id;

  -- Comentários resolvidos continuam na lista: quem comentou precisa ver que a sua
  -- observação foi lida, e não a própria frase sumir da página.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         c.id,
           'autor_nome', c.autor_nome,
           'texto',      c.texto,
           'origem',     c.origem,
           'resolvido',  c.resolvido,
           'criado_em',  c.criado_em
         ) order by c.criado_em), '[]'::jsonb)
    into v_coment
    from public.workspace_comentarios c
   where c.page_id = v_pg.id;

  return jsonb_build_object(
    'titulo',             v_pg.title,
    'icone',              v_pg.icon,
    'capa',               v_pg.cover_url,
    'conteudo',           v_pg.content,
    'atualizado_em',      v_pg.updated_at,
    'ultimo_editor',      v_pg.last_edited_by,
    'compartilhado_por',  v_link.criado_por_nome,
    'permite_comentario', v_link.permite_comentario,
    'comentarios',        v_coment
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) A porta do anônimo: comentar
-- ---------------------------------------------------------------------------
create or replace function public.comentar_nota_publica(
  p_token text,
  p_autor text,
  p_texto text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link  public.workspace_links%rowtype;
  v_autor text;
  v_texto text;
  v_qtd   integer;
  v_novo  public.workspace_comentarios%rowtype;
begin
  select * into v_link from public.workspace_links where token = p_token;
  if not found or v_link.revogado_em is not null
     or (v_link.expira_em is not null and v_link.expira_em < now()) then
    return jsonb_build_object('erro', 'Link inválido, revogado ou expirado.');
  end if;

  if not v_link.permite_comentario then
    return jsonb_build_object('erro', 'Este link é só de leitura.');
  end if;

  v_texto := btrim(coalesce(p_texto, ''));
  if v_texto = '' then
    return jsonb_build_object('erro', 'Escreva alguma coisa antes de enviar.');
  end if;
  if char_length(v_texto) > 4000 then
    return jsonb_build_object('erro', 'Comentário longo demais (limite de 4000 caracteres).');
  end if;

  v_autor := coalesce(nullif(btrim(coalesce(p_autor, '')), ''), 'Visitante');
  if char_length(v_autor) > 80 then
    v_autor := left(v_autor, 80);
  end if;

  -- Teto por link e por dia. O endereço é público: sem isto, um robô que o encontrasse
  -- encheria a nota do time de lixo, e não há login para bloquear depois.
  select count(*) into v_qtd
    from public.workspace_comentarios
   where link_id = v_link.id and criado_em > now() - interval '24 hours';
  if v_qtd >= 40 then
    return jsonb_build_object('erro', 'Muitos comentários por este link hoje. Tente amanhã.');
  end if;

  insert into public.workspace_comentarios (page_id, link_id, autor_nome, texto, origem)
  values (v_link.page_id, v_link.id, v_autor, v_texto, 'link')
  returning * into v_novo;

  return jsonb_build_object('ok', true, 'comentario', jsonb_build_object(
    'id',         v_novo.id,
    'autor_nome', v_novo.autor_nome,
    'texto',      v_novo.texto,
    'origem',     v_novo.origem,
    'resolvido',  v_novo.resolvido,
    'criado_em',  v_novo.criado_em
  ));
end;
$function$;

-- Estas DUAS são para quem não tem conta — o `anon` precisa chamá-las, ao contrário do
-- que vale para o resto das funções do Hub (ver as migrations de revoke_anon).
grant execute on function public.resolver_nota_publica(text)         to anon, authenticated;
grant execute on function public.comentar_nota_publica(text, text, text) to anon, authenticated;
