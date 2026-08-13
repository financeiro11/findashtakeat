/* ============================================================================
 * Justificativa de UM lançamento.
 *
 * A DRE já tinha duas caixas de texto, e nenhuma responde esta pergunta:
 *   • `demonstracoes_justificativas` explica a CÉLULA ("Viagens subiu 6%").
 *   • `demonstracoes_perguntas` responde uma dúvida sobre a célula.
 * O que faltava é o pontual: dentro dos 264 lançamentos de "Viagens &
 * Transportes Mkt · Jul 26", a linha da Rita de R$ 592,67 tem uma história que
 * não está em lugar nenhum do Omie — foi um reembolso de uma viagem específica,
 * e quem sabe disso é a pessoa, não o ERP.
 *
 * A CHAVE É O `cod_titulo`, não a célula. O lançamento é um só: o mesmo título
 * aparece na DRE (competência) e na DFC (caixa), e a explicação vale nos dois —
 * mesma lição da decisão de reclassificação (migration 20260811173000). Também
 * é o que faz a nota sobreviver a uma troca de categoria: o título muda de
 * rubrica, a justificativa vai junto.
 *
 * Uma nota por lançamento: reeditar ATUALIZA, não empilha. Isto é o comentário
 * na margem do extrato, não um fio de conversa — para conversa existe o "?".
 * ========================================================================== */

create table if not exists public.demonstracoes_lancamento_nota (
  id            uuid primary key default gen_random_uuid(),

  -- O título no Omie. `text` porque é assim que o drill-down o carrega
  -- (`demonstracoes_lancamentos` devolve texto), e misturar text com bigint já
  -- custou caro na camada de agentes.
  cod_titulo    text not null unique,

  texto         text not null check (btrim(texto) <> ''),

  -- ONDE a nota foi escrita. Não é chave e não filtra nada: é rastro, para
  -- quem abrir a linha meses depois saber de que tela a frase falava (a rubrica
  -- pode ter mudado desde então).
  origem_tipo      text check (origem_tipo is null or origem_tipo in ('dre','dfc')),
  origem_rubrica   text,
  origem_mes       text,                    -- 'Jul-26'
  contraparte      text,                    -- como estava na tela na hora

  autor         uuid,
  autor_nome    text,                       -- congelado: o perfil pode sumir
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.demonstracoes_lancamento_nota is
  'Justificativa escrita à mão para UM lançamento do Omie. Chave é cod_titulo: vale na DRE e na DFC, e acompanha o título se ele trocar de rubrica.';

alter table public.demonstracoes_lancamento_nota enable row level security;

-- Leitura: qualquer pessoa logada. A nota existe para ser lida por quem abrir a
-- célula depois — guardá-la por autor a tornaria um bilhete para si mesmo.
drop policy if exists "auth le lancamento_nota" on public.demonstracoes_lancamento_nota;
create policy "auth le lancamento_nota"
  on public.demonstracoes_lancamento_nota for select to authenticated using (true);

revoke all on public.demonstracoes_lancamento_nota from anon;
grant select on public.demonstracoes_lancamento_nota to authenticated;
grant select, insert, update, delete on public.demonstracoes_lancamento_nota to service_role;

-- Escrita só pela função abaixo: o texto entra num relatório que vai para a
-- diretoria, então precisa de autor registrado — e autor que o cliente não
-- escolhe.


/* ============================================================
 *  Salvar / apagar
 * ============================================================
 * Texto em branco APAGA. É o mesmo gesto de quem escreveu por engano: limpar a
 * caixa e salvar, sem caçar um botão diferente.
 *
 * Devolve a linha (ou nulo, quando apagou) para a tela atualizar sem reler a
 * lista inteira — a lista aqui tem centenas de linhas.
 */
create or replace function public.lancamento_nota_salvar(
  p_cod_titulo  text,
  p_texto       text,
  p_tipo        text default null,
  p_rubrica     text default null,
  p_mes         text default null,
  p_contraparte text default null
)
returns public.demonstracoes_lancamento_nota
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_nome  text;
  v_linha public.demonstracoes_lancamento_nota;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if btrim(coalesce(p_cod_titulo, '')) = '' then
    raise exception 'Sem código de título: este lançamento não tem onde pendurar a nota.';
  end if;

  if v_texto = '' then
    delete from public.demonstracoes_lancamento_nota where cod_titulo = p_cod_titulo;
    return null;
  end if;

  select nome into v_nome from public.profiles where user_id = auth.uid();

  insert into public.demonstracoes_lancamento_nota
    (cod_titulo, texto, origem_tipo, origem_rubrica, origem_mes, contraparte, autor, autor_nome)
  values
    (p_cod_titulo, v_texto, p_tipo, p_rubrica, p_mes, p_contraparte, auth.uid(), v_nome)
  on conflict (cod_titulo) do update
    set texto          = excluded.texto,
        -- A origem só é reescrita quando vem preenchida: editar a nota de outra
        -- tela não deve apagar de onde ela nasceu.
        origem_tipo    = coalesce(excluded.origem_tipo,    public.demonstracoes_lancamento_nota.origem_tipo),
        origem_rubrica = coalesce(excluded.origem_rubrica, public.demonstracoes_lancamento_nota.origem_rubrica),
        origem_mes     = coalesce(excluded.origem_mes,     public.demonstracoes_lancamento_nota.origem_mes),
        contraparte    = coalesce(excluded.contraparte,    public.demonstracoes_lancamento_nota.contraparte),
        autor          = excluded.autor,
        autor_nome     = excluded.autor_nome,
        atualizado_em  = now()
  returning * into v_linha;

  return v_linha;
end;
$$;

-- Toda função nova em `public` nasce chamável pela anon key, que está no bundle
-- do front (ver 20260804160100). Esta escreve — fecha.
revoke execute on function public.lancamento_nota_salvar(text, text, text, text, text, text) from anon;