-- Confirmar o casamento — e o alvo 'erp' que a porta antiga não conhecia.
--
-- DOIS BURACOS, o segundo criado hoje mesmo pela migration do alvo 'erp'.
--
-- 1. `notas_externas_definir_alvo` abre com `if p_alvo_tipo not in ('pix',
--    'cartao') then raise exception`. Com o terceiro alvo no ar, a primeira
--    pessoa que escolhesse um título do contas a pagar à mão levaria um erro
--    cru na cara. A guarda estava certa quando foi escrita; ficou velha.
--
-- 2. NÃO HAVIA COMO DIZER "SIM, É ESTE". A única porta era `definir_alvo`, que
--    exige informar o alvo — serve para desempatar, não para aprovar o que o
--    casador já achou. E aprovar é exatamente o gesto que a aba Acervo pede das
--    150 notas de confiança média: o alvo está lá, o que falta é alguém olhar o
--    lado de lá e concordar.
--
-- POR QUE A CONFIRMAÇÃO IMPORTA ALÉM DO ENVIO. `alvo_manual` é o carimbo de que
-- uma PESSOA olhou. Ele já vale mais que qualquer heurística na fila automática
-- (`notas_externas_enfileirar_automatico` o aceita ao lado de exata/alta), e é
-- ele que um dia autoriza escrever o CNPJ da nota no cadastro do fornecedor no
-- Omie — coisa que o casamento por valor+data, sozinho, não tem autoridade para
-- fazer. Medido em 26/08/2026: os 102 casamentos por CNPJ não têm nada a
-- ensinar ao cadastro (casaram porque o CNPJ já estava lá), e os 13 que teriam
-- são todos `valor_data`. Sem este carimbo, a única evidência disponível para
-- corrigir o ERP seria a mais fraca que existe.

/* ============================================================================
 *  1. `definir_alvo` aprende o terceiro alvo
 * ========================================================================== */

create or replace function public.notas_externas_definir_alvo(
  p_id bigint, p_alvo_tipo text, p_alvo_id_unico text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_alvo_tipo not in ('pix', 'cartao', 'erp') then
    raise exception 'alvo_tipo inválido: %', p_alvo_tipo;
  end if;

  update public.notas_externas
     set alvo_tipo = p_alvo_tipo, alvo_id_unico = p_alvo_id_unico,
         casamento = 'manual', confianca = 'exata',
         alvo_manual = true, candidatos = null, atualizado_em = now()
   where id = p_id and enviado_erp_em is null;

  -- Recalcula só a conferência desta nota, sem recasar as outras 4.200.
  update public.notas_externas nt
     set conferencia = case
           when e.ja_tem then 'confere'
           when nt.diz_anexado then 'promessa_falsa'
           else 'falta_anexar' end,
         erp_anexos = e.anexos, conferido_em = now()
    from (
      select coalesce(
               case when p_alvo_tipo = 'pix'
                    then p.tem_comprovante or coalesce(ota.qtd, 0) > 0
                    -- No 'erp' a única testemunha é o ListarAnexo já lido.
                    when p_alvo_tipo = 'erp'
                    then coalesce(ota.qtd, 0) > 0
                    else coalesce(c.status_nf, '') = 'OK'
                      or coalesce(c.link_comprovante, '') <> '' end, false) as ja_tem,
             ota.qtd as anexos
        from (select 1) _
        left join public.auditoria_pix_lancamentos p
               on p_alvo_tipo = 'pix' and p.id_unico = p_alvo_id_unico
        left join public.auditoria_cartao_lancamentos c
               on p_alvo_tipo = 'cartao' and c.id_unico = p_alvo_id_unico
        -- Mesmo cuidado do `casar`: o cast vai por `nullif(regexp_replace(...))`,
        -- porque a ordem de avaliação numa junção não é promessa.
        left join public.omie_titulo_anexo ota
               on p_alvo_tipo in ('pix', 'erp')
              and ota.cod_titulo = nullif(regexp_replace(p_alvo_id_unico, '\D', '', 'g'), '')::bigint
    ) e
   where nt.id = p_id;
end;
$$;

revoke all on function public.notas_externas_definir_alvo(bigint, text, text) from public;
revoke all on function public.notas_externas_definir_alvo(bigint, text, text) from anon;
grant execute on function public.notas_externas_definir_alvo(bigint, text, text) to authenticated, service_role;

/* ============================================================================
 *  2. "Sim, é este" — aprovar o que o casador já achou
 * ========================================================================== */

create or replace function public.notas_externas_confirmar(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  /* Só carimba. O alvo continua o que o casador escolheu — se estivesse errado,
     o gesto seria `definir_alvo` com o certo, não este. `confianca` NÃO vira
     'exata': mentir sobre a origem do casamento apagaria a diferença entre
     "o CNPJ bateu" e "alguém concordou", que é justamente o que se quer saber
     depois, quando a pergunta for de onde veio a autoridade. */
  update public.notas_externas
     set alvo_manual = true, candidatos = null, atualizado_em = now()
   where id = any(p_ids)
     and enviado_erp_em is null
     and ignorado_em is null
     and alvo_tipo is not null
     and not alvo_manual;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.notas_externas_confirmar(bigint[]) is
  'Carimba `alvo_manual` no casamento que o casador achou — o "sim, é este" de quem olhou. Não muda o alvo nem a confiança: a origem do casamento continua legível.';

revoke all on function public.notas_externas_confirmar(bigint[]) from public;
revoke all on function public.notas_externas_confirmar(bigint[]) from anon;
grant execute on function public.notas_externas_confirmar(bigint[]) to authenticated, service_role;
