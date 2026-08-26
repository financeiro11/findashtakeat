-- A triagem gravava `revisado_por = 'ia'` numa coluna UUID. Não gravava nada.
--
-- O QUE ACONTECEU, e é o pior formato de erro que existe aqui: a rodada leu 6
-- documentos, gastou 6 chamadas do Gemini, devolveu
-- `{"lidos":6,"nota":3,"nao_e_nota":1,"revisar":2}` — e o banco ficou com ZERO
-- leituras. `omie_titulo_anexo.revisado_por` é `uuid` (é quem clicou), e a
-- string 'ia' rebentava no cast dentro da função. A Edge Function chamava
-- `supabase.rpc(...)` sem olhar o `error`, então o fracasso não tinha por onde
-- aparecer: sucesso relatado, cota gasta, fila intacta.
--
-- O CONSERTO É NÃO INVENTAR UM USUÁRIO PARA A MÁQUINA. `revisado_por` responde
-- "qual PESSOA decidiu"; a IA não é uma, e forçá-la ali exigiria um uuid falso
-- que um dia alguém procuraria em `profiles`. A marca da máquina já existe e é
-- melhor: `ia_veredito` + `ia_conferido_em`.
--
--   decidiu a IA    → revisao preenchida, revisado_por NULL, ia_veredito igual
--   decidiu alguém  → revisao preenchida, revisado_por = uuid da pessoa
--
-- Quem decidiu por último vence: se uma pessoa reabrir e mudar o veredito da
-- IA, `cap_anexo_revisar` grava o uuid dela e a linha deixa de contar como
-- automática — que é exatamente o que se quer medir depois.

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
            deixa a linha onde está — com o que o modelo leu à mostra. */
         revisao = case when p_veredito in ('nota', 'nao_e_nota') then p_veredito else revisao end,
         revisado_em = case when p_veredito in ('nota', 'nao_e_nota') then now() else revisado_em end,
         /* NÃO se escreve em `revisado_por`: ela é uuid de gente. A autoria da
            máquina está em `ia_veredito`/`ia_conferido_em`. */
         revisado_por = revisado_por
   where cod_titulo = p_cod_titulo;

  if not found then
    raise exception 'título % não está em omie_titulo_anexo', p_cod_titulo;
  end if;
end;
$$;

revoke all on function public.anexo_triagem_gravar(bigint, text, jsonb, text, text) from public, anon;
grant execute on function public.anexo_triagem_gravar(bigint, text, jsonb, text, text) to service_role;

/* Desfazer só o que a MÁQUINA decidiu: veredito da IA, sem uuid de pessoa. Se
   alguém confirmou por cima, aquela linha é de gente e não se mexe nela. */
create or replace function public.anexo_triagem_desfazer(p_desde timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.omie_titulo_anexo
     set revisao = null, revisado_em = null
   where revisao is not null
     and revisado_por is null
     and ia_veredito in ('nota', 'nao_e_nota')
     and (p_desde is null or ia_conferido_em >= p_desde);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.anexo_triagem_desfazer(timestamptz) from public, anon;
grant execute on function public.anexo_triagem_desfazer(timestamptz) to authenticated, service_role;
