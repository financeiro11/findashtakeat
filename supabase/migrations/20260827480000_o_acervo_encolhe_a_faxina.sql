-- O ACERVO ENCOLHE — e o que sai não é trabalho, é entulho.
--
-- Medição de 27/08/2026: 2.750 documentos com arquivo e sem título nenhum,
-- R$ 8,8 M. O recorte "Sem alvo" mostrava os 2.750 num monte só, e a ajuda dele
-- dizia, com todas as letras, *"não há o que fazer aqui até a janela abrir"*.
-- Uma fila que se declara insolúvel é uma fila que ninguém abre — e foi por isso
-- que ela chegou a 2.750 sem que ninguém percebesse que a maior parte dela nunca
-- foi trabalho.
--
-- ---------------------------------------------------------------------------
-- AS TRÊS COISAS QUE NÃO SÃO TRABALHO
--
-- 1. DECORAÇÃO DE E-MAIL (250 documentos). `logotipo`, `image001`, `image002`:
--    são as imagens da ASSINATURA de quem mandou o e-mail, tratadas como anexo
--    e — pior — carimbadas com o valor lido no corpo da mensagem. Os R$ 2,17 M
--    de fevereiro eram doze cópias do mesmo e-mail da Baptista Luz, seis delas
--    logotipos de R$ 102.000 cada. Nenhuma é marcada `parece_nota`; nenhuma
--    jamais será nota de coisa nenhuma.
--
-- 2. FORA DO ALCANCE DO ERP (734 documentos, R$ 1,0 M). `cap_titulos` sai do
--    `omie_cache` de movimentos, e o mais antigo lá é de 02/04/2026 — não existe
--    título anterior a isso para casar com nada. Não é ambiguidade nem falha do
--    casador: é ausência de alvo possível. São reembolsos e notas de evento de
--    2024 e 2025, na maior parte.
--
--    O CORTE É A JANELA MENOS 60 DIAS, e não a janela. A regra `cnpj_data` do
--    casador alcança um título até 60 dias À FRENTE da data do documento: uma
--    nota de março pode ser do título que vence em abril, e essa ainda tem
--    chance. Arquivar pela data crua mataria 470 documentos que o casador ainda
--    pode resolver. E o documento só sai se o casador JÁ TIVER OLHADO e não
--    achado nada (`conferencia = 'sem_alvo'`) — arquivar por cima de um
--    candidato encontrado seria desfazer trabalho, não fazer.
--
-- 3. CANDIDATOS JÁ RESOLVIDOS (291 documentos, R$ 1,3 M). O casador achou vários
--    títulos possíveis e TODOS já têm anexo no Omie (`devendo = 0`). Não há
--    cobrança pendente de nenhum lado: seja qual for o certo, ele já está
--    respondido. O documento não tem trabalho a fazer.
--
-- ---------------------------------------------------------------------------
-- ARQUIVAR NÃO É APAGAR
--
-- Tudo sai com `ignorado_motivo` escrito, e o motivo é um dos três acima — nunca
-- um texto solto. Isso é o que torna a faxina REVERSÍVEL: se a janela do ERP
-- abrir para 2025, `notas_externas_desarquivar_motivo('fora do alcance do ERP')`
-- devolve os 734 para a fila num comando. Um `delete` não teria volta, e um
-- motivo em texto livre não daria para desfazer em lote.

/* ---------------------------------------------------------------------------
 * 1. A JANELA DO ERP, guardada em vez de calculada
 *
 * O corte precisa ser lido por consulta de tela, e `min()` sobre `cap_titulos`
 * custa 1,4 s — a view abre o `omie_cache` inteiro para montar 5.013 títulos.
 * Pagar isso em cada leitura do acervo transformaria um filtro em espera. O
 * casador já lê `cap_titulos` de qualquer jeito, de meia em meia hora; ele
 * carimba aqui, e quem filtra lê um `select` de uma linha.
 * ------------------------------------------------------------------------- */
create table if not exists public.notas_janela_erp (
  id            smallint primary key default 1 check (id = 1),
  inicio        date,
  titulos       integer,
  atualizado_em timestamptz not null default now()
);

alter table public.notas_janela_erp enable row level security;

drop policy if exists notas_janela_erp_leitura on public.notas_janela_erp;
create policy notas_janela_erp_leitura on public.notas_janela_erp
  for select to authenticated using (true);

comment on table public.notas_janela_erp is
  'A data do título mais antigo que o cache do Omie conhece. Documento anterior a isso menos a folga do casador não tem alvo possível. Escrito por notas_externas_janela_medir().';

