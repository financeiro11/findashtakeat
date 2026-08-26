-- A nota anexada num lugar aparece em todos — e vai para o ERP.
--
-- O MESMO GASTO MORA EM ATÉ CINCO LISTAS. Uma compra no cartão vira linha na
-- Base do Cartão, vira um ou dois achados na Auditoria, pode ter a NF anexada
-- pelo Hub de Facilities, pode ter chegado por e-mail e virado `notas_externas`,
-- e é um título no contas a pagar do Omie. Quem anexa a nota resolve UMA dessas
-- listas; as outras continuam cobrando o mesmo documento da mesma pessoa.
--
-- Medido em 26/08/2026: 434 títulos têm nota em algum lugar do Hub, e **80 deles
-- o ERP não tem**. Não por falta de arquivo — por falta de caminho entre as
-- listas.
--
-- O QUE LIGA TUDO É O `cod_titulo`, e ele já está em todas:
--   auditoria.omie_cod_titulo · auditoria_cartao_lancamentos.omie_cod_titulo
--   facilities_compras.omie_cod_titulo · comprovantes_drive.cod_titulo
--   notas_externas (alvo 'pix'/'erp' É o cod_titulo; 'cartao' vai pela base)
--   auditoria_pix_lancamentos.id_unico É o próprio nCodTitulo
--
-- ---------------------------------------------------------------------------
-- O PIX NÃO RECEBE ESCRITA, E ISSO É DECISÃO
--
-- `auditoria_pix_lancamentos.comprovante_url` / `tem_comprovante` querem dizer
-- "O OMIE tem o arquivo" — vieram do `ListarAnexo`, e a tela escreve
-- "Comprovante anexado no Omie" em cima deles. Escrever ali um link do Drive
-- pintaria de verde uma linha que o contador abre e não encontra nada. Foi
-- exatamente o defeito que a NF do Facilities já causou uma vez.
--
-- Além disso a ação `anexos` da `omie-pix-sync` REESCREVE essas colunas com o
-- que o ERP responde, inclusive `null`: o que se escrevesse aqui duraria até a
-- próxima sincronização. A nota do PIX mora em `notas_externas`, e o que a faz
-- aparecer verde é ela chegar ao ERP de verdade.
--
-- ---------------------------------------------------------------------------
-- PROPAGAR NÃO É ENVIAR
--
-- Esta função só preenche o que está vazio. Quem leva o arquivo ao Omie
-- continua sendo a `omie-anexar-comprovante`, e ela acha o trabalho sozinha: a
-- fila dela é "tem link, tem título, não tem carimbo de envio". Preencher o
-- link JÁ enfileira. Duas portas para o mesmo envio seriam duas travas para
-- manter em dia.

/* ============================================================================
 *  De onde vem a nota daquele título
 * ==========================================================================
 * Ordem de preferência: o que passou por decisão humana primeiro, o que uma
 * varredura achou por último. `notas_externas` só entra com arquivo, sendo nota
 * e não sendo cópia — as três guardas que a fila do ERP também exige. */

