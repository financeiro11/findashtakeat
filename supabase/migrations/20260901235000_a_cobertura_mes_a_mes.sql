-- O mês a mês passa a responder "estamos melhorando?" — e não só "quanto tem".
--
-- Pedido do usuário em 01/09/2026: *"Esse número geral de tudo que tem no Omie é
-- bacana, mas eu preciso de uma visão mês a mês, até para ver se estamos
-- evoluindo no controle da documentação."*
--
-- O bloco `meses` já existia e trazia DOIS valores: `valor_com_nota` e
-- `valor_sem_nota`. A tela desenhava a barra com eles e jogava TODO o resto num
-- pedaço roxo rotulado "não verificado" — o que é falso desde 27/08: em ago/26
-- há R$ 55 mil de "só comprovante" e R$ 3,3 mil de "o Hub leva sozinho" pintados
-- de "ninguém perguntou ao ERP", quando o ERP foi perguntado e respondeu. A barra
-- do topo tem seis fatias; a do mês tinha duas e uma mentira.
--
-- E faltava o número que a pergunta pede: a COBERTURA do mês. Ela existia só no
-- agregado do período — ler a evolução exigia medir a largura das barras a olho.
--
-- ---------------------------------------------------------------------------
-- O QUE ENTRA, e por que nenhuma chave velha muda de sentido
--
-- As chaves antigas (`com_nota`, `valor_com_nota`, `sem_nota`, `valor_sem_nota`,
-- `pronta`, `nao_verificado`) continuam com a MESMA conta de antes. Trocar o
-- significado de uma delas faria a tela nova bater e qualquer leitura antiga do
-- JSON passar a mentir sem erro — o defeito mais caro deste módulo.
--
-- As novas são as fatias que faltavam, valor e contagem lado a lado, e fecham a
-- soma exatamente:
--
--   valor_com_nota  (com_nota + comprovante_aceito)   ← verde, o COBERTO
--   valor_pronta    (pronta_para_enviar + enviado_aguardando)
--   valor_espera    (espera_confirmacao)
--   valor_comprovante (so_comprovante)
--   valor_sem_nota  (sem_nota + anexo_suspeito) + valor_erro (erro_leitura)
--   valor_nao_verificado (nao_verificado)
--   ------------------------------------------------------------------
--   = valor    (as dez situações exigíveis, cada uma contada uma vez só)
--
-- ---------------------------------------------------------------------------
-- DUAS COBERTURAS, porque as duas são verdade e dizem coisas diferentes
--
-- Medido hoje, em ago/26: **59,4% em valor** e **34,6% em títulos**. Não é
-- contradição — é o retrato de onde está o controle: os títulos grandes têm
-- nota, os pequenos não. Um painel que mostrasse só o valor diria que o mês está
-- razoável enquanto dois terços dos documentos faltam; um que mostrasse só a
-- contagem diria que quase nada está resolvido enquanto o dinheiro está coberto.
-- `cobertura` (valor) é a que manda, porque é a do cabeçalho; `cobertura_titulos`
-- vai junto para a tela poder alternar sem uma segunda ida ao banco.
--
-- `valor_faltante` é `valor - valor_com_nota` — a mesma régua do bloco
-- `categorias`, para que a soma das partes bata com o total do período.

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
-- O cartão anda por outro caminho: quem cobra é a auditoria do cartão, do
-- responsável pelo gasto, e não um e-mail para um CNPJ.
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
    -- Quanto do que falta é cartão: não some da conta, só sai da lista de CNPJs.
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
      'pronta', pronta, 'nao_verificado', nver,
      -- as fatias que faltavam para a barra do mês ser a barra do topo
      'valor_pronta', round(vpronta::numeric, 2),
      'espera', espera, 'valor_espera', round(vespera::numeric, 2),
      'comprovante', comprov, 'valor_comprovante', round(vcomprov::numeric, 2),
      'erro', erro, 'valor_erro', round(verro::numeric, 2),
      'valor_nao_verificado', round(vnver::numeric, 2),
      -- e os dois números que respondem "estamos melhorando?"
      'valor_faltante', round((v - vok)::numeric, 2),
      'cobertura', case when v = 0 then null else round(100 * vok / v, 1) end,
      'cobertura_titulos', case when n = 0 then null else round(100.0 * ok / n, 1) end
    ) order by mes), '[]'::jsonb)
    from (
      select to_char(date_trunc('month', competencia), 'YYYY-MM') as mes,
             count(*) n, sum(valor) v,
             count(*) filter (where situacao in ('com_nota', 'comprovante_aceito')) ok,
             coalesce(sum(valor) filter (where situacao in ('com_nota', 'comprovante_aceito')), 0) vok,
             count(*) filter (where situacao in ('sem_nota', 'anexo_suspeito')) semn,
             coalesce(sum(valor) filter (where situacao in ('sem_nota', 'anexo_suspeito')), 0) vsem,
             count(*) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')) pronta,
             coalesce(sum(valor) filter (where situacao in ('pronta_para_enviar', 'enviado_aguardando')), 0) vpronta,
             count(*) filter (where situacao = 'espera_confirmacao') espera,
             coalesce(sum(valor) filter (where situacao = 'espera_confirmacao'), 0) vespera,
             count(*) filter (where situacao = 'so_comprovante') comprov,
             coalesce(sum(valor) filter (where situacao = 'so_comprovante'), 0) vcomprov,
             count(*) filter (where situacao = 'erro_leitura') erro,
             coalesce(sum(valor) filter (where situacao = 'erro_leitura'), 0) verro,
             count(*) filter (where situacao = 'nao_verificado') nver,
             coalesce(sum(valor) filter (where situacao = 'nao_verificado'), 0) vnver
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
      -- Quem se cobra por e-mail: só o que depende do fornecedor. O que já
      -- subiu, ou está pronto para subir, é trabalho nosso e não entra.
      from falta_fornecedor
      where situacao in ('sem_nota', 'anexo_suspeito')
      group by 1, 2 order by sum(valor) desc limit 25
    ) t
  )
);
$function$;

comment on function public.cap_notas_resumo(date, date) is
  'O painel de /governanca/notas-erp num JSON só. Desde 01/09/2026 o bloco `meses` traz as SEIS fatias da barra (valor e contagem) e as duas coberturas do mês — em valor e em títulos —, para que a evolução se leia como número e não pela largura da barra. As chaves antigas mantêm a conta que sempre tiveram.';

revoke all on function public.cap_notas_resumo(date, date) from anon, public;
grant execute on function public.cap_notas_resumo(date, date) to authenticated, service_role;
