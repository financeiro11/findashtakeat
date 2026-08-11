/* ============================================================================
 * Revisão do Mês — a leitura escrita da reunião de tracker com o CEO.
 *
 * A tela `/demonstracoes/revisao` calcula tudo o que é conta (cascata, desvio
 * contra o BP, Pareto do EBITDA, DFC, metas do mês seguinte) na hora, a partir
 * dos mesmos blobs que a DRE e a DFC já leem. O que NÃO dá para calcular é a
 * leitura: "isto é recorrente e entra integral em agosto", "congelar as duas
 * vagas até a margem voltar". Isso é redação, e é o que esta tabela guarda.
 *
 * A DIVISÃO DE TRABALHO é a mesma do cartão e das justificativas da DRE:
 *   • O SINAL é determinístico e vem do cliente já formatado (lib/revisaoMes).
 *     Quem escolhe as quatro rubricas que explicam 88% do desvio é o Pareto, não
 *     a IA — se o critério variasse de mês para mês, "nada apareceu" não
 *     significaria nada.
 *   • A IA só REDIGE: veredicto, impacto e ação por rubrica, e a lista do que a
 *     reunião decide. Ela não faz conta nenhuma — os números chegam prontos.
 *
 * UMA LINHA POR MÊS. A pauta é sobre o mês fechado, e regerar ATUALIZA em vez de
 * empilhar. O texto de Jul/26 continua o de Jul/26 depois de qualquer sync.
 * ========================================================================== */