create or replace function public.nota_fonte_do_titulo(p_cod text)
returns table (fonte text, link text, nome text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  -- `prio` só ordena; ela não faz parte do que a função devolve.
  select t.fonte, t.link, t.nome from (
    select 'auditoria'::text, a.link_comprovante, a.titulo, 1
      from public.auditoria a
     where a.omie_cod_titulo = p_cod and coalesce(a.link_comprovante, '') <> ''
    union all
    select 'cartao', c.link_comprovante, coalesce(c.arquivo_comprovante, c.estabelecimento), 2
      from public.auditoria_cartao_lancamentos c
     where c.omie_cod_titulo = p_cod and coalesce(c.link_comprovante, '') <> ''
    union all
    select 'facilities', f.nf_arquivo, coalesce(f.nf_nome, f.nf_numero), 3
      from public.facilities_compras f
     where f.omie_cod_titulo = p_cod and coalesce(f.nf_arquivo, '') <> ''
    union all
    select 'acervo', n.link, coalesce(n.nome, n.o_que_e), 4
      from public.notas_externas n
      left join public.auditoria_cartao_lancamentos cc
             on n.alvo_tipo = 'cartao' and cc.id_unico = n.alvo_id_unico
     where coalesce(
             case when n.alvo_tipo in ('pix', 'erp') then n.alvo_id_unico
                  else cc.omie_cod_titulo end, '') = p_cod
       and n.tem_arquivo and n.parece_nota and n.copia_de is null
       and coalesce(n.link, '') <> ''
    union all
    select 'drive', 'https://drive.google.com/file/d/' || d.drive_id || '/view', d.nome_arquivo, 5
      from public.comprovantes_drive d
     where d.cod_titulo = p_cod and coalesce(d.drive_id, '') <> ''
  ) t(fonte, link, nome, prio)
   order by t.prio
   limit 1;
$$;

revoke all on function public.nota_fonte_do_titulo(text) from public, anon;
grant execute on function public.nota_fonte_do_titulo(text) to authenticated, service_role;

/* ============================================================================
 *  Espalhar
 * ========================================================================== */

create or replace function public.nota_propagar(p_cod text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link text; v_nome text; v_fonte text;
  v_ach int := 0; v_car int := 0; v_fac int := 0; v_acervo int := 0;
begin
  if p_cod is null or p_cod !~ '^\d+$' then
    return jsonb_build_object('ok', false, 'motivo', 'cod_titulo inválido');
  end if;

  select fonte, link, nome into v_fonte, v_link, v_nome
    from public.nota_fonte_do_titulo(p_cod);

  if v_link is null then
    return jsonb_build_object('ok', true, 'cod_titulo', p_cod, 'fonte', null, 'escreveu', 0);
  end if;

  /* SÓ ONDE ESTÁ VAZIO. É o que faz esta função ser idempotente e o que impede
     o gatilho de girar: a segunda passada não encontra nada para escrever. */
  update public.auditoria a
     set link_comprovante = v_link,
         categoria = case when coalesce(a.categoria,'') in ('', 'SEM NF') then 'COM NF' else a.categoria end,
         updated_at = now()
   where a.omie_cod_titulo = p_cod and coalesce(a.link_comprovante, '') = '';
  get diagnostics v_ach = row_count;

  update public.auditoria_cartao_lancamentos c
     set link_comprovante = v_link,
         arquivo_comprovante = coalesce(c.arquivo_comprovante, v_nome),
         status_nf = case when coalesce(c.status_nf,'') <> 'OK' then 'OK' else c.status_nf end,
         updated_at = now()
   where c.omie_cod_titulo = p_cod and coalesce(c.link_comprovante, '') = '';
  get diagnostics v_car = row_count;

  update public.facilities_compras f
     set nf_arquivo = v_link,
         nf_nome = coalesce(f.nf_nome, v_nome),
         nf_status = case when coalesce(f.nf_status,'') = '' then 'ok' else f.nf_status end
   where f.omie_cod_titulo = p_cod and coalesce(f.nf_arquivo, '') = '';
  get diagnostics v_fac = row_count;

  /* O ACERVO ENTRA NA FILA DO ERP. As notas deste título que ainda não subiram
     e não são cópia — a porta `notas_externas_enfileirar` continua sendo quem
     decide (ela exige arquivo, ser nota, e o ERP não ter). */
  select public.notas_externas_enfileirar(array_agg(n.id)) into v_acervo
    from public.notas_externas n
    left join public.auditoria_cartao_lancamentos cc
           on n.alvo_tipo = 'cartao' and cc.id_unico = n.alvo_id_unico
   where coalesce(
           case when n.alvo_tipo in ('pix', 'erp') then n.alvo_id_unico
                else cc.omie_cod_titulo end, '') = p_cod
     and n.enviado_erp_em is null and not n.fila_erp;

  return jsonb_build_object(
    'ok', true, 'cod_titulo', p_cod, 'fonte', v_fonte,
    'achado', v_ach, 'cartao', v_car, 'facilities', v_fac,
    'acervo_enfileirado', coalesce(v_acervo, 0),
    'escreveu', v_ach + v_car + v_fac
  );
end;
$$;

revoke all on function public.nota_propagar(text) from public, anon;
grant execute on function public.nota_propagar(text) to authenticated, service_role;

/* ============================================================================
 *  Os gatilhos — "já vai para o outro" quer dizer agora
 * ==========================================================================
 * Disparam só quando a coluna do arquivo passa de VAZIA a preenchida. Como
 * `nota_propagar` escreve apenas onde está vazio, a passada seguinte não acha
 * trabalho e a cadeia morre na profundidade 2. O `pg_trigger_depth()` é o
 * cinto: se um dia alguém acrescentar uma escrita não idempotente aqui, ele
 * segura em vez de girar. */

create or replace function public.nota_propagar_gatilho()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cod text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_cod := case tg_table_name
             when 'comprovantes_drive' then new.cod_titulo::text
             else new.omie_cod_titulo::text
           end;
  if v_cod is not null and v_cod ~ '^\d+$' then
    perform public.nota_propagar(v_cod);
  end if;
  return null;
end;
$$;

drop trigger if exists auditoria_nota_propaga on public.auditoria;
create trigger auditoria_nota_propaga
  after insert or update of link_comprovante, omie_cod_titulo on public.auditoria
  for each row
  when (coalesce(new.link_comprovante, '') <> '' and new.omie_cod_titulo is not null)
  execute function public.nota_propagar_gatilho();

drop trigger if exists cartao_nota_propaga on public.auditoria_cartao_lancamentos;
create trigger cartao_nota_propaga
  after insert or update of link_comprovante, omie_cod_titulo on public.auditoria_cartao_lancamentos
  for each row
  when (coalesce(new.link_comprovante, '') <> '' and new.omie_cod_titulo is not null)
  execute function public.nota_propagar_gatilho();

drop trigger if exists facilities_nota_propaga on public.facilities_compras;
create trigger facilities_nota_propaga
  after insert or update of nf_arquivo, omie_cod_titulo on public.facilities_compras
  for each row
  when (coalesce(new.nf_arquivo, '') <> '' and new.omie_cod_titulo is not null)
  execute function public.nota_propagar_gatilho();

drop trigger if exists drive_nota_propaga on public.comprovantes_drive;
create trigger drive_nota_propaga
  after insert or update of cod_titulo on public.comprovantes_drive
  for each row
  when (new.cod_titulo is not null)
  execute function public.nota_propagar_gatilho();

/* ============================================================================
 *  A varredura do atraso
 * ==========================================================================
 * Os gatilhos pegam o que acontecer daqui para a frente. Os 80 títulos que já
 * estavam com nota num lugar e sem nota no ERP precisam de alguém que passe uma
 * vez — e, depois, de alguém que continue passando: `notas_externas` recebe
 * alvo pelo casador, que é escrita em massa e não dispara gatilho de linha. */

create or replace function public.nota_propagar_tudo(p_limite integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; v_tocados int := 0; v_escritas int := 0; v_fila int := 0; v jsonb;
begin
  for r in
    select distinct cod from (
      select omie_cod_titulo::text cod from public.auditoria
       where omie_cod_titulo is not null and coalesce(link_comprovante,'') <> ''
      union
      select omie_cod_titulo::text from public.auditoria_cartao_lancamentos
       where omie_cod_titulo is not null and coalesce(link_comprovante,'') <> ''
      union
      select omie_cod_titulo::text from public.facilities_compras
       where omie_cod_titulo is not null and coalesce(nf_arquivo,'') <> ''
      union
      select cod_titulo::text from public.comprovantes_drive where cod_titulo is not null
      union
      select case when n.alvo_tipo in ('pix','erp') then n.alvo_id_unico else cc.omie_cod_titulo::text end
        from public.notas_externas n
        left join public.auditoria_cartao_lancamentos cc
               on n.alvo_tipo = 'cartao' and cc.id_unico = n.alvo_id_unico
       where n.alvo_tipo is not null and n.tem_arquivo and n.parece_nota and n.copia_de is null
    ) t where cod ~ '^\d+$'
    limit greatest(1, least(coalesce(p_limite, 200), 2000))
  loop
    v := public.nota_propagar(r.cod);
    v_tocados := v_tocados + 1;
    v_escritas := v_escritas + coalesce((v->>'escreveu')::int, 0);
    v_fila := v_fila + coalesce((v->>'acervo_enfileirado')::int, 0);
  end loop;

  return jsonb_build_object(
    'titulos_olhados', v_tocados,
    'linhas_preenchidas', v_escritas,
    'acervo_enfileirado', v_fila
  );
end;
$$;

revoke all on function public.nota_propagar_tudo(integer) from public, anon;
grant execute on function public.nota_propagar_tudo(integer) to authenticated, service_role;
