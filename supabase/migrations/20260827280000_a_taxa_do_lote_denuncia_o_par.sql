-- Seis títulos, uma fatura de cartão, UMA cotação — e é isso que os identifica.
--
-- O usuário contou o que aconteceu: *"nós tivemos de pagar o datadog atrasado,
-- então vários invoices vieram na mesma fatura do cartão"*. Os seis títulos da
-- Datadog são todos `Lancamento Fatura Cartao` com data 11/08/2026, e as
-- invoices que eles pagam são de janeiro a junho.
--
-- Daí sai uma prova que nenhuma regra por valor tem: **se a fatura converteu
-- tudo pela mesma cotação, então `título ÷ invoice` tem de dar o MESMO número
-- para todos os pares certos.** Medido no lote da Datadog:
--
--   R$ 12.236,59 ÷ US$ 2.411,53 = 5,0742
--   R$ 11.137,41 ÷ US$ 2.194,91 = 5,0742
--   R$  8.493,96 ÷ US$ 1.673,95 = 5,0742
--   R$  7.350,54 ÷ US$ 1.448,61 = 5,0742
--   R$  5.282,85 ÷ US$ 1.040,34 = 5,0780
--
-- Espalhamento de 0,07%. Cinco valores independentes caindo no mesmo número até
-- a quarta casa não é coincidência — é a cotação da fatura aparecendo cinco
-- vezes. A regra `cambio` sozinha nunca chegaria lá: ela compara UM título com
-- UMA invoice, e depois de convertidas as invoices de maio e junho ficam a 0,4%
-- uma da outra, dentro da banda de 8% do mesmo título. A conversão COMPRIME a
-- diferença que existia em dólar; só o lote inteiro a devolve.
--
-- ---------------------------------------------------------------------------
-- "SERÁ QUE FORAM DOIS PAGAMENTOS SOMADOS?" — a pergunta virou teste
--
-- Pedido do usuário: *"quando o valor não bater de primeira, ver se houve dois
-- pagamentos somados ou outras situações"*. Com a cotação do lote na mão isso
-- deixa de ser palpite e vira conta: qualquer hipótese — uma invoice, duas
-- somadas — é testável perguntando se ela cai NA MESMA cotação das outras.
-- Achado assim, no lote do HubSpot de 13/07: R$ 642,00 = US$ 108,87 + US$ 47,45,
-- as duas somadas, a 4,107 — a mesma cotação do título vizinho.
--
-- A busca é aritmética e fica no Postgres de propósito. Um modelo de linguagem
-- somando US$ 1.448,61 com US$ 1.673,95 e dividindo por R$ 8.493,96 erra sem
-- avisar, e erra com uma frase convincente em volta. O que a IA faz com isto é
-- CONTAR — ver `notas-diagnostico`, que passa a ler `nota_taxa_do_lote`.
--
-- ---------------------------------------------------------------------------
-- DUAS TOLERÂNCIAS, PORQUE ACHAR E APLICAR CUSTAM EVIDÊNCIAS DIFERENTES
--
-- ACHAR a cotação é caro: 0,1% de tolerância e no mínimo dois títulos
-- corroborando. Um lote do HubSpot tem 11 invoices e 3 títulos — com as somas
-- são 66 valores candidatos por título, e a chance de dois títulos concordarem
-- por sorte dentro de 0,1% não é desprezível. Por isso:
--
--   `alta`  = três ou mais títulos na mesma cotação, e o título casa com UMA
--             invoice. Três valores independentes concordando é prova.
--   `media` = dois títulos, ou o casamento envolve SOMA. Soma tem liberdade
--             combinatória demais para subir ao ERP sozinha; fica esperando o
--             clique de alguém, com a conta escrita na tela.
--
-- ---------------------------------------------------------------------------
-- A JANELA AQUI É DE 400 DIAS, e não é descuido
--
-- A invoice de janeiro foi paga em 11 de agosto: 213 dias. É exatamente o caso
-- que o usuário descreveu. A janela larga não afrouxa nada porque quem decide
-- não é ela — é a cotação corroborada. Sem os 400 dias o título de R$ 5.282,85
-- ficava de fora e o lote perdia a quinta corroboração.

create table if not exists public.nota_taxa_do_lote (
  id           bigserial primary key,
  quem         text not null,
  data         date not null,
  moeda        text not null,
  taxa         numeric(12, 6) not null,
  titulos      int not null,
  espalhamento numeric(8, 5) not null,
  calculado_em timestamptz not null default now(),
  unique (quem, data, moeda)
);

