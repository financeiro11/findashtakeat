-- O recibo de quem não emite nota passa a contar como coberto.
--
-- Segunda metade de `20260827380000`. Lá nasceu `comprovante_aceito` — o título
-- cujo fornecedor não emite NF e cujo recibo É o documento. Aqui ele entra na
-- CONTA: sem isto o estado existiria na tela e a cobertura continuaria dizendo
-- que aqueles títulos estão descobertos, o que é a mesma mentira de antes com
-- outro nome.
--
-- Decisão do usuário em 27/08/2026, entre três alternativas: *"depende do
-- fornecedor"*. A cobertura passa a significar **"tem o documento que dá para
-- ter"** — e não "tem um papel qualquer" nem "tem NF-e e mais nada".
--
-- `so_comprovante` continua FORA do coberto, e de propósito: ali o fornecedor
-- emite nota e ela ainda falta. Ele sai do vermelho na tela (o gasto está
-- provado) e continua no `valor_faltante` das categorias, que é o número que
-- ordena a cobrança.
--
-- A troca é mecânica e vale para todos os recortes — o total, o mês a mês, a
-- conta e a categoria. Um recorte que ficasse para trás faria a soma das partes
-- não bater com o cabeçalho, e é assim que um painel perde o crédito.

CREATE OR REPLACE FUNCTION public.cap_notas_resumo(p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with base as (
  select * from public.cap_titulos where competencia between p_de and p_ate
),
exigivel as (select * from base where situacao not in ('dispensa', 'conferir')),
falta as (select * from exigivel
           where situacao in ('sem_nota', 'pronta_para_enviar', 'anexo_suspeito', 'enviado_aguardando')),
-- O cartÃ£o anda por outro caminho: quem cobra Ã© a auditoria do cartÃ£o, do
-- responsÃ¡vel pelo gasto, e nÃ£o um e-mail para um CNPJ.
falta_cartao as (select * from falta where public.eh_cartao(favorecido_cru)),
falta_fornecedor as (select * from falta where not public.eh_cartao(favorecido_cru))
select jsonb_build_object(
  'meta', jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'limiares', (select jsonb_build_object('medio', limiar_medio, 'grave', limiar_grave, 'urgente', limiar_urgente)
                 from public.cap_notas_config where id = 1),
    'titulos', (select count(*) from base),
    'valor', (select coalesce(round(sum(valor)::numeric, 2), 0) from base),
    'exigivel_titulos', (select count(*) from exigivel),
    'exigivel_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel),
    'cobertura_valor', (
      select case when coalesce(sum(valor), 0) = 0 then null
             else round(100 * sum(valor) filter (where situacao in ('com_nota', 'comprovante_aceito')) / sum(valor), 1) end
      from exigivel),
    'cobertura_titulos', (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where situacao in ('com_nota', 'comprovante_aceito')) / count(*), 1) end
      from exigivel),
    'nao_verificado_valor', (
      select coalesce(round(sum(valor)::numeric, 2), 0) from exigivel where situacao = 'nao_verificado'),
    'a_revisar', (select count(*) from exigivel where situacao = 'anexo_suspeito'),
    -- Quanto do que falta Ã© cartÃ£o: nÃ£o some da conta, sÃ³ sai da lista de CNPJs.
    'cartao_titulos', (select count(*) from falta_cartao),
    'cartao_valor',   (select coalesce(round(sum(valor)::numeric, 2), 0) from falta_cartao),
    'atualizado_em', (select max(lido_em) from public.omie_titulo_anexo)
  ),
  'gravidade', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'gravidade', gravidade, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by ordem), '[]'::jsonb)
    from (
      select gravidade, count(*) n, sum(valor) v,
             case gravidade when 'urgente' then 1 when 'grave' then 2 when 'medio' then 3 else 4 end as ordem
      from falta group by gravidade
    ) t
  ),
  'situacoes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'situacao', situacao, 'titulos', n, 'valor', round(v::numeric, 2)
    ) order by v desc), '[]'::jsonb)
    from (select situacao, count(*) n, sum(valor) v from base group by 1) s
  ),
  'meses', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'sem_nota', semn, 'valor_sem_nota', round(vsem::numeric, 2),
      'pronta', pronta, 'nao_verificado', nver
    ) order by mes), '[]'::jsonb)
    from (
      select to_char(date_trunc('month', competencia), 'YYYY-MM') as mes,
             count(*) n, sum(valor) v,
             count(*) filter (where situacao in ('com_nota', 'comprovante_aceito')) ok,
             coalesce(sum(valor) filter (where situacao in ('com_nota', 'comprovante_aceito')), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             coalesce(sum(valor) filter (where situacao in ('sem_nota', 'anexo_suspeito')), 0) vsem,
             count(*) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')) pronta,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  'contas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'conta', conta, 'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'valor_com_nota', round(vok::numeric, 2),
      'nao_verificado', nver,
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by v desc), '[]'::jsonb)
    from (
      select conta, count(*) n, sum(valor) v,
             count(*) filter (where situacao in ('com_nota', 'comprovante_aceito')) ok,
             coalesce(sum(valor) filter (where situacao in ('com_nota', 'comprovante_aceito')), 0) vok,
             count(*) filter (where situacao = 'nao_verificado') nver
      from exigivel group by 1
    ) t
  ),
  'categorias', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoria', categoria, 'codigo', categoria_codigo,
      'titulos', n, 'valor', round(v::numeric, 2),
      'com_nota', ok, 'sem_nota', semn, 'pronta', pronta, 'nao_verificado', nver,
      'urgentes', urg,
      'valor_faltante', round(vfalta::numeric, 2),
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end
    ) order by vfalta desc, v desc), '[]'::jsonb)
    from (
      select categoria, categoria_codigo, count(*) n, sum(valor) v,
             count(*) filter (where situacao in ('com_nota', 'comprovante_aceito')) ok,
             coalesce(sum(valor) filter (where situacao in ('com_nota', 'comprovante_aceito')), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             count(*) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')) pronta,
             count(*) filter (where situacao = 'nao_verificado') nver,
             count(*) filter (where situacao not in ('com_nota', 'comprovante_aceito') and gravidade = 'urgente') urg,
             coalesce(sum(valor) filter (where situacao not in ('com_nota', 'comprovante_aceito')), 0) vfalta
      from exigivel group by 1, 2
    ) t
  ),
  'fornecedores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'favorecido', favorecido, 'doc', doc, 'titulos', n,
      'urgentes', urg, 'valor_faltante', round(vfalta::numeric, 2)
    ) order by vfalta desc), '[]'::jsonb)
    from (
      select favorecido, nullif(doc, '') as doc, count(*) n, sum(valor) vfalta,
             count(*) filter (where gravidade = 'urgente') urg
      -- Quem se cobra por e-mail: sÃ³ o que depende do fornecedor. O que jÃ¡
      -- subiu, ou estÃ¡ pronto para subir, Ã© trabalho nosso e nÃ£o entra.
      from falta_fornecedor
      where situacao in ('sem_nota', 'anexo_suspeito')
      group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;
