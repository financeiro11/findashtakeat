-- O painel de remuneração numa chamada só.
--
-- POR QUE UM BLOCO JSON e não ler as tabelas da tela:
--
--   O PostgREST devolve no máximo 1.000 linhas e um `.limit(5000)` volta mil
--   CALADO. `vw_remuneracao_mensal` já tem ~1.020 linhas hoje (170 pessoas × 6
--   meses) e vai a ~3.000 quando o Conta Azul entrar — a tela leria o primeiro
--   milheiro e mostraria uma folha menor do que a real, sem erro nenhum. Dava
--   para paginar; um bloco só resolve de vez e ainda junta o espelho do RH
--   (cargo, setor, início) sem uma segunda ida ao servidor.
--
-- SEM `security definer`, de propósito: a função roda como quem chamou, então a
-- policy `pode_ver_remuneracao()` continua valendo em `remuneracao_pessoa`,
-- `remuneracao_lancamento` e `rh_colaboradores`. Quem não tem o cargo recebe
-- listas vazias — e a tela trata isso mostrando "sem acesso" em vez de
-- "nenhuma pessoa", que seria uma mentira difícil de investigar.

create or replace function public.remuneracao_painel()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with pessoa as (
    select
      p.id,
      p.nome,
      p.codigo_rh,
      p.doc,
      p.eh_pessoa,
      r.cargo,
      r.setor,
      r.modalidade,
      -- `inicio` e `datadesl` são TEXTO no espelho do RH, não data. Convertê-los
      -- aqui faria uma linha malformada derrubar o painel inteiro com "invalid
      -- input syntax for type date" — e existe pelo menos uma torta (o início do
      -- André Rocon é a data de NASCIMENTO dele, 02/12/1996). Vai cru; quem lê
      -- decide o que fazer com o que não parsear.
      nullif(btrim(r.inicio), '')   as inicio,
      nullif(btrim(r.datadesl), '') as datadesl,
      -- O valor de contrato de HOJE. Serve para conferir contra o último mês
      -- pago: divergência é sinal de aditivo não lançado — ou de lançamento
      -- errado no ERP.
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
            'fontes',      m.fontes
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

comment on function public.remuneracao_painel() is
  'O painel de remuneração inteiro num jsonb — pessoas, meses e o espelho do RH junto.';

revoke all on function public.remuneracao_painel() from anon;
grant execute on function public.remuneracao_painel() to authenticated;
