-- A Caixa de notas: o que está nela, e em que pé.
--
-- Pedido de 27/08/2026: *"cria um espaço onde eu posso jogar notas avulsas. Aí
-- você mesmo lê a nota, faz o link com o lançamento que existe, coloca a nota e
-- sobe no Omie"*.
--
-- A esteira toda já existia — ler (`nota-ler-arquivo`), casar
-- (`notas_externas_casar`), anexar no ERP (`omie-anexar-comprovante`). Faltava a
-- porta (`nota-caixa`, Edge) e faltava a TELA saber o que aconteceu com cada
-- arquivo depois que ele entrou. Esta RPC é a segunda parte.
--
-- ---------------------------------------------------------------------------
-- O ESTADO É DEDUZIDO, e não guardado numa coluna
--
-- Uma coluna `status` seria uma quinta verdade sobre a mesma nota, ao lado de
-- `alvo_id_unico`, `confianca`, `fila_erp` e `enviado_erp_em` — e a primeira vez
-- que alguém esquecesse de atualizá-la, a Caixa mostraria "subiu" para uma nota
-- parada. Aqui o estado sai dessas quatro colunas, na ordem em que a esteira
-- anda:
--
--   `lendo`        entrou e a leitura ainda não passou
--   `nao_deu`      a leitura passou e não conseguiu (ilegível, formato, cota)
--   `sem_dono`     leu, e nenhuma regra achou lançamento — é aqui que entra gente
--   `esperando`    achou por evidência média; um clique manda
--   `subindo`      casou com identidade e está na fila do Omie
--   `no_omie`      o Omie confirmou o anexo
--
-- ---------------------------------------------------------------------------
-- O QUE ENTROU POR E-MAIL TAMBÉM APARECE
--
-- Decisão do usuário na mesma conversa: encaminhar a mensagem do fornecedor para
-- `financeiro@` é um dos caminhos de entrada, e a `gmail-nf-sync` já pega o
-- anexo de hora em hora. Sem mostrar isso aqui, quem encaminha fica sem saber se
-- funcionou — e a resposta some no meio de 1.618 linhas do acervo.
--
-- O recorte é por TEMPO (`visto_em` nos últimos N dias) e não por estado: a
-- pergunta de quem encaminhou é "chegou?", e ela vale igual para a que já subiu.

create or replace function public.caixa_notas_lista(
  p_dias   int default 7,
  p_limite int default 120
)
returns table (
  id            bigint,
  fonte         text,
  arquivo       text,
  detalhe       text,
  visto_em      timestamptz,
  tem_arquivo   boolean,
  lido_em       timestamptz,
  leitura_erro  text,
  nome          text,
  cnpj          text,
  valor         numeric,
  documento     text,
  data_doc      date,
  tipo_documento text,
  casamento     text,
  confianca     text,
  alvo_tipo     text,
  alvo_id_unico text,
  alvo_favorecido text,
  alvo_valor    numeric,
  alvo_data     date,
  enviado_erp_em timestamptz,
  erro_erp      text,
  estado        text
)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  with base as (
    select n.*
      from public.notas_externas n
     where n.ignorado_em is null
       and n.copia_de is null
       and (
             n.fonte = 'caixa'
          or (n.fonte = 'email' and n.visto_em >= now() - make_interval(days => greatest(1, p_dias)))
       )
     order by n.visto_em desc nulls last
     limit greatest(1, least(coalesce(p_limite, 120), 400))
  ),
  /* O LANÇAMENTO, quando já há um. `cap_titulos` é caro; o `left join lateral`
     com o id na mão pega uma linha por índice, não varre a view. */
  com_alvo as (
    select b.*, t.favorecido as alvo_favorecido, t.valor as alvo_valor,
           coalesce(t.pagamento, t.vencimento, t.emissao) as alvo_data
      from base b
      left join lateral (
        select c.favorecido, c.valor, c.pagamento, c.vencimento, c.emissao
          from public.cap_titulos c
         where b.alvo_id_unico ~ '^\d+$'
           and c.cod_titulo = nullif(regexp_replace(b.alvo_id_unico, '\D', '', 'g'), '')::bigint
         limit 1
      ) t on true
  )
  select c.id, c.fonte, coalesce(c.o_que_e, c.detalhe, '(sem nome)'), c.detalhe,
         c.visto_em, c.tem_arquivo, c.lido_do_arquivo_em, c.leitura_erro,
         c.nome, c.cnpj, c.valor, c.documento,
         coalesce(c.vencimento, c.enviado_em) as data_doc,
         c.tipo_documento, c.casamento, c.confianca,
         c.alvo_tipo, c.alvo_id_unico, c.alvo_favorecido, c.alvo_valor, c.alvo_data,
         c.enviado_erp_em, c.erro_erp,
         case
           when c.enviado_erp_em is not null then 'no_omie'
           when c.alvo_id_unico is not null and c.fila_erp then 'subindo'
           when c.alvo_id_unico is not null then 'esperando'
           when c.lido_do_arquivo_em is null and c.valor is null then 'lendo'
           when c.valor is null then 'nao_deu'
           else 'sem_dono'
         end as estado
    from com_alvo c
   order by c.visto_em desc nulls last
