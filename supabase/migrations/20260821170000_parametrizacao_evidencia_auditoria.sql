-- Parametrização, parte 5: o comprovante da auditoria também é testemunho.
--
-- A conferência de comprovantes já transcreveu 80 notas e leu o CNPJ do emitente em 73
-- delas (91%). Isso alcança 32 lojistas do cartão — 33 linhas da fila, R$ 233 mil, das
-- quais 24 ainda sem apelido. É pouco perto das 333 contrapartes de cartão, mas é
-- informação de primeira mão: o documento que a pessoa anexou, não um palpite de modelo.
--
-- POR QUE ENTRA COMO EVIDÊNCIA "MEDIA", E NÃO COMO APELIDO DIRETO:
--
--   1. MARKETPLACE. `MERCADO LIVRE` tem 18 comprovantes com 18 CNPJs DIFERENTES (ARMAZEM
--      BRITO, RUGGED TECH, "Loja da Ceci"…). O CNPJ ali é do vendedor, não da contraparte
--      que aparece no extrato. Aplicar sozinho criaria 18 fornecedores para uma linha só.
--      A regra que pega isso não é uma lista de sites: é o próprio dado — mais de um CNPJ
--      para o mesmo lojista significa que nenhum nome único serve.
--
--   2. NOTA DO TOMADOR. O achado 128 (memo `AIRBNB *`) foi lido como emitente
--      "TAKEAT TECNOLOGIA LTDA, 37.511.891/0001-50" — é NF NOSSA, anexada no lançamento
--      errado. Sem recusa dura, o nosso próprio CNPJ vira fornecedor.
--
--   3. RAZÃO SOCIAL NÃO É APELIDO. `MAGE BURGER` → "ALVES COMERCIO LTDA"; `ZIG` → "FC
--      COMERCIO DE ALIMENTOS". O valor do CNPJ aqui é IDENTIDADE (casar com o Omie e com
--      as planilhas), não o nome bonito. Por isso o CNPJ entra sozinho no cadastro quando
--      falta, e o apelido continua sendo decisão de gente.
--
-- O que a auditoria acerta e as planilhas não alcançam: juntar grafias. `TAXA DE EMBARQUE`
-- e `GOL` são o mesmo 07.575.651; `PASSAGEM DEONIBU` e `PASSDEONIBUS` são o mesmo
-- 15.448.440. Essas linhas param de pedir apelido duas vezes.

alter table public.parametrizacao_evidencias
  drop constraint if exists parametrizacao_evidencias_fonte_ck;
alter table public.parametrizacao_evidencias
  add constraint parametrizacao_evidencias_fonte_ck
  check (fonte in ('compras', 'reembolsos', 'nfs_colaboradores', 'eventos', 'auditoria'));

/* ---------------------------------------------------------------------------
 * A chave de casamento, em SQL.
 *
 * É a MESMA de `chavePessoa` (src/lib/pessoasPJ.ts): tira CNPJ colado no nome,
 * acento, caixa, pontuação e sufixo societário empilhado. Precisa ser a mesma
 * porque a tela procura a evidência por `chaveContraparte(nome)` calculada no
 * TypeScript — chave diferente = evidência que existe e ninguém vê.
 * ------------------------------------------------------------------------- */
create or replace function public.chave_contraparte(p text)
returns text
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare t text; antes text;
begin
  -- O CNPJ sai ANTES de normalizar, enquanto ainda tem os pontos e a barra que
  -- identificam o formato; depois seria só um punhado de dígitos.
  t := regexp_replace(coalesce(p, ''), '\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}', ' ', 'g');
  t := upper(unaccent(t));
  t := regexp_replace(t, '[^A-Z0-9 ]', ' ', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));

  loop
    antes := t;
    t := btrim(regexp_replace(
      t,
      '\s+(SOCIEDADE\s+INDIVIDUAL\s+DE\s+ADVOCACIA|UNIPESSOAL|EIRELI|LTDA|EPP|MEI|ME|SS|S\s+A|SA|EI)$',
      ''));
    exit when t = antes;
  end loop;

  return t;
