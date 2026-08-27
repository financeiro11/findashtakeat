-- Quando a NF finalmente chega, o título diz que se resolveu.
--
-- É a última das quatro marcas que o usuário pediu em 27/08/2026: *"se um dia
-- aparecer a NF ela tem que ser colocada nesses lugares"* — e o Hub tem de
-- avisar que aconteceu. Sem isto, o título só desaparece da lista âmbar, e
-- sumir não é a mesma coisa que avisar: quem cobrou o fornecedor por três meses
-- merece ver que a cobrança funcionou.
--
-- ---------------------------------------------------------------------------
-- O EVENTO É A TRANSIÇÃO, e por isso mora num gatilho
--
-- "Este título passou a ter nota" não se descobre olhando o estado de hoje —
-- só comparando com o de ontem, e a view não guarda ontem. O gatilho carimba
-- `virou_nota_em` no instante em que o documento pendurado deixa de ser recibo
-- (ou coisa nenhuma) e passa a ser nota, seja porque a varredura subiu a NF,
-- porque a triagem leu melhor, ou porque alguém abriu e disse "é a nota".
--
-- `p_emite_nf => true` nas duas chamadas de propósito: esse argumento só muda o
-- destino do `print_de_tela`, que não é `nota` em nenhum dos dois casos. Passar
-- o valor real exigiria consultar o nome do favorecido dentro do gatilho — uma
-- ida à `cap_titulos` por linha atualizada, numa tabela que a varredura escreve
-- às centenas.
--
-- CARIMBA UMA VEZ. Se o anexo for reclassificado de novo mais tarde, o carimbo
-- original fica: ele marca quando a nota chegou, não a última vez que alguém
-- mexeu na linha.

alter table public.omie_titulo_anexo
  add column if not exists virou_nota_em timestamptz;

comment on column public.omie_titulo_anexo.virou_nota_em is
  'Quando o documento pendurado neste título passou a ser NOTA, vindo de recibo ou de nada. Carimbado por gatilho, uma vez só — é o "a cobrança funcionou" que a tela mostra. Ver 20260827400000.';

create or replace function public.omie_titulo_anexo_virou_nota()
returns trigger
language plpgsql
as $$
declare
  v_antes  text;
  v_depois text;
begin
  v_depois := public.anexo_documento_classe(
    new.classe, new.revisao, new.ia_leitura->>'tipo', true);
  if v_depois is distinct from 'nota' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Linha que já nasce com nota não é notícia: não houve cobrança nenhuma.
    return new;
  end if;

  v_antes := public.anexo_documento_classe(
    old.classe, old.revisao, old.ia_leitura->>'tipo', true);

  if v_antes is distinct from 'nota' and new.virou_nota_em is null then
    new.virou_nota_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists omie_titulo_anexo_virou_nota on public.omie_titulo_anexo;
create trigger omie_titulo_anexo_virou_nota
  before insert or update of classe, revisao, ia_leitura
  on public.omie_titulo_anexo
  for each row
  execute function public.omie_titulo_anexo_virou_nota();

/* ============================================================================
 *  A lista de cobrança, e a de quem já se resolveu
 * ==========================================================================
 * Duas perguntas próximas e diferentes: "de quem eu cobro a nota?" e "qual
 * cobrança deu certo?". A primeira ordena por valor, porque é ela que vira
 * e-mail; a segunda ordena por data, porque é notícia. */

create or replace function public.cap_notas_so_comprovante(
  p_de     date default null,
  p_ate    date default null,
  p_dias   int  default 14,
  p_limite int  default 200
)
returns table (
  cod_titulo    bigint,
  favorecido    text,
  valor         numeric,
  competencia   date,
  categoria     text,
  anexo_tipo    text,
  documento_classe text,
  situacao      text,
  virou_nota_em timestamptz
)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select c.cod_titulo, c.favorecido, c.valor, c.competencia, c.categoria,
         c.anexo_tipo_lido, c.documento_classe, c.situacao, a.virou_nota_em
    from public.cap_titulos c
    left join public.omie_titulo_anexo a on a.cod_titulo = c.cod_titulo
   where (p_de is null or c.competencia >= p_de)
     and (p_ate is null or c.competencia <= p_ate)
     and (
           c.situacao = 'so_comprovante'
        or (a.virou_nota_em is not null
            and a.virou_nota_em >= now() - make_interval(days => greatest(1, p_dias)))
     )
   order by (c.situacao = 'so_comprovante') desc, a.virou_nota_em desc nulls last,
            c.valor desc
   limit greatest(1, least(coalesce(p_limite, 200), 500))
$$;

comment on function public.cap_notas_so_comprovante(date, date, int, int) is
  'O que está só com comprovante e cujo fornecedor EMITE nota — a lista de cobrança, por valor. Junto, o que se resolveu nos últimos dias (`virou_nota_em`), que é a mesma lista vista pelo outro lado. Ver 20260827400000.';

revoke all on function public.cap_notas_so_comprovante(date, date, int, int) from public, anon;
grant execute on function public.cap_notas_so_comprovante(date, date, int, int) to authenticated, service_role;
