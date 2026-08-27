-- Radar: só entra o que dá para comprar, e o preço passa a incluir o frete.
--
-- DISPONIBILIDADE. O radar avisava sobre produto esgotado, e esse é o erro que
-- mais rápido mata a confiança na aba: a pessoa larga o que está fazendo, abre o
-- link e encontra "avise-me quando chegar". Pior — página de produto esgotado
-- costuma manter o último preço praticado, que fica bonito JUSTAMENTE por não
-- estar mais à venda. É o achado mais convincente e mais inútil possível.
--
-- `disponivel` é de três estados de propósito:
--   true   a página disse que tem, ou a confirmação no anúncio conferiu;
--   false  disse que não tem  → reprovado, nem chega a virar linha;
--   null   não falou do assunto → passa, mas a tela pede para conferir.
-- Tratar `null` como `true` seria inventar; como `false`, jogaria fora metade
-- dos anúncios bons, porque página de busca raramente fala de estoque.
--
-- FRETE. O teto do Facilities é quanto ele aceita GASTAR. Um notebook de
-- R$ 2.980 com R$ 140 de frete estoura um teto de R$ 3.000, e o radar que
-- ignorava isso avisava sobre uma compra que não cabe. Daqui em diante o teto, o
-- ranking, o alerta e a economia são todos medidos por `preco_total`.
--
-- E frete desconhecido NÃO É ZERO. Somar zero é afirmar "é grátis", coisa que o
-- anúncio nunca disse. `frete_valor` fica null e `preco_total` sai só com o
-- produto — a tela mostra "frete não informado" em vez de mentir por omissão.

alter table public.facilities_radar_ofertas
  add column if not exists disponivel   boolean,
  add column if not exists frete_valor  numeric,
  add column if not exists frete_texto  text,
  add column if not exists preco_total  numeric,
  -- Quando o anúncio foi aberto e conferido um a um (estoque + frete), em vez
  -- de lido só na página de busca. É o que separa "achei" de "dá para comprar".
  add column if not exists confirmado_em timestamptz;

-- Ofertas que já existiam nasceram sem total: sem isto elas ficariam de fora de
-- qualquer ordenação por `preco_total` e sumiriam da tela sem erro nenhum.
update public.facilities_radar_ofertas
   set preco_total = coalesce(preco_total, preco)
 where preco_total is null;

alter table public.facilities_radar_alertas
  add column if not exists preco_total numeric,
  add column if not exists frete_valor numeric,
  -- Guardada no alerta, e não recalculada na tela: o teto do alvo pode ser
  -- editado depois, e a economia que a pessoa viu no dia tem de continuar sendo
  -- a que ela viu. Recalcular reescreveria o passado a cada edição.
  add column if not exists economia    numeric;

update public.facilities_radar_alertas
   set preco_total = coalesce(preco_total, preco),
       economia    = coalesce(economia, greatest(0, preco_alvo - preco))
 where preco_total is null or economia is null;

create index if not exists idx_radar_ofertas_total
  on public.facilities_radar_ofertas (alvo_id, ativo, preco_total);

/* ------------------------------------------------------------------ painel */

-- Agora o painel devolve também a economia, que virou destaque na tela.
--   `economia_aberta`   o que está na mesa agora, em achados ainda não tratados;
--   `economia_realizada` o que já virou cotação — dinheiro que o radar de fato
--                        poupou, e o único número que vale para prestar contas.
-- Os dois separados de propósito: somar tudo num "total economizado" inflaria o
-- resultado com achados que ninguém comprou.
--
-- DROP ANTES, e não é zelo: `create or replace` NÃO muda tipo de retorno
-- ("cannot change return type of existing function"). E, quando a assinatura
-- muda, ele nem substitui — cria uma sobrecarga e deixa a velha viva, com o
-- PostgREST escolhendo qual chamar. A tela então lê a versão antiga, sem
-- economia, e sem erro nenhum para denunciar.
drop function if exists public.facilities_radar_painel();

create function public.facilities_radar_painel()
returns table (
  alvo               jsonb,
  alertas_novos      integer,
  ofertas_ativas     integer,
  melhor             jsonb,
  economia_aberta    numeric,
  economia_realizada numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_jsonb(a) as alvo,
    (select count(*)::int from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'novo') as alertas_novos,
    (select count(*)::int from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo) as ofertas_ativas,
    (select to_jsonb(o) from facilities_radar_ofertas o
       where o.alvo_id = a.id and o.ativo
       -- Ordena pelo TOTAL: o mais barato de verdade, não o de etiqueta menor.
       order by coalesce(o.preco_total, o.preco) asc, o.score desc
       limit 1) as melhor,
    -- round() porque a economia é dinheiro que vai para a tela em destaque:
    -- 'R$ 4.354,0900000000001' faz a pessoa duvidar do resto da conta.
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status in ('novo','visto')), 2), 0) as economia_aberta,
    coalesce(round((select sum(al.economia) from facilities_radar_alertas al
       where al.alvo_id = a.id and al.status = 'virou_cotacao'), 2), 0) as economia_realizada
  from facilities_radar_alvos a
  order by a.ativo desc, a.created_at desc;
$$;