end $$;

comment on function public.chave_contraparte(text) is
  'Gêmea SQL de chavePessoa/chaveContraparte do front. Mudou lá, muda aqui.';

/* ---------------------------------------------------------------------------
 * O que os comprovantes lidos dizem sobre cada lojista do cartão.
 * ------------------------------------------------------------------------- */
create or replace function public.parametrizacao_evidencias_auditoria()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_gravadas int := 0;
  v_propostas int := 0;
  v_documentos int := 0;
  v_proprias int := 0;
begin
  -- Notas NOSSAS anexadas no lançamento errado (ver nota 2 do cabeçalho). Conta-se
  -- separado porque é sinal de comprovante trocado, não de fornecedor novo.
  select count(*) into v_proprias
  from public.auditoria a
  where regexp_replace(coalesce(a.ia_leitura->>'emitente_cnpj', ''), '[^0-9]', '', 'g') = '37511891000150'
     or a.ia_leitura->>'emitente_nome' ilike '%takeat%';

  with leitura as (
    select
      a.id,
      a.valor,
      a.data_lancamento,
      regexp_replace(a.ia_leitura->>'emitente_cnpj', '[^0-9]', '', 'g') as doc,
      btrim(a.ia_leitura->>'emitente_nome')                             as emitente,
      btrim(coalesce(a.ia_leitura->>'descricao', ''))                   as descricao
    from public.auditoria a
    where nullif(a.ia_leitura->>'emitente_cnpj', '') is not null
      and a.ia_leitura->>'emitente_nome' not ilike '%takeat%'
      and regexp_replace(coalesce(a.ia_leitura->>'emitente_cnpj', ''), '[^0-9]', '', 'g') <> '37511891000150'
      and length(regexp_replace(coalesce(a.ia_leitura->>'emitente_cnpj', ''), '[^0-9]', '', 'g')) in (11, 14)
  ),
  -- O lojista do cartão. Não há id em comum entre o achado e a fatura: o casamento é
  -- data + valor, e só quando esse par pertence a UM estabelecimento (mesma regra da
  -- RPC `auditoria_lojistas`, para as duas telas concordarem).
  cartao as (
    select cl.data as d, round(abs(cl.valor) * 100)::bigint as centavos, min(cl.estabelecimento) as estabelecimento
    from public.cartao_lancamentos cl
    where coalesce(btrim(cl.estabelecimento), '') <> ''
    group by 1, 2
    having count(distinct cl.estabelecimento) = 1
  ),
  casada as (
    select c.estabelecimento, l.doc, l.emitente, l.descricao
    from leitura l
    join cartao c
      on c.d = l.data_lancamento
     and c.centavos = round(abs(l.valor) * 100)::bigint
  ),
  agrupada as (
    select
      estabelecimento,
      count(*)                                     as ocorrencias,
      count(distinct doc)                          as cnpjs,
      min(doc)                                     as doc_unico,
      (array_agg(distinct emitente))[1:3]          as emitentes,
      (array_agg(descricao) filter (where descricao <> ''))[1] as descricao
    from casada
    group by 1
  ),
  proposta as (
    select
      a.*,
      -- Razão social sem o sufixo societário, em caixa de nome. Só vira proposta quando
      -- cabe numa linha: "MAC COMERCIO DE MATERIAIS PARA ESCRITORIO E SERVICOS ADMINIS"
      -- não é apelido de ninguém.
      case
        when a.cnpjs > 1 then null
        else nullif(initcap(lower(btrim(regexp_replace(
               a.emitentes[1],
               '\s+(LTDA\.?|S\.?/?A\.?|EIRELI|EPP|ME|MEI)\s*$', '', 'gi')))), '')
      end as apelido_bruto
    from agrupada a
  )
  insert into public.parametrizacao_evidencias
    (fonte, contraparte_origem, contraparte_nome, chave, documento_norm,
     chave_tipo, confianca, apelido, o_que_e, detalhe, ocorrencias, atualizado_em)
  select
    'auditoria',
    'cartao',
    p.estabelecimento,
    public.chave_contraparte(p.estabelecimento),
    case when p.cnpjs = 1 then p.doc_unico end,
    'cnpj',
    -- Nunca "alta": alta é o que a Parametrização aplica sozinha, e aqui o CNPJ é do
    -- documento anexado, não do formulário preenchido por quem gastou.
    case when p.cnpjs > 1 then 'baixa' else 'media' end,
    case when length(coalesce(p.apelido_bruto, '')) between 2 and 28 then p.apelido_bruto end,
    nullif(p.descricao, ''),
    case
      when p.cnpjs > 1 then
        format('%s comprovantes com %s CNPJs diferentes (%s…) — é intermediário: o CNPJ é do vendedor, não desta contraparte.',
               p.ocorrencias, p.cnpjs, array_to_string(p.emitentes, ', '))
      else
        format('Nota de %s (CNPJ %s)%s',
               p.emitentes[1], p.doc_unico,
               case when coalesce(p.descricao, '') <> '' then ' · ' || p.descricao else '' end)
    end,
    p.ocorrencias,
    now()
  from proposta p
  where public.chave_contraparte(p.estabelecimento) <> ''
  on conflict (fonte, chave) do update set
    contraparte_nome = excluded.contraparte_nome,
    documento_norm   = excluded.documento_norm,
    confianca        = excluded.confianca,
    apelido          = excluded.apelido,
    o_que_e          = excluded.o_que_e,
    detalhe          = excluded.detalhe,
    ocorrencias      = excluded.ocorrencias,
    atualizado_em    = now();

  get diagnostics v_gravadas = row_count;

  select count(*) into v_propostas
  from public.parametrizacao_evidencias
  where fonte = 'auditoria' and apelido is not null;

  -- O CNPJ entra sozinho no cadastro — mas SÓ o CNPJ, e só onde não havia nenhum.
  -- Identidade não é opinião: é ela que permite casar esta contraparte com o Omie e
  -- com as quatro planilhas depois. O apelido continua esperando alguém decidir.
  with alvo as (
    select e.documento_norm, e.chave
    from public.parametrizacao_evidencias e
    where e.fonte = 'auditoria' and e.documento_norm is not null
  ),
  achado as (
    select distinct on (a.chave) a.chave, a.documento_norm, f.id
    from alvo a
    join public.lib_fornecedores f
      on public.chave_contraparte(f.nome) = a.chave
    where coalesce(f.documento_norm, '') = ''
    order by a.chave, f.created_at nulls last, f.id
  )
  update public.lib_fornecedores f
     set documento = a.documento_norm,
         atualizado_em = now()
    from achado a
   where f.id = a.id;

  get diagnostics v_documentos = row_count;

  return jsonb_build_object(
    'evidencias', v_gravadas,
    'com_proposta_de_apelido', v_propostas,
    'cnpj_gravado_no_cadastro', v_documentos,
    'notas_da_propria_takeat', v_proprias
  );
end $$;

comment on function public.parametrizacao_evidencias_auditoria() is
  'Transforma a leitura dos comprovantes (auditoria.ia_leitura) em evidência da Parametrização. Nunca aplica apelido sozinho: mais de um CNPJ para o mesmo lojista é intermediário, e nota da própria Takeat é comprovante trocado.';

revoke all on function public.parametrizacao_evidencias_auditoria() from anon;
grant execute on function public.parametrizacao_evidencias_auditoria() to authenticated, service_role;
revoke all on function public.chave_contraparte(text) from anon;
grant execute on function public.chave_contraparte(text) to authenticated, service_role;

-- Roda depois da conferência de comprovantes do dia. É uma função do banco: não custa
-- chamada de API nem de modelo, só relê o que já está lido.
select cron.schedule(
  'parametrizacao-evidencia-auditoria-diaria',
  '50 13 * * *',
  $cron$ select public.parametrizacao_evidencias_auditoria(); $cron$
);
