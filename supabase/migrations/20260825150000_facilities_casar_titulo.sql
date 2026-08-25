-- Casar a compra de Facilities com o título do contas a pagar do Omie.
--
-- É o elo que faltava: a compra tem a NF anexada e o título existe no ERP, mas
-- nada ligava um ao outro, e a fila de envio é conjuntiva (nota + título + sem
-- carimbo). Sem o vínculo, a nota fica no Hub para sempre — que é exatamente o
-- estado em que as 41 compras estavam.
--
-- A REGRA É DURA DE PROPÓSITO, e a razão é a mesma do casamento de comprovantes
-- do Drive: falso positivo aqui é pior que casamento nenhum. Anexar a nota da
-- compra A no título da compra B marca as DUAS como resolvidas e põe um
-- documento errado dentro do ERP — que é o oposto do que este trabalho todo
-- existe para conseguir.
--
--   valor exato (±1 centavo)                     filtro duro, sempre
--   data do título entre -7 e +45 dias da compra a compra é registrada no dia; o
--                                                boleto/PIX cai depois
--   CNPJ da nota bate com o do título            → confiança 'exata'
--   nome do fornecedor reconhecível (> 0,45)     → confiança 'alta'
--   mais de um candidato empatado no topo        → NÃO casa
--
-- Mesma janela e mesma lógica de empate que `facilities-nf-auditoria` já usa
-- para casar a NF com o lançamento auditado.

create or replace function public.facilities_casar_titulo(
  p_compra_id uuid default null,
  p_limite integer default 200
)
returns table(
  compra_id uuid, item text, valor numeric, data date,
  cod_titulo bigint, favorecido text, confianca text, candidatos integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select c.id, c.item, c.fornecedor_nome, c.valor, c.data,
           regexp_replace(coalesce(c.nf_cnpj, ''), '\D', '', 'g') as doc
    from public.facilities_compras c
    where c.omie_cod_titulo is null
      and c.valor is not null and c.valor > 0
      and c.data is not null
      and (p_compra_id is null or c.id = p_compra_id)
    order by c.data desc
    limit greatest(coalesce(p_limite, 200), 1)
  loop
    return query
    with cand as (
      select t.cod_titulo, t.favorecido, t.doc as titulo_doc, t.valor as titulo_valor,
             -- CNPJ é prova; nome é indício.
             (r.doc <> '' and t.doc = r.doc) as documento_bate,
             similarity(
               lower(unaccent(coalesce(r.fornecedor_nome, ''))),
               lower(unaccent(coalesce(t.favorecido, '')))
             ) as nome_score
      from public.cap_titulos t
      where abs(t.valor - r.valor) <= 0.01
        and t.competencia between r.data - 7 and r.data + 45
        -- Título que já tem anexo não precisa da nossa nota; deixá-lo fora do
        -- casamento evita gastar a nota da compra num título já resolvido.
        and coalesce(t.anexos_no_erp, 0) = 0
    ),
    pontuada as (
      select *,
             case when documento_bate then 'exata'
                  when nome_score > 0.45 then 'alta'
                  else 'baixa' end as confianca,
             case when documento_bate then 2 when nome_score > 0.45 then 1 else 0 end as forca
      from cand
    ),
    topo as (
      select * from pontuada where forca > 0 order by forca desc, nome_score desc
    )
    select r.id, r.item, r.valor, r.data,
           t.cod_titulo, t.favorecido, t.confianca,
           (select count(*)::integer from topo)
    from topo t
    -- Um só candidato na melhor força: empate não casa.
    where (select count(*) from topo t2 where t2.forca = t.forca) = 1
    order by t.forca desc, t.nome_score desc
    limit 1;
  end loop;
end;
$function$;

comment on function public.facilities_casar_titulo(uuid, integer) is
  'Propõe o título do Omie de cada compra de Facilities por valor exato + janela de data + CNPJ/nome. Só LÊ: quem grava é facilities_aplicar_titulo.';

/* A aplicação é separada da proposta — mesma separação que a Parametrização usa
 * entre "sugestão" e "aplicado". Ver a proposta antes de gravar é o que permite
 * confiar no automático depois. */
create or replace function public.facilities_aplicar_titulo(
  p_compra_id uuid default null,
  p_limite integer default 200,
  p_so_exata boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := 0;
begin
  update public.facilities_compras c
     set omie_cod_titulo      = p.cod_titulo::text,
         omie_match_confianca = p.confianca,
         omie_matched_em      = now()
  from public.facilities_casar_titulo(p_compra_id, p_limite) p
  where c.id = p.compra_id
    and c.omie_cod_titulo is null
    and (not coalesce(p_so_exata, false) or p.confianca = 'exata');
  get diagnostics n = row_count;
  return n;
end;
$function$;

comment on function public.facilities_aplicar_titulo(uuid, integer, boolean) is
  'Grava o vínculo compra→título proposto por facilities_casar_titulo. p_so_exata=true aplica só o que casou por CNPJ.';

revoke all on function public.facilities_casar_titulo(uuid, integer) from anon;
revoke all on function public.facilities_aplicar_titulo(uuid, integer, boolean) from anon;
grant execute on function public.facilities_casar_titulo(uuid, integer) to authenticated;
grant execute on function public.facilities_aplicar_titulo(uuid, integer, boolean) to authenticated;