/** Relê a janela do `cap_titulos` e guarda. Chamada pelo casador. */
create or replace function public.notas_externas_janela_medir()
 returns date
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_inicio date; v_n integer;
begin
  select min(coalesce(pagamento, vencimento, emissao)), count(*)
    into v_inicio, v_n
    from public.cap_titulos;

  /* Cache vazio não vira janela vazia. Se o `omie_cache` falhar numa rodada,
     `min()` volta NULL — e uma janela nula faria a faxina considerar TODO
     documento "fora do alcance". Melhor manter a última medição boa. */
  if v_inicio is null then
    return (select inicio from public.notas_janela_erp where id = 1);
  end if;

  insert into public.notas_janela_erp (id, inicio, titulos, atualizado_em)
       values (1, v_inicio, v_n, now())
  on conflict (id) do update
     set inicio = excluded.inicio, titulos = excluded.titulos, atualizado_em = now();

  return v_inicio;
end;
$function$;

/** O corte da faxina: a janela menos a folga que o casador ainda alcança. */
create or replace function public.notas_externas_corte_alcance()
 returns date
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select inicio - 60 from public.notas_janela_erp where id = 1;
$function$;

select public.notas_externas_janela_medir();

/* ---------------------------------------------------------------------------
 * 2. POR QUE ESTE DOCUMENTO PAROU — uma classificação, um lugar
 *
 * A tela precisa contar por motivo, filtrar por motivo e explicar o motivo. Três
 * usos da mesma regra: escrevê-la três vezes é garantir que os números da tela
 * não somem o que a lista mostra. A view é a definição única.
 *
 * A ORDEM DOS RAMOS É A RESPOSTA. "Já está no ERP" ganha de tudo; "arquivado"
 * vem antes de qualquer diagnóstico porque um documento arquivado não está
 * parado, está resolvido por decisão; e o motivo de parada só se pergunta a quem
 * tem arquivo, não casou e ninguém arquivou.
 * ------------------------------------------------------------------------- */
create or replace view public.notas_externas_parada as
select
  n.id,
  case
    when n.enviado_erp_em is not null                     then 'no_erp'
    when n.ignorado_em is not null                        then 'arquivado'
    when n.copia_de is not null                           then 'copia'
    when not n.tem_arquivo                                then 'sem_arquivo'
    when n.alvo_tipo is not null and n.fila_erp           then 'na_fila'
    when n.alvo_tipo is not null
     and (n.confianca in ('exata', 'alta') or n.alvo_manual) then 'sobe_sozinha'
    when n.alvo_tipo is not null                          then 'espera_gente'
    /* Daqui para baixo: sem alvo. É a fila que esta migração ataca. */
    when n.candidatos->>'motivo' = 'alvo_disputado'        then 'disputado'
    when n.candidatos->>'motivo' = 'varios_alvos'
     and coalesce((n.candidatos->>'devendo')::int, 1) = 0  then 'ja_resolvido'
    when n.candidatos->>'motivo' = 'varios_alvos'          then 'varios_alvos'
    when coalesce(n.vencimento, n.enviado_em) < c.corte    then 'fora_do_alcance'
    else 'sem_candidato'
  end as motivo,
  n.ignorado_motivo
from public.notas_externas n
/* `cross join lateral` com uma função STABLE de uma linha: o planejador a
   avalia UMA vez para a consulta inteira, e não por linha. */
cross join lateral (select public.notas_externas_corte_alcance() as corte) c;

grant select on public.notas_externas_parada to authenticated;

/* ---------------------------------------------------------------------------
 * 3. A FAXINA
 *
 * Idempotente por construção: só toca em quem ainda não foi arquivado, e o
 * motivo que ela escreve é o que a impede de tocar de novo. Roda no cron do
 * casador, depois dele — o motivo de parada depende do casamento da rodada.
 * ------------------------------------------------------------------------- */
/**
 * ISTO É DECORAÇÃO DE E-MAIL?
 *
 * Função à parte porque a regra é usada em dois lugares — a faxina e a
 * simulação — e porque ela é a definição de uma decisão destrutiva. Uma regra de
 * arquivar escrita duas vezes é uma regra que diverge, e o lado que diverge
 * arquiva o que o outro mantém.
 *
 * O nome do anexo é o único sinal, e basta: `image001.png` e `logotipo.jpg` são
 * o que o Outlook e o Gmail chamam as imagens embutidas na assinatura. Nenhum
 * emissor de nota fiscal do mundo nomeia o documento assim. A guarda extra é
 * `parece_nota`: se a leitura do arquivo disser que aquilo é nota — porque tem
 * chave de acesso dentro, por exemplo — a palavra dela vence o nome.
 */
