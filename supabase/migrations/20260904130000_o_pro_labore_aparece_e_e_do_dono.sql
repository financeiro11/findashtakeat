-- O pró-labore volta para o dono, e passa a aparecer separado.
--
-- DOIS PROBLEMAS, um de dado e um de exibição.
--
-- O DADO: o pró-labore do Miguel existe no ERP, mas sob dois favorecidos que
-- não são o "Miguel Carvalho" da ficha —
--
--   "Pró Labore - Miguel"              abr–jul/2026, SEM documento nenhum
--   "Miguel Macedo DE Carvalho Filho"  ago–set/2026, CPF 140.192.067-59
--
-- e o cadastro do RH tem o CNPJ dele (58.387.849/0001-40), então nem o nome nem
-- o documento casavam. Eram R$ 4.361 por mês fora da ficha do CEO. A fusão
-- automática por documento não pega nenhum dos dois: um não tem documento, o
-- outro tem CPF onde o RH guarda CNPJ. Vai como 'manual', confirmado pelo
-- financeiro em 04/09/2026 ("Miguel recebe o pró-labore").
--
-- A EXIBIÇÃO: `prolabore` era somado dentro de `fixo`, então mesmo depois da
-- fusão o número apareceria embutido. Passa a ter coluna própria — é dinheiro de
-- natureza diferente do salário e quem lê a ficha do sócio quer ver os dois.

/* ------------------------------------------------------------------ */
/* O pró-labore volta para o Miguel                                    */
/* ------------------------------------------------------------------ */

do $$
declare
  v_miguel uuid;
  v_outro  uuid;
begin
  select id into v_miguel from public.remuneracao_pessoa
   where chave = public.contraparte_chave('Miguel Carvalho') and codigo_rh is not null;

  if v_miguel is null then
    raise notice 'Miguel Carvalho não encontrado — nada a fundir';
    return;
  end if;

  foreach v_outro in array (
    select coalesce(array_agg(id), '{}'::uuid[])
    from public.remuneracao_pessoa
    where chave in (
      public.contraparte_chave('Pró Labore - Miguel'),
      public.contraparte_chave('Miguel Macedo DE Carvalho Filho')
    )
  )
  loop
    perform public.remuneracao_fundir(v_miguel, v_outro, 'manual');
  end loop;
end $$;

/* ------------------------------------------------------------------ */
/* Pró-labore ganha coluna própria                                     */
/* ------------------------------------------------------------------ */

drop view if exists public.vw_remuneracao_mensal;

create view public.vw_remuneracao_mensal
with (security_invoker = true) as
select
  p.id                as pessoa_id,
  p.nome,
  p.codigo_rh,
  p.eh_pessoa,
  l.competencia,
  -- `fixo` deixa de embutir o pró-labore. Quem quiser os dois juntos soma na
  -- tela; quem precisa separar (a ficha do sócio) não tem como desembutir.
  sum(l.valor) filter (where l.bloco = 'fixo')                 as fixo,
  sum(l.valor) filter (where l.bloco = 'prolabore')            as prolabore,
  sum(l.valor) filter (where l.bloco = 'premiacao')            as premiacao,
  sum(l.valor) filter (where l.bloco = 'escala')               as escala,
  sum(l.valor) filter (where l.bloco = 'outro')                as outro,
  sum(l.valor)                                                 as total,
  count(*)                                                     as lancamentos,
  string_agg(distinct l.fonte, '+' order by l.fonte)           as fontes,
  (array_remove(
     array_agg(nullif(btrim(split_part(l.categoria, '-', 2)), '')
       order by (case l.bloco when 'fixo' then 0 when 'prolabore' then 1 else 2 end),
                l.valor desc),
     null))[1]                                                 as area
from public.remuneracao_pessoa p
join public.remuneracao_lancamento l on l.pessoa_id = p.id
group by p.id, p.nome, p.codigo_rh, p.eh_pessoa, l.competencia;

comment on view public.vw_remuneracao_mensal is
  'Remuneração por pessoa e competência, com pró-labore separado do fixo e a área que pagou o mês.';

revoke all on public.vw_remuneracao_mensal from anon;

/* ------------------------------------------------------------------ */
/* O painel leva a coluna nova                                         */
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
            'prolabore',   coalesce(m.prolabore, 0),
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