comment on table public.nota_taxa_do_lote is
  'A cotação que uma fatura de cartão usou, deduzida dos próprios títulos: título ÷ invoice tem de dar o mesmo número para todos os pares certos. `titulos` é quantos corroboram e `espalhamento` é a distância relativa entre o maior e o menor — 0,0007 significa 0,07%. Ver 20260827280000.';

alter table public.nota_taxa_do_lote enable row level security;

drop policy if exists nota_taxa_do_lote_leitura on public.nota_taxa_do_lote;
create policy nota_taxa_do_lote_leitura on public.nota_taxa_do_lote
  for select to authenticated using (true);

grant select on public.nota_taxa_do_lote to authenticated;

create or replace function public.notas_cambio_lote()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_casados int := 0;
  v_lotes   int := 0;
begin
  with cap as materialized (
    select cod_titulo, valor,
           coalesce(nullif(favorecido, '—'), favorecido_cru, '') as quem,
           coalesce(pagamento, vencimento, emissao) as data,
           situacao, coalesce(anexos_no_erp, 0) as anexos
      from public.cap_titulos
  ),
  /* Os mesmos dois `not exists` do casador: título de PIX e de cartão JÁ são
     alvo por outro caminho, e contá-los aqui os faria aparecer duas vezes.
     O QUE JÁ ESTÁ RESOLVIDO CONTINUA AQUI, e é de propósito: um título que já
     tem a nota dele é a MELHOR testemunha da cotação do lote — o par dele é
     verdade conhecida, não hipótese. Foi o que faltou na primeira rodada: o
     lote do HubSpot de 13/07 tinha dois títulos, um deles já resolvido, e ao
     excluí-lo o lote caiu para uma testemunha só e morreu. */
  titulos as (
    select c.cod_titulo, c.valor, c.quem, c.data, c.anexos
      from cap c
     where c.data is not null and c.situacao <> 'dispensa' and c.valor > 0
       and not exists (select 1 from public.auditoria_pix_lancamentos p
                        where p.id_unico = c.cod_titulo::text)
       and not exists (select 1 from public.auditoria_cartao_lancamentos a
                        where a.omie_cod_titulo = c.cod_titulo::text)
  ),
  /* Quem ainda PRECISA de nota. Testemunhar é uma coisa, receber o documento
     é outra — e só esta lista recebe. */
  titulos_livres as (
    select t.* from titulos t
     where t.anexos = 0
       and not exists (select 1 from public.notas_externas x
                        where x.alvo_tipo = 'erp'
                          and x.alvo_id_unico = t.cod_titulo::text
                          and x.ignorado_em is null)
  ),
  notas as (
    select id, nome, moeda, valor_moeda, alvo_id_unico,
           coalesce(vencimento, enviado_em::date) as data_ref
      from public.notas_externas
     where moeda in ('USD', 'EUR') and valor_moeda is not null and valor_moeda > 0
       and ignorado_em is null and copia_de is null and enviado_erp_em is null
       and not alvo_manual and tipo_documento = 'nota'
  ),
  /* UMA invoice por título. É também o que define o LOTE — o par2 abaixo só
     olha para invoices que já entraram por aqui, senão o produto cartesiano
     de 5 mil títulos por 120 invoices ao quadrado não termina. */
  p1 as (
    select t.quem, t.data, t.cod_titulo, t.valor as tv,
           n.moeda, array[n.id] as notas, n.valor_moeda as usd,
           t.valor / n.valor_moeda as taxa,
           n.alvo_id_unico is null as nota_livre
      from titulos t
      join notas n on public.token_forte_em_comum(n.nome, t.quem)
     where t.data between n.data_ref - 20 and n.data_ref + 400
  ),
  do_lote as (
    select distinct quem, data, moeda, (notas)[1] as nota_id, usd, nota_livre from p1
  ),
  /* DUAS invoices somadas — o pagamento atrasado que juntou dois meses. */
  p2 as (
    select t.quem, t.data, t.cod_titulo, t.tv, a.moeda,
           array[a.nota_id, b.nota_id] as notas, a.usd + b.usd as usd,
           t.tv / (a.usd + b.usd) as taxa,
           a.nota_livre and b.nota_livre as nota_livre
      from (select distinct quem, data, cod_titulo, tv from p1) t
      join do_lote a on a.quem = t.quem and a.data = t.data
      join do_lote b on b.quem = t.quem and b.data = t.data
                    and b.moeda = a.moeda and b.nota_id > a.nota_id
  ),
  pares as (
    select * from p1 union all select * from p2
  ),
  candidatas as (
    select distinct quem, data, moeda, taxa from pares
  ),
  /* QUANTOS TÍTULOS ESTA COTAÇÃO EXPLICA. É o voto: cada título que cai nela
     é um valor independente concordando. */
  suporte as (
    select c.quem, c.data, c.moeda, c.taxa,
           count(distinct p.cod_titulo) as titulos,
           max(abs(p.taxa - c.taxa)) / c.taxa as espalhamento
      from candidatas c
      join pares p on p.quem = c.quem and p.data = c.data and p.moeda = c.moeda
                  and abs(p.taxa - c.taxa) <= c.taxa * 0.001
     group by 1, 2, 3, 4
  ),
  melhor as (
    select distinct on (quem, data, moeda) *
      from suporte
     where titulos >= 2
     order by quem, data, moeda, titulos desc, espalhamento asc
  ),
  /* Cada título fica com o par mais próximo da cotação; UMA invoice ganha de
     DUAS somadas quando as duas cabem, porque soma é hipótese e invoice é
     documento. */
  escolha as (
    select distinct on (p.quem, p.data, p.moeda, p.cod_titulo)
           p.quem, p.data, p.moeda, p.cod_titulo, p.tv, p.notas, p.usd, p.taxa,
           m.taxa as consenso, m.titulos as corroboram, m.espalhamento
      from pares p
      join melhor m on m.quem = p.quem and m.data = p.data and m.moeda = p.moeda
      join titulos_livres tl on tl.cod_titulo = p.cod_titulo
     where abs(p.taxa - m.taxa) <= m.taxa * 0.001
       and p.nota_livre
     order by p.quem, p.data, p.moeda, p.cod_titulo,
              array_length(p.notas, 1), abs(p.taxa - m.taxa)
  ),
  /* Uma invoice não pode pagar dois títulos. Quem for reivindicada por mais de
     um sai inteira de cena — junto com os títulos que a escolheram. */
  reivindicada as (
    select nota_id, count(*) as por_quantos
      from escolha, lateral unnest(notas) as nota_id
     group by 1
  ),
  boas as (
    select e.*
      from escolha e
     where not exists (
             select 1 from unnest(e.notas) as nid
              join reivindicada r on r.nota_id = nid
             where r.por_quantos > 1)
  ),
  gravar_taxa as (
    insert into public.nota_taxa_do_lote (quem, data, moeda, taxa, titulos, espalhamento)
    select quem, data, moeda, taxa, titulos, espalhamento from melhor
        on conflict (quem, data, moeda) do update
       set taxa = excluded.taxa, titulos = excluded.titulos,
           espalhamento = excluded.espalhamento, calculado_em = now()
    returning 1
  ),
  aplicar as (
    update public.notas_externas nt
       set alvo_tipo     = 'erp',
           alvo_id_unico = b.cod_titulo::text,
           casamento     = case when array_length(b.notas, 1) > 1
                                then 'cambio_lote_soma' else 'cambio_lote' end,
           confianca     = case when b.corroboram >= 3 and array_length(b.notas, 1) = 1
                                then 'alta' else 'media' end,
           candidatos    = null,
           atualizado_em = now()
      from boas b
     where nt.id = any (b.notas)
       and nt.alvo_id_unico is null
    returning nt.id
  )
  select (select count(*) from aplicar), (select count(*) from melhor)
    into v_casados, v_lotes;

  return jsonb_build_object(
    'ok', true,
    'lotes', v_lotes,
    'notas_casadas', v_casados,
    'alta',  (select count(*) from public.notas_externas
               where casamento in ('cambio_lote', 'cambio_lote_soma') and confianca = 'alta'),
    'media', (select count(*) from public.notas_externas
               where casamento in ('cambio_lote', 'cambio_lote_soma') and confianca = 'media'),
    'somas', (select count(*) from public.notas_externas
               where casamento = 'cambio_lote_soma')
  );
end;
$fn$;

comment on function public.notas_cambio_lote() is
  'Casa invoice estrangeira com título deduzindo a COTAÇÃO do lote: título ÷ invoice dá o mesmo número para todos os pares certos da mesma fatura de cartão. Testa uma invoice e duas somadas. `alta` só com 3+ títulos corroborando e sem soma. Roda no fim de notas_externas_casar. Ver 20260827280000.';

revoke all on function public.notas_cambio_lote() from anon;
grant execute on function public.notas_cambio_lote() to authenticated, service_role;
