-- A troca de área passa a ter data.
--
-- O Portal RH guarda o cargo de HOJE. Não há histórico de posição em lugar
-- nenhum — nem no espelho, nem no ERP. Só que a categoria do pagamento carrega
-- a área ("3.1.1.2. Pessoal - Comercial"), e ela muda quando a pessoa muda de
-- time. Ou seja: a mudança de categoria entre dois meses É a mudança de área,
-- e é o único sinal datado que existe.
--
-- Nos seis meses carregados isso revela 12 movimentações, e o desenho delas bate
-- com a trilha real da operação — Suporte → Onboarding → Sucesso. O Levi
-- Monteiro foi e voltou entre junho e julho, e o painel mostra as duas pernas.
--
-- CUIDADO ao ler: isto é a área que PAGOU, não o cargo. Uma promoção dentro do
-- mesmo time não aparece aqui (nem em lugar nenhum, hoje) — o que aparece é
-- troca de time. A tela diz isso com todas as letras, para ninguém ler
-- "mudou de área" como "foi promovido".

drop view if exists public.vw_remuneracao_mensal;

create view public.vw_remuneracao_mensal
with (security_invoker = true) as
select
  p.id                as pessoa_id,
  p.nome,
  p.codigo_rh,
  p.eh_pessoa,
  l.competencia,
  sum(l.valor) filter (where l.bloco in ('fixo','prolabore'))  as fixo,
  sum(l.valor) filter (where l.bloco = 'premiacao')            as premiacao,
  sum(l.valor) filter (where l.bloco = 'escala')               as escala,
  sum(l.valor) filter (where l.bloco = 'outro')                as outro,
  sum(l.valor)                                                 as total,
  count(*)                                                     as lancamentos,
  string_agg(distinct l.fonte, '+' order by l.fonte)           as fontes,

  -- A área do mês: o que vem depois do traço na categoria.
  --
  -- Ordenada pelo BLOCO antes do valor: a área da folha é a do time da pessoa;
  -- a da premiação pode ser de outro, no mês em que ela muda de time e ainda
  -- recebe a comissão do time antigo. Pegar a maior por valor escolheria a
  -- premiação num mês de bônus grande e inventaria uma transferência.
  --
  -- `array_remove(..., null)` depois do agg preserva a ordem e descarta as
  -- categorias sem traço (Pro Labore), que não têm área.
  (array_remove(
     array_agg(nullif(btrim(split_part(l.categoria, '-', 2)), '')
       order by (case l.bloco when 'fixo' then 0 when 'prolabore' then 1 else 2 end),
                l.valor desc),
     null))[1]                                                 as area

from public.remuneracao_pessoa p
join public.remuneracao_lancamento l on l.pessoa_id = p.id
group by p.id, p.nome, p.codigo_rh, p.eh_pessoa, l.competencia;

comment on view public.vw_remuneracao_mensal is
  'Remuneração somada por pessoa e competência, com a área que pagou o fixo do mês.';

revoke all on public.vw_remuneracao_mensal from anon;

/* ------------------------------------------------------------------ */
/* O painel leva a área junto                                          */
/* ------------------------------------------------------------------ */

create or replace function public.remuneracao_painel()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with pessoa as (
    select
      p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
      r.cargo, r.setor, r.modalidade,
      nullif(btrim(r.inicio), '')   as inicio,
      nullif(btrim(r.datadesl), '') as datadesl,
      r.valor as valor_contrato,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'competencia', m.competencia,
            'fixo',        coalesce(m.fixo, 0),
            'premiacao',   coalesce(m.premiacao, 0),
            'escala',      coalesce(m.escala, 0),
            'outro',       coalesce(m.outro, 0),
            'total',       m.total,
            'fontes',      m.fontes,
            'area',        m.area
          ) order by m.competencia
        ) filter (where m.competencia is not null),
        '[]'::jsonb
      ) as meses
    from public.remuneracao_pessoa p
      left join public.rh_colaboradores r      on r.codigo = p.codigo_rh
      left join public.vw_remuneracao_mensal m on m.pessoa_id = p.id
    group by p.id, p.nome, p.codigo_rh, p.doc, p.eh_pessoa,
             r.cargo, r.setor, r.modalidade, r.inicio, r.datadesl, r.valor
  )
  select jsonb_build_object(
    'meses', coalesce(
      (select jsonb_agg(distinct competencia) from public.remuneracao_lancamento),
      '[]'::jsonb),
    'pessoas', coalesce(
      (select jsonb_agg(to_jsonb(pessoa) order by pessoa.nome) from pessoa),
      '[]'::jsonb),
    'gerado_em', to_jsonb(now())
  )
$$;

revoke all on function public.remuneracao_painel() from anon;
grant execute on function public.remuneracao_painel() to authenticated;
