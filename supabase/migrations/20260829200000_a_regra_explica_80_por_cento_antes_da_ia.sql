-- A regra explica 80% antes de a IA ser chamada.
--
-- Medido em 29/08/2026, sobre as 996 notas sem alvo:
--
--   292  não são nota           (`parece_nota = false` — a triagem já disse)
--   374  são anteriores a 04/26 (o acervo começa em abril; antes disso não há título)
--   135  estão sem valor lido   (sem valor não há como casar por valor)
--   ---
--   195  sobram para a IA
--
-- Ou seja: perguntar ao modelo sobre as 996 gastaria cinco vezes mais chamadas
-- para descobrir o que três `case when` já sabem. O CLAUDE.md e o desenho do
-- Hub inteiro dizem a mesma coisa — sinal determinístico primeiro, IA só onde é
-- preciso significado — e este é o caso mais claro disso em muito tempo.
--
-- Não é economia de dinheiro (195 chamadas custam centavos). É economia de
-- DISPONIBILIDADE: cada chamada desnecessária é uma vaga a menos no teto diário
-- e um passo a mais na direção do 503 que já aparece 11 vezes por dia nos logs.
--
-- AS ETIQUETAS SÃO AS MESMAS das que a IA usa, de propósito: quem lê a tela não
-- precisa saber se foi regra ou modelo que classificou aquela linha. Quem
-- precisa saber é quem for auditar, e para isso existe `nao_casou_por`.

alter table public.notas_externas
  add column if not exists nao_casou_por text;

comment on column public.notas_externas.nao_casou_por is
  'Quem classificou o motivo: `regra` ou `ia`. A etiqueta em `nao_casou_motivo` é a mesma nos dois casos — a tela não distingue, a auditoria sim.';

/**
 * A passada determinística. Roda inteira, é barata e é idempotente: só toca em
 * quem ainda não tem motivo.
 */
create or replace function public.notas_externas_motivo_por_regra()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_marcadas int;
begin
  with alvo as (
    select id,
           case
             /* A triagem já leu o documento e disse que não é nota. Perguntar
                de novo a um modelo seria pagar duas vezes pela mesma resposta. */
             when not parece_nota then 'nao_e_nota'
             /* O ACERVO COMEÇA EM ABRIL/2026. Nota anterior não tem título a que
                casar — e, pior, se casasse, se acomodaria no título de outro mês.
                Não é falha do casador: é documento fora da janela. */
             when coalesce(vencimento, enviado_em) < date '2026-04-01' then 'periodo_anterior'
             /* Sem valor lido não há casamento por valor, que é a regra que
                resolve a maioria. O caminho daqui é reler o arquivo, não
                perguntar a ninguém. */
             when valor is null then 'sem_valor_lido'
           end as motivo
      from public.notas_externas
     where ignorado_em is null
       and copia_de is null
       and enviado_erp_em is null
       and not alvo_manual
       and alvo_tipo is null
       and candidatos is null
       and nao_casou_em is null
  )
  update public.notas_externas n
     set nao_casou_motivo = a.motivo,
         nao_casou_por    = 'regra',
         nao_casou_em     = now(),
         atualizado_em    = now()
    from alvo a
   where n.id = a.id and a.motivo is not null;

  get diagnostics v_marcadas = row_count;

  return jsonb_build_object(
    'marcadas', v_marcadas,
    'resta_para_ia', (select count(*) from public.notas_externas
                       where ignorado_em is null and copia_de is null and enviado_erp_em is null
                         and not alvo_manual and alvo_tipo is null and candidatos is null
                         and nao_casou_em is null)
  );
end;
$$;

comment on function public.notas_externas_motivo_por_regra() is
  'Classifica por regra o motivo de a nota não ter casado, e assim tira ~80% da fila antes de qualquer chamada de IA. Idempotente: só toca em quem ainda não tem motivo.';

revoke all on function public.notas_externas_motivo_por_regra() from public;
revoke all on function public.notas_externas_motivo_por_regra() from anon;
grant execute on function public.notas_externas_motivo_por_regra() to authenticated, service_role;

/* Grava o veredito da IA. Uma nota por chamada, e a função existe para que a
   Edge Function não precise de permissão de UPDATE em `notas_externas`. */