$$;

comment on function public.caixa_notas_lista(int, int) is
  'O que está na Caixa de notas e em que pé: o que a leitura tirou do papel, o lançamento que o casador achou e se já subiu ao Omie. O estado é DEDUZIDO das colunas da esteira — uma coluna `status` seria uma quinta verdade sobre a mesma nota. Mostra também o que entrou por e-mail nos últimos dias, porque encaminhar para financeiro@ é um dos caminhos de entrada. Ver 20260827360000.';

revoke all on function public.caixa_notas_lista(int, int) from public, anon;
grant execute on function public.caixa_notas_lista(int, int) to authenticated, service_role;

/* ============================================================================
 *  Apontar o lançamento na mão
 * ==========================================================================
 * `notas_externas_definir_alvo` já existe e faz a parte difícil (marca
 * `alvo_manual`, que é o que impede o casador de reencaixar a nota noutro título
 * na rodada seguinte). O que faltava era a porta: quem aponta na Caixa quer que
 * a nota SUBA, não que espere a próxima varredura decidir se ela está pronta. */

create or replace function public.caixa_nota_apontar(
  p_id         bigint,
  p_cod_titulo bigint
)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_pix  boolean;
  v_tipo text;
  v_tem  boolean;
begin
  select exists (select 1 from public.auditoria_pix_lancamentos p
                  where p.id_unico = p_cod_titulo::text) into v_pix;
  /* A MESMA PARTIÇÃO DO CASADOR: título que também vive na auditoria de PIX é
     alvo 'pix'; o resto é 'erp'. Errar isto aponta a nota para um alvo que a
     varredura de envio não sabe traduzir, e ela fica na fila para sempre. */
  v_tipo := case when v_pix then 'pix' else 'erp' end;

  select tem_arquivo into v_tem from public.notas_externas where id = p_id;
  if v_tem is null then
    return jsonb_build_object('ok', false, 'erro', 'nota não encontrada');
  end if;
  if not v_tem then
    return jsonb_build_object('ok', false, 'erro', 'esta linha não tem arquivo para anexar');
  end if;

  perform public.notas_externas_definir_alvo(p_id, v_tipo, p_cod_titulo::text);
  perform public.notas_externas_enfileirar(array[p_id]);

  return jsonb_build_object('ok', true, 'alvo_tipo', v_tipo, 'cod_titulo', p_cod_titulo);
end;
$$;

comment on function public.caixa_nota_apontar(bigint, bigint) is
  'Aponta uma nota da Caixa para um título e já a coloca na fila do ERP. Decide `pix` × `erp` com a mesma partição do casador — errar isso deixa a nota na fila para sempre, porque a varredura de envio não sabe traduzir o alvo. Ver 20260827360000.';

revoke all on function public.caixa_nota_apontar(bigint, bigint) from public, anon;
grant execute on function public.caixa_nota_apontar(bigint, bigint) to authenticated, service_role;
