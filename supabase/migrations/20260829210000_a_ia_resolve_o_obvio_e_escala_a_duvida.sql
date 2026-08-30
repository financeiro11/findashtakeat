-- A IA resolve o óbvio e escala a dúvida.
--
-- Decisão do usuário em 29/08/2026, e ela tem precedente dentro do próprio Hub:
-- o acervo de notas já sobe documento sozinho quando a confiança é alta. O que
-- muda aqui é que o desempate passa a ter a mesma régua.
--
-- ---------------------------------------------------------------------------
-- AS TRÊS GUARDAS, e por que são três e não uma. A primeira rodada real deu a
-- prova de que a leitura funciona E o desenho do limite, no mesmo caso:
--
--   Documento 32468: "VICTORIA PARTNERS - Lembrete de Vencimento do Pix da
--   NFS-e nº 510 - 25/06 Qui". Nove títulos candidatos, TODOS de R$ 11.262 (é
--   uma consultoria mensal). A IA escolheu o de 25/06 — que está a 23 dias de
--   distância, enquanto o mais próximo em data era o de 27/05, a 6 dias.
--   Ou seja: o casador determinístico teria escolhido o ERRADO, e ela acertou
--   porque leu o "25/06" escrito no assunto do e-mail.
--
-- E, no entanto, esse caso NÃO pode ser aplicado sozinho — por dois motivos que
-- nada têm a ver com a qualidade da leitura:
--
--   1. o título de 25/06 JÁ TEM NOTA anexada. Apontar para ele é, na melhor das
--      hipóteses, redundante;
--   2. o documento é um LEMBRETE DE VENCIMENTO sem arquivo (`fonte = 'email'`,
--      "sem arquivo anexado"). Não há o que subir ao ERP.
--
-- Daí as três guardas. Confiança alta responde por "a leitura está certa"; as
-- outras duas respondem por "e vale a pena agir". São perguntas diferentes, e
-- confundi-las é como se automatiza um acerto até ele virar erro.
--
-- ---------------------------------------------------------------------------
-- O QUE FICA REVERSÍVEL. `alvo_manual` continua sendo TRUE para o que a IA
-- aplica — não porque uma máquina seja gente, mas porque é isso que impede o
-- casador de desfazer a decisão na próxima passada. Quem distingue é
-- `alvo_decidido_por`, e é por ele que se audita, se desfaz em lote e se mede se
-- valeu.

alter table public.notas_externas
  add column if not exists alvo_decidido_por text;

comment on column public.notas_externas.alvo_decidido_por is
  'Quem apontou o alvo: `ia` (auto-resolvido por confiança alta) ou nulo/`gente` (alguém clicou). `alvo_manual` é TRUE nos dois casos — é o que impede o casador de desfazer —, então esta coluna é a única forma de auditar ou desfazer em lote o que a IA decidiu.';

create index if not exists notas_externas_decidido_por_ia
  on public.notas_externas (alvo_decidido_por) where alvo_decidido_por = 'ia';

/**
 * Aplica a sugestão da IA — mas só quando as três guardas passam. Devolve o que
 * decidiu e POR QUÊ, para que a rodada consiga relatar "olhei 7, apliquei 1" em
 * vez de um número mudo.
 *
 * A checagem mora AQUI, no Postgres, e não na Edge Function, de propósito: é a
 * mesma razão de `notas_externas_definir_alvo` existir — a decisão de escrever
 * alvo tem um único dono, e ele é auditável sem ler TypeScript.
 */