create or replace function public.notas_externas_gravar_motivo(
  p_id bigint,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_motivo not in ('nao_e_nota', 'periodo_anterior', 'sem_valor_lido',
                      'fornecedor_sem_titulo', 'valor_divergente', 'indefinido') then
    raise exception 'motivo desconhecido: %', p_motivo;
  end if;
  update public.notas_externas
     set nao_casou_motivo = p_motivo,
         nao_casou_por    = 'ia',
         nao_casou_em     = now(),
         atualizado_em    = now()
   where id = p_id;
end;
$$;

revoke all on function public.notas_externas_gravar_motivo(bigint, text) from public;
revoke all on function public.notas_externas_gravar_motivo(bigint, text) from anon;
grant execute on function public.notas_externas_gravar_motivo(bigint, text) to service_role;

/* Grava a SUGESTÃO de desempate. Note o que ela NÃO faz: não escreve
   `alvo_tipo`. A opinião da IA e a decisão de gente moram em colunas
   diferentes de propósito — `notas_externas_definir_alvo` continua sendo o
   único caminho para apontar alvo, e continua sendo chamado por uma pessoa. */
create or replace function public.notas_externas_gravar_sugestao(
  p_id bigint,
  p_alvo_tipo text,
  p_alvo_id_unico text,
  p_porque text,
  p_confianca text,
  p_modelo text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.notas_externas
     set sugestao_ia = case
           when p_alvo_id_unico is null or p_alvo_id_unico = ''
             then jsonb_build_object('escolheu', false, 'porque', p_porque, 'modelo', p_modelo)
           else jsonb_build_object(
                  'escolheu', true,
                  'alvo_tipo', p_alvo_tipo,
                  'alvo_id_unico', p_alvo_id_unico,
                  'porque', p_porque,
                  'confianca', coalesce(p_confianca, 'media'),
                  'modelo', p_modelo)
         end,
         sugestao_em   = now(),
         atualizado_em = now()
   where id = p_id;
end;
$$;

revoke all on function public.notas_externas_gravar_sugestao(bigint, text, text, text, text, text) from public;
revoke all on function public.notas_externas_gravar_sugestao(bigint, text, text, text, text, text) from anon;
grant execute on function public.notas_externas_gravar_sugestao(bigint, text, text, text, text, text) to service_role;

/* A fila do motivo passa a excluir quem a regra já explicou — a Edge Function
   não precisa saber das regras, só pedir o que sobrou. */
create or replace function public.notas_externas_fila_explicar(
  p_modo text,
  p_limite int default 20
)
returns table (
  id bigint, nome text, o_que_e text, detalhe text, valor numeric,
  vencimento date, enviado_em date, cnpj text, fonte text, competencia text,
  candidatos jsonb
)
language sql
stable
set search_path to 'public'
as $$
  select n.id, n.nome, n.o_que_e, n.detalhe, n.valor,
         n.vencimento, n.enviado_em, n.cnpj, n.fonte, n.competencia,
         n.candidatos
    from public.notas_externas n
   where n.ignorado_em is null
     and n.copia_de is null
     and n.enviado_erp_em is null
     and not n.alvo_manual
     and n.alvo_tipo is null
     and case
           when p_modo = 'desempatar' then n.candidatos is not null and n.sugestao_em is null
           when p_modo = 'motivo'     then n.candidatos is null     and n.nao_casou_em is null
           else false
         end
   order by n.valor desc nulls last, n.id
   limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;

revoke all on function public.notas_externas_fila_explicar(text, int) from public;
revoke all on function public.notas_externas_fila_explicar(text, int) from anon;
grant execute on function public.notas_externas_fila_explicar(text, int) to authenticated, service_role;

/* O resumo ganha a divisão entre regra e IA — é o número que diz se valeu. */
create or replace function public.notas_externas_explicar_resumo()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'desempatar_fila', (select count(*) from public.notas_externas
                         where ignorado_em is null and copia_de is null and enviado_erp_em is null
                           and not alvo_manual and alvo_tipo is null
                           and candidatos is not null and sugestao_em is null),
    'desempatar_feitas', (select count(*) from public.notas_externas where sugestao_ia is not null),
    'motivo_fila', (select count(*) from public.notas_externas
                     where ignorado_em is null and copia_de is null and enviado_erp_em is null
                       and not alvo_manual and alvo_tipo is null
                       and candidatos is null and nao_casou_em is null),
    'motivo_por_regra', (select count(*) from public.notas_externas where nao_casou_por = 'regra'),
    'motivo_por_ia', (select count(*) from public.notas_externas where nao_casou_por = 'ia'),
    'por_motivo', (select jsonb_object_agg(m, n) from (
                     select nao_casou_motivo as m, count(*) as n
                       from public.notas_externas
                      where nao_casou_motivo is not null group by 1) t)
  );
$$;

revoke all on function public.notas_externas_explicar_resumo() from public;
revoke all on function public.notas_externas_explicar_resumo() from anon;
grant execute on function public.notas_externas_explicar_resumo() to authenticated, service_role;
