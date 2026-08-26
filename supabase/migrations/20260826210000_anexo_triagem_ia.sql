-- A IA faz a primeira triagem do "Anexo a conferir".
--
-- A FILA QUE NINGUÉM ABRE DUAS VEZES. Chegam aqui os anexos cujo NOME não
-- identifica nada: `nf_undefined_correta.pdf`, `5aef68b9-…​.tmp.pdf`,
-- `whatsappimage2026-04-02at16.05.40 (2).jpeg`. A pergunta é curta — "isto é a
-- nota deste título?" — e a resposta exige abrir o arquivo, um por um. Com o
-- visor dentro do Hub isso virou possível; continua sendo trabalho manual de 32
-- documentos, e cresce a cada varredura.
--
-- O MESMO DESENHO DA AUDITORIA, e pelo mesmo motivo: **a IA transcreve, a regra
-- decide**. O modelo devolve o que LEU no papel (que tipo de documento é, quem
-- emitiu, CNPJ, número, valor) e o veredito sai de uma função em TypeScript
-- sobre isso. Foi o que impediu, na conferência de comprovantes, que o modelo
-- aprovasse um bilhete afirmando que a tarifa batia quando nenhuma linha valia
-- aquele número.
--
-- O QUE A TRIAGEM DECIDE SOZINHA é só o que não tem volta interessante:
--   • documento fiscal legítimo, do valor certo → `nota`
--   • foto de coisa nenhuma, print de tela, contrato, boleto → `nao_e_nota`
-- O resto — nota de valor que não bate, documento ilegível, tipo incerto —
-- **fica na fila com a leitura à mostra**. Ler não é decidir, e a metade dos
-- casos em que o modelo hesita é onde mora o achado.
--
-- `revisado_por = 'ia'` separa o que foi máquina do que foi gente. Sem isso não
-- há como medir a triagem depois nem desfazer uma leva ruim.

alter table public.omie_titulo_anexo
  add column if not exists ia_leitura     jsonb,
  add column if not exists ia_veredito    text,
  add column if not exists ia_motivo      text,
  add column if not exists ia_conferido_em timestamptz,
  -- Qual arquivo foi lido. O anexo do título pode ser trocado no ERP; sem isto,
  -- a leitura velha continuaria valendo para um documento novo.
  add column if not exists ia_arquivo     text;

comment on column public.omie_titulo_anexo.ia_leitura is
  'O que o modelo TRANSCREVEU do documento — tipo, emitente, CNPJ, número, valor, data. Não é o veredito: o veredito sai da regra em `_shared/anexo-triagem.ts` sobre estes campos.';
comment on column public.omie_titulo_anexo.ia_veredito is
  'nota | nao_e_nota | revisar. "revisar" é a IA dizendo que NÃO dá para decidir sozinha — e continua na fila.';
comment on column public.omie_titulo_anexo.ia_arquivo is
  'Nome/id do anexo que foi lido. Anexo trocado no ERP invalida a leitura.';

/* ============================================================================
 *  A fila da triagem
 * ==========================================================================
 * Quem ainda não foi lido, ou foi lido quando o anexo era outro. Ordena pelo
 * VALOR do título: se a rodada não couber inteira, que o dinheiro grande venha
 * primeiro. */

create or replace function public.anexo_triagem_fila(p_limite integer default 6)
returns table (
  cod_titulo bigint, id_anexo text, c_tabela text, nome text,
  favorecido text, valor numeric, competencia date, categoria text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select a.cod_titulo,
         coalesce(a.anexos->0->>'id', '') as id_anexo,
         coalesce(a.c_tabela, 'conta-pagar') as c_tabela,
         a.anexos->0->>'nome' as nome,
         coalesce(t.favorecido, t.favorecido_cru, '') as favorecido,
         t.valor, t.competencia, t.categoria
    from public.omie_titulo_anexo a
    join public.cap_titulos t on t.cod_titulo = a.cod_titulo
   where coalesce(a.qtd, 0) > 0
     and a.revisao is null
     and a.classe = 'duvidoso'
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''))
   order by t.valor desc nulls last, a.cod_titulo
   limit greatest(1, least(coalesce(p_limite, 6), 12));
$$;

revoke all on function public.anexo_triagem_fila(integer) from public, anon;
grant execute on function public.anexo_triagem_fila(integer) to service_role;

create or replace function public.anexo_triagem_fila_total()
returns integer language sql security definer stable
set search_path = public, pg_temp as $$
  select count(*)::int
    from public.omie_titulo_anexo a
    join public.cap_titulos t on t.cod_titulo = a.cod_titulo
   where coalesce(a.qtd, 0) > 0 and a.revisao is null and a.classe = 'duvidoso'
     and (a.ia_conferido_em is null
          or a.ia_arquivo is distinct from coalesce(a.anexos->0->>'nome', ''));
$$;

revoke all on function public.anexo_triagem_fila_total() from public, anon;
grant execute on function public.anexo_triagem_fila_total() to authenticated, service_role;

/* ============================================================================
 *  Gravar a leitura — e decidir, quando for o caso
 * ========================================================================== */

create or replace function public.anexo_triagem_gravar(
  p_cod_titulo bigint,
  p_arquivo    text,
  p_leitura    jsonb,
  p_veredito   text,
  p_motivo     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.omie_titulo_anexo
     set ia_leitura = p_leitura,
         ia_veredito = p_veredito,
         ia_motivo = p_motivo,
         ia_arquivo = p_arquivo,
         ia_conferido_em = now(),
         /* Só sai da fila quando a regra decidiu. `revisar` grava a leitura e
            deixa a linha onde está — com o que o modelo leu à mostra, que é o
            que torna a decisão de gente rápida em vez de impossível. */
         revisao = case when p_veredito in ('nota', 'nao_e_nota') then p_veredito else revisao end,
         revisado_em = case when p_veredito in ('nota', 'nao_e_nota') then now() else revisado_em end,
         revisado_por = case when p_veredito in ('nota', 'nao_e_nota') then 'ia' else revisado_por end
   where cod_titulo = p_cod_titulo;
end;
$$;

revoke all on function public.anexo_triagem_gravar(bigint, text, jsonb, text, text) from public, anon;
grant execute on function public.anexo_triagem_gravar(bigint, text, jsonb, text, text) to service_role;

/* Desfazer uma leva da IA, se a triagem sair ruim. Existe porque decisão
   automática sem botão de volta é decisão que ninguém deixa ligar. */
create or replace function public.anexo_triagem_desfazer(p_desde timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.omie_titulo_anexo
     set revisao = null, revisado_em = null, revisado_por = null
   where revisado_por = 'ia'
     and (p_desde is null or revisado_em >= p_desde);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.anexo_triagem_desfazer(timestamptz) from public, anon;
grant execute on function public.anexo_triagem_desfazer(timestamptz) to authenticated, service_role;