/* ATENÇÃO — DUAS PEGADINHAS AQUI, as duas conferidas neste projeto:

   1. Este revoke NÃO faz efeito rodando junto com o CREATE acima. O gatilho do
      Supabase que abre a função dispara DEPOIS do lote e desfaz o revoke sem
      reclamar. Ao reaplicar esta migration, rode as duas linhas abaixo NUMA
      CHAMADA SEPARADA, e confira com has_function_privilege('anon', …).

   2. Revogar só de PUBLIC, ou só de anon, não basta: o gatilho concede ora a
      PUBLIC (a ACL aparece como "=X/postgres"), ora nominalmente a anon
      ("anon=X/postgres"). As duas formas apareceram na mesma tarde, na mesma
      função. Por isso o revoke nomeia as duas. */
revoke all on function public.facilities_radar_painel() from anon, public;
grant execute on function public.facilities_radar_painel() to authenticated, service_role;

/* ------------------------------------------------- alerta → cotação (total) */

-- A cotação passa a ser lançada pelo TOTAL, com o frete escrito na observação.
-- Lançar só o preço do produto faria a comparação de cotações no módulo mentir:
-- um orçamento com frete embutido perderia para outro que esconde o frete.
create or replace function public.facilities_radar_virar_cotacao(
  p_alerta_id bigint,
  p_quem      text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_al     facilities_radar_alertas%rowtype;
  v_alvo   facilities_radar_alvos%rowtype;
  v_of     facilities_radar_ofertas%rowtype;
  v_solic  uuid;
  v_cot    uuid;
  v_nova   boolean := false;
  v_total  numeric;
begin
  select * into v_al from facilities_radar_alertas where id = p_alerta_id;
  if not found then raise exception 'Alerta % não existe.', p_alerta_id; end if;
  if v_al.cotacao_id is not null then
    return jsonb_build_object('cotacao_id', v_al.cotacao_id, 'ja_existia', true);
  end if;

  select * into v_alvo from facilities_radar_alvos   where id = v_al.alvo_id;
  select * into v_of   from facilities_radar_ofertas where id = v_al.oferta_id;
  v_total := coalesce(v_al.preco_total, v_al.preco);

  v_solic := v_alvo.solicitacao_id;
  if v_solic is null then
    insert into facilities_solicitacoes (titulo, categoria, valor, status, solicitante, observacao)
    values (
      v_alvo.titulo,
      v_alvo.categoria,
      v_total * greatest(v_alvo.quantidade, 1),
      'em_cotacao',
      coalesce(p_quem, v_alvo.criado_por),
      'Aberta pelo Radar de Preços. Pedido original: ' || v_alvo.pedido
    )
    returning id into v_solic;
    v_nova := true;
    update facilities_radar_alvos set solicitacao_id = v_solic, updated_at = now() where id = v_alvo.id;
  end if;

  insert into facilities_cotacoes (solicitacao_id, fornecedor_nome, valor, link_url, observacao)
  values (
    v_solic,
    coalesce(v_of.vendedor, v_of.fonte),
    v_total,
    v_of.url,
    v_of.titulo
      || E'\nProduto ' || to_char(v_al.preco, 'FM999G999D00')
      || case
           when v_al.frete_valor is null then ' + frete não informado'
           when v_al.frete_valor = 0     then ' + frete grátis'
           else ' + frete ' || to_char(v_al.frete_valor, 'FM999G999D00')
         end
      || case when array_length(v_of.conferir, 1) is null then ''
              else E'\n⚠ Conferir no anúncio: ' || array_to_string(v_of.conferir, ', ') end
      || E'\nRadar: ' || v_al.texto
  )
  returning id into v_cot;

  update facilities_radar_alertas
     set status = 'virou_cotacao', cotacao_id = v_cot,
         visto_por = coalesce(p_quem, visto_por), visto_em = now()
   where id = p_alerta_id;

  return jsonb_build_object('cotacao_id', v_cot, 'solicitacao_id', v_solic, 'solicitacao_nova', v_nova);
end $$;

revoke all on function public.facilities_radar_virar_cotacao(bigint, text) from anon, public;
grant execute on function public.facilities_radar_virar_cotacao(bigint, text) to authenticated, service_role;

comment on column public.facilities_radar_ofertas.disponivel is
  'Três estados: true = tem estoque, false = esgotado (reprovado), null = a fonte não disse (passa, mas a tela pede para conferir). Tratar null como true seria inventar.';
comment on column public.facilities_radar_ofertas.frete_valor is
  'Frete em reais. 0 é frete grátis; null é frete DESCONHECIDO — somar null como zero afirmaria "é grátis", coisa que o anúncio nunca disse.';

/* ------------------------------------------------------ rodízio de fontes */

-- Contador de varreduras do alvo. Serve ao rodízio: são doze fontes e só seis
-- cabem numa rodada, então as não-comprovadas entram em roda avançando uma
-- posição por varredura. Sem o contador, o corte seria sempre pelas primeiras
-- da fila e as últimas ficariam ligadas na tela e mudas na prática.
alter table public.facilities_radar_alvos
  add column if not exists rodadas integer not null default 0;

comment on column public.facilities_radar_alertas.status is
  'novo | visto | virou_cotacao | arquivado | a_confirmar | indisponivel | descartado. `a_confirmar` é a quarentena: o achado nasce aí e só vira `novo` depois que a ação confirmar abre o anúncio e vê que tem estoque e cabe no teto com o frete. `indisponivel` e `descartado` NÃO aparecem na tela, mas ficam gravados — "sumiu antes de eu ver" é informação sobre o mercado.';