create table if not exists public.demonstracoes_revisao (
  id            uuid primary key default gen_random_uuid(),
  -- Chave de coluna do blob ("Jul-26"), a mesma de `demonstracoes_mes_trancado`
  -- e de `demonstracoes_justificativas`. Uma pauta por mês.
  mes           text not null unique,
  -- Granularidade do Pareto contra o qual o texto foi escrito ('bloco' ou
  -- 'rubrica'): trocar o detalhe muda quais rubricas ganharam parágrafo, e sem
  -- guardar isto a tela exibiria texto de "Pessoal" ao lado de "Equipe
  -- Tecnologia" sem que ninguém percebesse a troca.
  detalhe       text not null default 'bloco' check (detalhe in ('bloco','rubrica')),

  /* ---- o que a IA escreveu ---- */
  veredicto_nivel  text check (veredicto_nivel in ('critico','atencao','ok')),
  veredicto_titulo text,
  veredicto_resumo text,
  -- [{nivel, area, titulo, texto}] — os três cards do bloco 1.
  destaques     jsonb not null default '[]'::jsonb,
  -- [{rubrica, impacto, acao}] — as duas colunas que o Pareto não calcula.
  rubricas      jsonb not null default '[]'::jsonb,
  -- ["Teto de Marketing volta a R$ 168 k?", …] — a pauta do bloco 5.
  decisoes      jsonb not null default '[]'::jsonb,
  fecho         text,

  /* ---- a prova ----
     O sinal CONGELADO na geração: os números formatados contra os quais o texto
     foi escrito. Guardado (e não recalculado na leitura) porque é ele que
     permite à tela dizer "o EBITDA mudou depois deste texto" em vez de exibir
     uma pauta velha com cara de atual — a mesma marca de envelhecimento que a
     justificativa tem na célula da DRE. */
  sinal         jsonb not null default '{}'::jsonb,

  /* ---- a reescrita de gente ----
     PATCH PARCIAL, não uma segunda cópia do documento: quem corrige uma frase do
     veredicto não deve congelar as outras nove, e regerar o texto de Marketing
     não pode apagar a ação que alguém escreveu para Pessoal. O merge campo a
     campo mora em `lib/revisaoMes.ts` (`aplicarEdicao`), com teste.
     SOBREVIVE À REGERAÇÃO: o upsert da edge function não toca nesta coluna. */
  editado       jsonb,
  status        text not null default 'novo' check (status in ('novo','aceito')),
  editado_por   uuid,
  editado_em    timestamptz,

  modelo        text,
  gerado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.demonstracoes_revisao enable row level security;

drop policy if exists "demonstracoes_revisao_select_auth" on public.demonstracoes_revisao;
create policy "demonstracoes_revisao_select_auth"
  on public.demonstracoes_revisao for select to authenticated using (true);
-- Escrita: geração pela service role (edge function) e reescrita pela função
-- abaixo. Nada de update solto do cliente — a pauta vai para uma reunião com o
-- CEO, então quem mexeu no texto precisa ficar registrado.


/* ============================================================
 *  A reescrita e o "conferi"
 * ============================================================
 * `p_editado`:
 *   • null            → não mexe no texto (serve para só trocar o status)
 *   • '{}'::jsonb     → APAGA a reescrita e volta a valer o rascunho da IA
 *   • qualquer objeto → substitui o patch inteiro
 *
 * O patch é substituído, e não mesclado no banco: quem edita manda o documento
 * de edição completo, montado na tela a partir do que já estava lá. Mesclar
 * jsonb aqui tornaria impossível APAGAR uma frase reescrita — `||` não remove
 * chave, e "voltar ao rascunho" é a operação que mais se usa.
 */
create or replace function public.revisao_decidir(
  p_mes     text,
  p_status  text default null,
  p_editado jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_status is not null and p_status not in ('novo','aceito') then
    raise exception 'Status inválido: %', p_status;
  end if;

  update public.demonstracoes_revisao
  set
    status        = coalesce(p_status, status),
    editado       = case
                      when p_editado is null      then editado
                      when p_editado = '{}'::jsonb then null
                      else p_editado
                    end,
    editado_por   = case when p_editado is null then editado_por else auth.uid() end,
    editado_em    = case when p_editado is null then editado_em  else now() end,
    atualizado_em = now()
  where mes = p_mes;

  if not found then
    raise exception 'Não há revisão gerada para %.', p_mes;
  end if;
end;
$$;

-- Função nova em `public` nasce chamável pelo `anon` (que é público, está no
-- bundle do front). Revogar do `anon` é o que fecha a porta — `from public` não
-- resolve. Ver a migration 20260806... e o mesmo bloco em cartao_recomendacoes.
revoke all on function public.revisao_decidir(text, text, jsonb) from public;
revoke all on function public.revisao_decidir(text, text, jsonb) from anon;
grant execute on function public.revisao_decidir(text, text, jsonb) to authenticated;


/* ============================================================
 *  O comentário que a DRE já tem, por rubrica
 * ============================================================
 * O "POR QUE ACONTECEU" do bloco do Pareto não é escrito de novo: é a
 * justificativa que a célula da DRE já carrega, conferida por gente no
 * fechamento. Esta função devolve só o que a Revisão precisa (rubrica → texto
 * que vale), respeitando a reescrita e ignorando o que foi descartado.
 *
 * Existe como função, e não como select direto, porque a regra "vale
 * texto_editado, senão texto" mora em três lugares no front e já divergiu uma
 * vez — aqui ela é uma só, e a tela não precisa baixar drivers e sinais que não
 * vai mostrar.
 */
create or replace function public.revisao_justificativas(p_mes text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(rubrica, texto_final),
    '{}'::jsonb
  )
  from (
    select
      rubrica,
      coalesce(nullif(btrim(texto_editado), ''), texto) as texto_final
    from public.demonstracoes_justificativas
    where tipo = 'dre'
      and mes = p_mes
      and status <> 'descartado'
      and coalesce(nullif(btrim(texto_editado), ''), texto) is not null
  ) j;
$$;

revoke all on function public.revisao_justificativas(text) from public;
revoke all on function public.revisao_justificativas(text) from anon;
grant execute on function public.revisao_justificativas(text) to authenticated;
grant execute on function public.revisao_justificativas(text) to service_role;