create or replace function public.notas_e_decoracao(p_o_que_e text, p_parece_nota boolean)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(p_o_que_e, '') ~* '^(image|imagem|logo(tipo|marca)?|assinatura|signature|outlook|inline)[-_ ]?[0-9]*$'
     and not coalesce(p_parece_nota, false);
$function$;

create or replace function public.notas_externas_faxina(p_simular boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_deco int := 0; v_fora int := 0; v_pronto int := 0;
  v_corte date;
begin
  v_corte := public.notas_externas_corte_alcance();

  if p_simular then
    return (
      select jsonb_build_object(
        'simulacao', true,
        'corte', v_corte,
        'decoracao_de_email', count(*) filter (where p.motivo <> 'arquivado' and public.notas_e_decoracao(n.o_que_e, n.parece_nota)),
        'fora_do_alcance',    count(*) filter (where p.motivo = 'fora_do_alcance'),
        'ja_resolvido',       count(*) filter (where p.motivo = 'ja_resolvido'))
      from public.notas_externas n
      join public.notas_externas_parada p on p.id = n.id
    );
  end if;

  /* 1. Decoração de e-mail. Vale para QUALQUER estado (menos o que já subiu):
     um logotipo que por acaso casou com um título é um casamento errado, não um
     acerto — e é justamente o que estraga o número da cobertura. */
  update public.notas_externas
     set ignorado_em = now(), ignorado_motivo = 'decoracao de e-mail',
         fila_erp = false, atualizado_em = now()
   where ignorado_em is null
     and enviado_erp_em is null
     and public.notas_e_decoracao(o_que_e, parece_nota);
  get diagnostics v_deco = row_count;

  /* 2. Fora do alcance do ERP. Só quem o casador já olhou e não achou nada. */
  update public.notas_externas n
     set ignorado_em = now(), ignorado_motivo = 'fora do alcance do ERP',
         atualizado_em = now()
    from public.notas_externas_parada p
   where p.id = n.id and p.motivo = 'fora_do_alcance';
  get diagnostics v_fora = row_count;

  /* 3. Todos os candidatos já têm nota no ERP. */
  update public.notas_externas n
     set ignorado_em = now(), ignorado_motivo = 'candidatos ja tem nota no ERP',
         atualizado_em = now()
    from public.notas_externas_parada p
   where p.id = n.id and p.motivo = 'ja_resolvido';
  get diagnostics v_pronto = row_count;

  return jsonb_build_object(
    'corte', v_corte,
    'decoracao_de_email', v_deco,
    'fora_do_alcance', v_fora,
    'ja_resolvido', v_pronto,
    'arquivados_agora', v_deco + v_fora + v_pronto,
    'ainda_parados', (select count(*) from public.notas_externas_parada
                       where motivo in ('sem_candidato','varios_alvos','disputado'))
  );
end;
$function$;

/* ---------------------------------------------------------------------------
 * 4. ARQUIVAR E DESARQUIVAR EM LOTE
 *
 * `notas_externas_ignorar` existe desde a Caixa de Notas e trata UM id. Uma tela
 * que mostra 300 linhas e resolve uma por vez não reduz fila de 2.750 — e o
 * caminho que a pessoa acabaria usando (marcar tudo e clicar 300 vezes) é o
 * mesmo trabalho com mais chance de erro.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_externas_arquivar_lote(p_ids bigint[], p_motivo text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Arquivar exige motivo: é ele que permite desfazer em lote depois.';
  end if;

  update public.notas_externas
     set ignorado_em = now(),
         ignorado_motivo = left(btrim(p_motivo), 120),
         fila_erp = false,
         atualizado_em = now()
   where id = any(p_ids)
     and ignorado_em is null
     /* O que já está no ERP não se arquiva: aquilo não é fila, é resultado. */
     and enviado_erp_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.notas_externas_desarquivar_lote(p_ids bigint[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  update public.notas_externas
     set ignorado_em = null, ignorado_motivo = null, atualizado_em = now()
   where id = any(p_ids) and ignorado_em is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

/** Desfaz uma faxina inteira pelo motivo — é para isto que o motivo é fechado. */
create or replace function public.notas_externas_desarquivar_motivo(p_motivo text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  update public.notas_externas
     set ignorado_em = null, ignorado_motivo = null, atualizado_em = now()
   where ignorado_motivo = p_motivo and ignorado_em is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

/* ---------------------------------------------------------------------------
 * 5. O QUADRO DE "POR QUE PAROU"
 *
 * Conta e SOMA. O acervo sempre contou documentos; o que decide por onde começar
 * é o dinheiro parado, e ele nunca esteve na tela — foi por isso que ninguém
 * notou que R$ 2,17 M de fevereiro eram seis logotipos.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_externas_por_que_parou()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select p.motivo, n.valor, n.ignorado_motivo
      from public.notas_externas n
      join public.notas_externas_parada p on p.id = n.id
     where n.tem_arquivo and n.copia_de is null
  )
  select jsonb_build_object(
    'motivos', (
      select coalesce(jsonb_object_agg(motivo, jsonb_build_object(
               'docs', docs, 'valor', valor)), '{}'::jsonb)
        from (select motivo, count(*) as docs, round(coalesce(sum(valor), 0)::numeric, 2) as valor
                from base group by motivo) t
    ),
    'arquivado_por', (
      select coalesce(jsonb_object_agg(ignorado_motivo, jsonb_build_object(
               'docs', docs, 'valor', valor)), '{}'::jsonb)
        from (select ignorado_motivo, count(*) as docs, round(coalesce(sum(valor), 0)::numeric, 2) as valor
                from base where motivo = 'arquivado' and ignorado_motivo is not null
               group by ignorado_motivo) t
    ),
    'janela_erp', (select to_jsonb(j) from public.notas_janela_erp j where j.id = 1)
  );
$function$;

/* ---------------------------------------------------------------------------
 * 6. OS TÍTULOS QUE ESTE DOCUMENTO PODERIA SER
 *
 * `notas_externas_definir_alvo` existe desde agosto e NUNCA teve tela — a única
 * saída para um empate era esperar o casador mudar de ideia. Escolher exige ver
 * o que se escolhe: valor, data, categoria e se aquele título ainda está devendo
 * nota. É o que esta função entrega.
 * ------------------------------------------------------------------------- */
create or replace function public.notas_externas_candidatos(p_id bigint)
 returns table(
   alvo_tipo text, id_unico text, cod_titulo text, nome text,
   valor numeric, data date, categoria text, ja_tem_nota boolean, dias integer
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with n as (
    select id, coalesce(vencimento, enviado_em) as data_ref, candidatos
      from public.notas_externas where id = p_id
  ),
  alvos as (
    select a->>'tipo' as tipo, a->>'id_unico' as id_unico
      from n, lateral jsonb_array_elements(coalesce(n.candidatos->'alvos', '[]'::jsonb)) a
  )
  select
    al.tipo,
    al.id_unico,
    case when al.tipo in ('pix', 'erp') then al.id_unico else c.omie_cod_titulo end,
    case al.tipo
      when 'erp'    then coalesce(t.favorecido, t.favorecido_cru)
      when 'pix'    then coalesce(p.favorecido, p.descricao)
      when 'cartao' then coalesce(c.estabelecimento, c.descricao_original)
    end,
    case al.tipo when 'erp' then t.valor when 'pix' then p.valor else c.valor end,
    case al.tipo when 'erp' then coalesce(t.pagamento, t.vencimento, t.emissao)
                 when 'pix' then p.data else c.data end,
    case al.tipo when 'erp' then t.categoria when 'pix' then p.categoria else c.categoria end,
    case al.tipo
      when 'cartao' then coalesce(c.status_nf, '') = 'OK' or coalesce(c.link_comprovante, '') <> ''
      else coalesce(t.anexos_no_erp, 0) > 0
    end,
    abs((case al.tipo when 'erp' then coalesce(t.pagamento, t.vencimento, t.emissao)
                      when 'pix' then p.data else c.data end) - n.data_ref)
  from alvos al
  cross join n
  left join public.cap_titulos t
         on al.tipo in ('erp', 'pix')
        and t.cod_titulo = nullif(regexp_replace(al.id_unico, '\D', '', 'g'), '')::bigint
  left join public.auditoria_pix_lancamentos p
         on al.tipo = 'pix' and p.id_unico = al.id_unico
  left join public.auditoria_cartao_lancamentos c
         on al.tipo = 'cartao' and c.id_unico = al.id_unico
  order by 9 nulls last;
$function$;

/* As funções nascem chamáveis por `anon` — ver a migração do grant automático.
   Arquivar em lote por quem não fez login seria a pior porta do Hub. */
revoke all on function public.notas_externas_faxina(boolean) from anon;
revoke all on function public.notas_externas_arquivar_lote(bigint[], text) from anon;
revoke all on function public.notas_externas_desarquivar_lote(bigint[]) from anon;
revoke all on function public.notas_externas_desarquivar_motivo(text) from anon;
revoke all on function public.notas_externas_janela_medir() from anon;
revoke all on function public.notas_externas_por_que_parou() from anon;
revoke all on function public.notas_externas_candidatos(bigint) from anon;
revoke all on function public.notas_externas_corte_alcance() from anon;
