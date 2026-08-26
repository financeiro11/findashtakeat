-- A disputa passa a contar DOCUMENTOS, e não linhas.
--
-- O PROBLEMA, medido em 26/08/2026 nas 603 notas paradas em `alvo_disputado`
-- (alvo único, mas "mais de uma linha reivindica"):
--
--   • 178 NÃO SÃO NOTA. Logotipo de assinatura de e-mail (112), `image001`,
--     `anexo1`, boleto, e o aviso "Sua nota fiscal do Google Ads está pronta".
--     Todos entravam na disputa porque o casador nunca olhou `parece_nota` —
--     e um logotipo bloqueava a nota de verdade que apontava para o mesmo título.
--
--   • 302 das 527 linhas com `chave_fiscal` SÃO CÓPIA: a mesma NF-e chega até
--     NOVE vezes. O PDF e o XML do mesmo e-mail, a mesma nota reenviada na
--     resposta da thread, e o arquivo que a automação antiga já tinha largado em
--     "0. Gmail" no Drive. Contadas como pretendentes distintos, viravam disputa
--     entre a nota e ela mesma. Pior: com alvo definido, o ERP receberia a mesma
--     NF-e seis vezes.
--
--   • 66 são nota SEM VALOR. Sem valor, a única regra que alcança é a 2
--     (mesmo CNPJ dentro da janela) — que não olha valor nenhum. Um fornecedor
--     frequente vira leque: 59 notas da PrimeAcesso apontando para UM título.
--
-- Tirando cópia e não-nota, 77 dos 133 alvos ficam com UMA nota só. Esses estavam
-- bloqueados por ruído, não por dúvida.
--
-- ---------------------------------------------------------------------------
-- O QUE NÃO ERA VERDADE, e é bom estar escrito
--
-- A primeira leitura dos dados sugeriu CONSOLIDAÇÃO: o título 5504309296 da
-- PrimeAcesso vale R$ 4.063,06 e as notas em volta são de R$ 395, R$ 742,58,
-- R$ 924,32… — cara de um pagamento fechando várias notas do mês. Testado nos
-- 56 alvos que sobram com mais de uma nota: **zero** somam o valor do título.
-- Achar o subconjunto que soma é outro problema, e chutar qual seria colaria
-- nota errada em título certo. Por isso esses 56 continuam parados para gente —
-- só que agora com 2 a 5 candidatas à vista, e não 26.
--
-- ---------------------------------------------------------------------------
-- O PESO DA REIVINDICAÇÃO
--
-- Em vez de "empate não casa", que tratava logotipo e NF-e como iguais, cada
-- pretendente passa a ter peso:
--
--   2 = é nota e tem valor      — dá para conferir
--   1 = é nota, sem valor       — vale como palpite, não como prova
--   0 = não é nota              — boleto, aviso, logotipo
--
-- Só os do MAIOR peso presente disputam. Um logotipo nunca mais impede uma NF-e
-- de achar o título dela; e se o único pretendente for um logotipo, ele também
-- não ganha nada — a regra 2 agora exige `parece_nota`, que é o que lhe dava
-- passagem.

/* ============================================================================
 *  1. A cópia ganha nome
 * ========================================================================== */

alter table public.notas_externas
  add column if not exists copia_de bigint references public.notas_externas(id);

comment on column public.notas_externas.copia_de is
  'Aponta para a linha que CARREGA este documento, quando a mesma NF-e entrou por mais de uma porta (PDF e XML do mesmo e-mail, reenvio na thread, o arquivo que a automação antiga largou no Drive). Identidade pela chave de acesso, que é única por documento fiscal. A cópia não disputa e não vai ao ERP — o arquivo já foi por outra linha.';

create index if not exists notas_externas_copia_idx on public.notas_externas (copia_de)
  where copia_de is not null;

/* Quem carrega: a linha de menor id entre as que dividem a chave fiscal. É
   arbitrário de propósito — as cópias são o MESMO documento, então qualquer uma
   serve, e o menor id é estável entre rodadas (o que evita o carimbo dançar). */
create or replace function public.notas_externas_marcar_copias()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  with portador as (
    select chave_fiscal, min(id) as id
      from public.notas_externas
     where chave_fiscal is not null
     group by chave_fiscal
  )
  update public.notas_externas n
     set copia_de = p.id, atualizado_em = now()
    from portador p
   where n.chave_fiscal = p.chave_fiscal
     and n.id <> p.id
     -- Nota já enviada não vira cópia: o arquivo dela está no ERP, e apagar
     -- esse fato para chamá-la de cópia perderia o rastro de quem subiu o quê.
     and n.enviado_erp_em is null
     and n.copia_de is distinct from p.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.notas_externas_marcar_copias() from public, anon;
grant execute on function public.notas_externas_marcar_copias() to authenticated, service_role;

/* ============================================================================
 *  2. A fila não manda cópia
 * ========================================================================== */

create or replace function public.notas_externas_enfileirar(p_ids bigint[])
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
     and tem_arquivo
     -- Nem a mesma NF-e duas vezes. A chave de acesso é única por documento
     -- fiscal: se outra linha carrega a mesma, o arquivo já está a caminho.
     and copia_de is null;
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

revoke all on function public.notas_externas_enfileirar(bigint[]) from public, anon;
grant execute on function public.notas_externas_enfileirar(bigint[]) to authenticated, service_role;

/* A fila automática também para de oferecer cópia — senão ela entraria, seria
   recusada pela porta, e o contador de "enfileiradas" mentiria todo dia. */
create or replace function public.notas_externas_enfileirar_automatico(
  p_limite integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
  v_n   integer;
begin
  select array_agg(id order by id)
    into v_ids
    from (
      select id
        from public.notas_externas
       where enviado_erp_em is null
         and ignorado_em is null
         and alvo_tipo is not null
         and tem_arquivo
         and copia_de is null
         and conferencia in ('falta_anexar', 'promessa_falsa')
         and (confianca in ('exata', 'alta') or alvo_manual)
         and not fila_erp
       order by id
       limit p_limite
    ) t;

  if v_ids is null then
    return jsonb_build_object('enfileiradas', 0, 'ja_na_fila',
      (select count(*) from public.notas_externas where fila_erp and enviado_erp_em is null));
  end if;

  v_n := public.notas_externas_enfileirar(v_ids);

  return jsonb_build_object(
    'enfileiradas', v_n,
    'ja_na_fila', (select count(*) from public.notas_externas
                    where fila_erp and enviado_erp_em is null),
    'esperando_gente', (select count(*) from public.notas_externas
                         where enviado_erp_em is null and ignorado_em is null
                           and alvo_tipo is not null and tem_arquivo and copia_de is null
                           and conferencia in ('falta_anexar', 'promessa_falsa')
                           and confianca = 'media' and not alvo_manual and not fila_erp)
  );
end;
$$;

revoke all on function public.notas_externas_enfileirar_automatico(integer) from public, anon;
grant execute on function public.notas_externas_enfileirar_automatico(integer) to authenticated, service_role;