create or replace function public.notas_externas_aplicar_sugestao(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n record;
  s jsonb;
  v_tem_nota boolean;
  v_tipo text;
  v_alvo text;
begin
  select * into n from public.notas_externas where id = p_id;
  if not found then return jsonb_build_object('aplicou', false, 'porque', 'nota não existe'); end if;

  s := n.sugestao_ia;
  if s is null or coalesce((s->>'escolheu')::boolean, false) is not true then
    return jsonb_build_object('aplicou', false, 'porque', 'a IA não escolheu candidato');
  end if;

  /* GUARDA 1 — a leitura precisa ser afirmação, não inferência. */
  if coalesce(s->>'confianca', '') <> 'alta' then
    return jsonb_build_object('aplicou', false, 'porque', 'confiança ' || coalesce(s->>'confianca', '?'));
  end if;

  /* GUARDA 2 — tem de haver arquivo. Sem arquivo não há nada a levar ao ERP, e
     apontar alvo só suja o acervo. É o caso do lembrete de vencimento por
     e-mail, que é a maioria da fonte `email`. */
  if not coalesce(n.tem_arquivo, false) then
    return jsonb_build_object('aplicou', false, 'porque', 'documento sem arquivo');
  end if;

  /* Ninguém sobrescreve decisão de gente, nem a IA. */
  if n.alvo_manual then
    return jsonb_build_object('aplicou', false, 'porque', 'já tem alvo decidido');
  end if;

  v_tipo := s->>'alvo_tipo';
  v_alvo := s->>'alvo_id_unico';

  /* GUARDA 3 — o título escolhido ainda precisa estar DEVENDO nota. Um título
     que já tem anexo quase nunca é o certo (é justamente ele que cria o empate),
     e aplicar sobre ele é redundância na melhor das hipóteses. */
  select case
           when v_tipo = 'pix' then coalesce(p.tem_comprovante, false)
                                 or coalesce(ota.qtd, 0) > 0
           when v_tipo = 'erp' then coalesce(ota.qtd, 0) > 0
           else coalesce(c.status_nf, '') = 'OK' or coalesce(c.link_comprovante, '') <> ''
         end
    into v_tem_nota
    from (select 1) x
    left join public.auditoria_pix_lancamentos p
           on v_tipo = 'pix' and p.id_unico = v_alvo
    left join public.auditoria_cartao_lancamentos c
           on v_tipo = 'cartao' and c.id_unico = v_alvo
    left join public.omie_titulo_anexo ota
           on v_tipo in ('pix', 'erp')
          and ota.cod_titulo = nullif(regexp_replace(v_alvo, '\D', '', 'g'), '')::bigint;

  if coalesce(v_tem_nota, false) then
    return jsonb_build_object('aplicou', false, 'porque', 'o título escolhido já tem nota');
  end if;

  update public.notas_externas
     set alvo_tipo         = v_tipo,
         alvo_id_unico     = v_alvo,
         alvo_manual       = true,   -- para o casador não desfazer na próxima passada
         alvo_decidido_por = 'ia',
         casamento         = 'leitura_ia',
         confianca         = 'alta',
         candidatos        = null,
         atualizado_em     = now()
   where id = p_id;

  return jsonb_build_object('aplicou', true, 'alvo_tipo', v_tipo, 'alvo_id_unico', v_alvo);
end;
$$;

comment on function public.notas_externas_aplicar_sugestao(bigint) is
  'Aplica o desempate da IA quando as TRÊS guardas passam: confiança alta, documento com arquivo e título ainda sem nota. Confiança responde por "a leitura está certa"; as outras duas por "e vale a pena agir" — são perguntas diferentes.';

revoke all on function public.notas_externas_aplicar_sugestao(bigint) from public;
revoke all on function public.notas_externas_aplicar_sugestao(bigint) from anon;
grant execute on function public.notas_externas_aplicar_sugestao(bigint) to service_role;

/** Desfazer em lote o que a IA decidiu. Existe antes de ser preciso: autonomia
    sem botão de voltar é aposta, não decisão. */
create or replace function public.notas_externas_desfazer_ia(p_desde timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n int;
begin
  update public.notas_externas
     set alvo_tipo = null, alvo_id_unico = null, alvo_manual = false,
         alvo_decidido_por = null, casamento = null, confianca = null,
         atualizado_em = now()
   where alvo_decidido_por = 'ia'
     and enviado_erp_em is null          -- o que já subiu não se desfaz por aqui
     and (p_desde is null or atualizado_em >= p_desde);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.notas_externas_desfazer_ia(timestamptz) from public;
revoke all on function public.notas_externas_desfazer_ia(timestamptz) from anon;
grant execute on function public.notas_externas_desfazer_ia(timestamptz) to authenticated, service_role;

/* O resumo passa a contar o que a IA resolveu sozinha — é o número que diz se a
   autonomia está pagando ou só enfeitando. */
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
    'resolvidas_pela_ia', (select count(*) from public.notas_externas where alvo_decidido_por = 'ia'),
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
