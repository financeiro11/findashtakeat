-- A IA chamou de "títulos" o que era "notas" — e o número não era dela.
--
-- Primeiro texto gerado depois que a cotação do lote entrou no sinal
-- (`20260827310000`):
--
--   "O lote de câmbio explicou 7 títulos, facilitando a conferência dessas notas."
--
-- Sete é `notas_casadas`, e são sete NOTAS em SEIS títulos — um deles fechou com
-- duas invoices somadas, que é justamente o caso interessante. A IA não inventou
-- nada: ela pegou o único número disponível e leu o rótulo do jeito errado. É a
-- falha esperada quando o sinal oferece um número que não é o que a frase pede.
--
-- O conserto é do lado do sinal, não do prompt: `titulos_explicados` passa a
-- existir, contado com `count(distinct alvo_id_unico)`. Instruir o modelo a
-- "dividir com cuidado" seria pedir a ele exatamente a coisa que o repo decidiu
-- não pedir — a conta é do Postgres, a redação é dele.
--
-- Abaixo, a `cap_notas_diagnostico` inteira, com uma chave a mais no sinal.

CREATE OR REPLACE FUNCTION public.cap_notas_diagnostico(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb;
begin
  with t as materialized (
    select c.cod_titulo, c.favorecido, c.favorecido_cru, c.valor, c.categoria,
           c.situacao, c.competencia, c.doc
      from public.cap_titulos c
     where (p_de is null or c.competencia >= p_de)
       and (p_ate is null or c.competencia <= p_ate)
  ),
  /* O que o acervo tem apontado para cada título, e em que estado. */
  acervo as (
    select nullif(regexp_replace(n.alvo_id_unico, '\D', '', 'g'), '')::bigint as cod_titulo,
           bool_or(n.tem_arquivo and n.conferencia in ('falta_anexar', 'promessa_falsa')) as pronta,
           bool_or(not n.tem_arquivo) as so_registro,
           count(*) as quantas
      from public.notas_externas n
     where n.alvo_tipo in ('pix', 'erp')
       and n.alvo_id_unico ~ '^\d+$'
       and n.ignorado_em is null
       and n.copia_de is null
     group by 1
  ),
  /* Candidatas que reivindicam o título mas empataram — o clique resolve. */
  ambiguas as (
    select nullif(regexp_replace(a.x->>'id_unico', '\D', '', 'g'), '')::bigint as cod_titulo,
           count(*) as quantas
      from public.notas_externas n
      cross join lateral jsonb_array_elements(n.candidatos->'alvos') a(x)
     where n.candidatos is not null
       and n.ignorado_em is null
       and n.tem_arquivo
       and a.x->>'tipo' in ('pix', 'erp')
     group by 1
  ),
  /* Já apareceu ALGUMA coisa desse fornecedor, em qualquer fonte? É o que
     separa "some com a nota" de "nunca mandou nada". */
  conhecido as (
    select distinct nullif(regexp_replace(n.cnpj, '\D', '', 'g'), '') as doc
      from public.notas_externas n
     where n.cnpj is not null and n.tem_arquivo and n.ignorado_em is null
  ),
  classificado as (
    select t.*,
           coalesce(ac.pronta, false) as tem_pronta,
           coalesce(ac.so_registro, false) as tem_so_registro,
           coalesce(am.quantas, 0) as candidatas,
           (bl.id is not null) as fonte_bloqueada,
           bl.motivo as bloqueio_motivo,
           bl.acao as bloqueio_acao,
           (k.doc is not null) as fornecedor_conhecido,
           case
             when t.situacao in ('dispensa', 'com_nota', 'enviado_aguardando') then 'nao_exige'
             when public.aceita_recibo_do_app(coalesce(t.favorecido, t.favorecido_cru)) then 'fornecedor_nao_emite'
             when coalesce(ac.pronta, false) then 'pronta_para_subir'
             when coalesce(am.quantas, 0) > 0 then 'espera_um_clique'
             when bl.id is not null then 'achou_mas_nao_abre'
             when coalesce(ac.so_registro, false) then 'achou_mas_nao_abre'
             else 'nunca_apareceu'
           end as estagio
      from t
      left join acervo ac on ac.cod_titulo = t.cod_titulo
      left join ambiguas am on am.cod_titulo = t.cod_titulo
      left join conhecido k on k.doc = nullif(regexp_replace(t.doc, '\D', '', 'g'), '')
      left join lateral (
        select b.id, b.motivo, b.acao
          from public.nota_fonte_bloqueada b
         where b.resolvido_em is null
           and public.normaliza_nome(coalesce(t.favorecido, t.favorecido_cru, ''))
                 like '%' || public.normaliza_nome(b.padrao_nome) || '%'
         limit 1
      ) bl on true
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'gerado_em', now(),
    'total', jsonb_build_object(
      'titulos', (select count(*) from classificado),
      'valor', (select coalesce(round(sum(valor)), 0) from classificado)),
    'estagios', (
      select coalesce(jsonb_agg(x order by x->>'valor' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'estagio', estagio,
                 'titulos', count(*),
                 'valor', round(sum(valor)),
                 /* Os cinco maiores de cada estágio: é o que a IA cita e o que
                    a pessoa reconhece. Nome, não código. */
                 'maiores', (
                   select jsonb_agg(jsonb_build_object(
                            'favorecido', f.favorecido, 'titulos', f.n, 'valor', round(f.v)))
                     from (select coalesce(c2.favorecido, '(sem nome)') as favorecido,
                                  count(*) n, sum(c2.valor) v
                             from classificado c2
                            where c2.estagio = c.estagio
                            group by 1 order by sum(c2.valor) desc limit 5) f)
               ) as x
          from classificado c
         where estagio <> 'nao_exige'
         group by estagio
      ) g),
    'bloqueios', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fornecedor', b.padrao_nome, 'motivo', b.motivo, 'acao', b.acao,
               'titulos', coalesce(q.n, 0), 'valor', coalesce(round(q.v), 0))), '[]'::jsonb)
        from public.nota_fonte_bloqueada b
        left join lateral (
          select count(*) n, sum(c.valor) v from classificado c
           where c.estagio = 'achou_mas_nao_abre'
             and public.normaliza_nome(coalesce(c.favorecido, c.favorecido_cru, ''))
                   like '%' || public.normaliza_nome(b.padrao_nome) || '%'
        ) q on true
       where b.resolvido_em is null),
    /* O acervo tem arquivo que NÃO achou dono. É o outro lado do problema:
       nota sobrando enquanto título falta. */
    'acervo_sem_dono', (
      select jsonb_build_object(
        'notas', count(*), 'com_valor', count(*) filter (where valor is not null))
        from public.notas_externas
       where tem_arquivo and parece_nota and alvo_tipo is null
         and ignorado_em is null and copia_de is null),
    'leitura', (
      select jsonb_build_object(
        'sem_valor_com_arquivo', count(*) filter (where tem_arquivo and valor is null),
        'pdf_sem_texto', count(*) filter (where leitura_erro like 'PDF sem texto%'),
        'em_moeda_estrangeira', count(*) filter (where valor_moeda is not null))
        from public.notas_externas where ignorado_em is null and copia_de is null),
    /* A COTAÇÃO QUE A FATURA DE CARTÃO REVELOU.
       Isto aqui é o que a IA precisa para responder "por que este título ainda
       não fechou" com uma conta em vez de um adjetivo: quantos títulos
       corroboram a cotação, quão apertado ficou o espalhamento, e quantos
       casaram por SOMA de duas invoices. Ver 20260827280000. */
    'cambio_lote', jsonb_build_object(
      'lotes', (select coalesce(jsonb_agg(jsonb_build_object(
                         'fornecedor', quem, 'data', data, 'moeda', moeda,
                         'taxa', round(taxa, 4),
                         'titulos_corroborando', titulos,
                         'espalhamento_pct', round(espalhamento * 100, 3))
                       order by titulos desc), '[]'::jsonb)
                  from public.nota_taxa_do_lote),
      /* TÍTULO e NOTA são coisas diferentes, e a IA leu `notas_casadas`
         como se fossem títulos: escreveu "explicou 7 títulos" quando eram
         7 notas em 6 títulos (um deles fechou com DUAS invoices somadas).
         O número que ela quer citar é este, e agora ele tem nome. */
      'titulos_explicados', (select count(distinct alvo_id_unico) from public.notas_externas
                              where casamento in ('cambio_lote', 'cambio_lote_soma')),
      'notas_casadas', (select count(*) from public.notas_externas
                         where casamento in ('cambio_lote', 'cambio_lote_soma')),
      'por_soma_de_duas', (select count(*) from public.notas_externas
                            where casamento = 'cambio_lote_soma'))
  ) into v;

  return v;
end;
$function$
;
