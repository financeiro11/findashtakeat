-- POR QUE a nota falta — e não só QUANTO falta.
--
-- A tela sabia dizer "R$ 2,4 milhões sem nota" e "estes 1.678 títulos". O que
-- ela não sabia dizer é a única coisa que muda o que alguém faz na segunda-feira:
-- **em que estágio cada falta está**. Cobrar o fornecedor, clicar em confirmar,
-- pedir acesso a uma caixa de e-mail e aceitar que a nota não existe são quatro
-- trabalhos diferentes, e estavam todos no mesmo balde.
--
-- SEIS ESTÁGIOS, e cada um tem uma ação distinta:
--
--   `nao_exige`          — a régua da categoria dispensa. Não é falta.
--   `fornecedor_nao_emite` — Uber, 99: não existe nota por corrida. O recibo do
--                            app é o documento, e a triagem já o aceita.
--   `pronta_para_subir`  — o Hub TEM o arquivo e o alvo. Ninguém precisa fazer
--                          nada: a varredura leva em minutos.
--   `espera_um_clique`   — o Hub achou candidata(s) e não tem certeza. É o
--                          trabalho mais barato que existe aqui: olhar e decidir.
--   `achou_mas_nao_abre` — sabe-se ONDE está e não se consegue pegar: caixa de
--                          outra pessoa, portal com login, link que não abriu.
--                          É pedido de acesso, não é procurar.
--   `nunca_apareceu`     — nenhuma fonte jamais trouxe documento desse
--                          fornecedor. É cobrança ao fornecedor.
--
-- A ORDEM DA CLASSIFICAÇÃO É A ORDEM DA CERTEZA, e por isso é `case` e não
-- pontuação: um título com nota pronta E candidata ambígua está pronto, não
-- ambíguo. O primeiro ramo que acerta responde.
--
-- ---------------------------------------------------------------------------
-- `nota_fonte_bloqueada` É O QUE FAZ `achou_mas_nao_abre` EXISTIR
--
-- Sem cadastro, esse estágio seria indistinguível de "nunca apareceu" — e a
-- diferença entre os dois é enorme: um se resolve com um pedido de acesso, o
-- outro com uma cobrança ao fornecedor. O que se sabe hoje, medido:
--
--   • FLASH APP — 17 títulos, R$ 115.942. As notas vão para o e-mail do Miguel,
--     e `financeiro@` tem ZERO mensagem do Flash. O Hub não tem como achar.
--   • BRASCOMM / CAFEPONTOEXPRES — o e-mail traz link de RASTREIO
--     (mt-link.brascomm.net.br) para um portal, e a nota só se baixa clicando lá
--     dentro. Testado: o link responde 404 depois de usado, é de uso único —
--     então nem seguir o redirect resolveria.
--
-- É cadastro e não código de propósito: cada linha aqui é um pedido de acesso
-- em aberto, e some quando o acesso chega.

create table if not exists public.nota_fonte_bloqueada (
  id           bigserial primary key,
  padrao_nome  text not null,
  motivo       text not null,
  acao         text not null,
  resolvido_em timestamptz,
  criado_em    timestamptz not null default now()
);

comment on table public.nota_fonte_bloqueada is
  'Fornecedores cuja nota EXISTE mas o Hub não alcança — caixa de outra pessoa, portal com login, link que não é arquivo. Sem isto, "não consigo pegar" e "não existe" ficam no mesmo balde, e são trabalhos opostos: um é pedido de acesso, o outro é cobrança ao fornecedor.';

alter table public.nota_fonte_bloqueada enable row level security;
drop policy if exists nota_fonte_bloqueada_rw on public.nota_fonte_bloqueada;
create policy nota_fonte_bloqueada_rw on public.nota_fonte_bloqueada
  for all to authenticated using (true) with check (true);

insert into public.nota_fonte_bloqueada (padrao_nome, motivo, acao)
select * from (values
  ('flash', 'As notas do Flash vão para o e-mail do Miguel. A caixa financeiro@ não tem nenhuma mensagem deles — medido em 27/08/2026.',
            'Criar no Gmail do Miguel uma regra que encaminhe remetentes @flashapp.com.br para financeiro@. A esteira pega sozinha a partir daí, sem código novo. Alternativa: verificar se o Flash tem API de faturas.'),
  ('brascomm', 'O e-mail da Brascomm traz um link de RASTREIO (mt-link.brascomm.net.br) que redireciona para um portal, e não para o arquivo. Testado em 27/08/2026: o link responde 404 depois de usado — é de uso único. Nem o link do e-mail nem o do portal servem para automação; a nota só se baixa clicando dentro do portal.',
               'Pedir à Brascomm o envio da nota EM ANEXO no próprio e-mail (é o que a esteira já lê sozinha), ou um link direto e estável para o PDF. Enquanto isso: abrir o portal, baixar a nota e anexá-la pelo clipe na aba Títulos — um clique, e ela se espalha para as outras listas e sobe ao Omie.'),
  ('cafepontoexpres', 'Mesma origem da Brascomm: link de rastreio de uso único apontando para um portal.',
               'Pedir à Brascomm o envio da nota em anexo. Enquanto isso, baixar pelo portal e anexar pelo clipe na aba Títulos.'),
  ('cafe.express', 'Mesma origem da Brascomm: link de rastreio de uso único apontando para um portal.',
               'Pedir à Brascomm o envio da nota em anexo. Enquanto isso, baixar pelo portal e anexar pelo clipe na aba Títulos.')
) v(padrao_nome, motivo, acao)
where not exists (select 1 from public.nota_fonte_bloqueada b where b.padrao_nome = v.padrao_nome);

/* A regra do recibo de app vive em `_shared/anexo-triagem.ts` (é lá que a
   triagem decide). Aqui ela precisa existir em SQL para o diagnóstico contar o
   mesmo grupo — duas listas divergiriam no primeiro fornecedor novo, então o
   comentário em cada lado aponta para o outro. */
create or replace function public.aceita_recibo_do_app(nome text)
returns boolean
language sql
immutable
as $$
  select coalesce(nome, '') ~* '\muber\M|uberrides|^99[ *]|\m99 ?\(app\)|99app|cabify|indriver';
$$;

comment on function public.aceita_recibo_do_app(text) is
  'Uber, 99 e afins não emitem nota por corrida — o recibo do app É o documento. Gêmeo em SQL de ACEITA_RECIBO em `_shared/anexo-triagem.ts`: mexeu num, mexa no outro.';

/* ============================================================================
 *  O diagnóstico
 * ========================================================================== */

create or replace function public.cap_notas_diagnostico(
  p_de date default null,
  p_ate date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
        from public.notas_externas where ignorado_em is null and copia_de is null)
  ) into v;

  return v;
end;
$$;

revoke all on function public.cap_notas_diagnostico(date, date) from public, anon;
grant execute on function public.cap_notas_diagnostico(date, date) to authenticated, service_role;

comment on function public.cap_notas_diagnostico(date, date) is
  'Classifica cada título que falta nota pelo ESTÁGIO em que a falta está — e não pelo valor. Cobrar o fornecedor, clicar em confirmar, pedir acesso a uma caixa e aceitar que a nota não existe são quatro trabalhos diferentes; sem isto estavam no mesmo balde. O sinal é todo daqui; a IA só redige por cima (ver `notas-diagnostico`).';

/* ============================================================================
 *  O texto que a IA escreve fica guardado
 *
 *  Regerar a cada abertura da aba custaria uma chamada por olhada e faria o
 *  texto mudar de palavra sem o dado ter mudado — o que destrói a confiança de
 *  quem lê duas vezes. Guarda-se, e regera quando alguém pede.
 * ========================================================================== */

create table if not exists public.cap_notas_diagnostico_texto (
  id         bigserial primary key,
  de         date,
  ate        date,
  resumo     text not null,
  planos     jsonb not null default '[]'::jsonb,
  sinal      jsonb not null,
  modelo     text,
  gerado_em  timestamptz not null default now(),
  gerado_por uuid
);

create index if not exists cap_notas_diag_texto_idx
  on public.cap_notas_diagnostico_texto (gerado_em desc);

alter table public.cap_notas_diagnostico_texto enable row level security;
drop policy if exists cap_notas_diag_texto_rw on public.cap_notas_diagnostico_texto;
create policy cap_notas_diag_texto_rw on public.cap_notas_diagnostico_texto
  for all to authenticated using (true) with check (true);

comment on table public.cap_notas_diagnostico_texto is
  'O resumo redigido pela IA sobre o diagnóstico, com o SINAL que o gerou junto. Guardar o sinal é o que permite conferir depois se o texto ainda descreve a realidade — e é o que impede a discussão "a IA inventou isso".';

/* ============================================================================
 *  O diagnóstico da manhã
 *
 *  Escrever só quando alguém pede é esperar que alguém lembre. Às 10h UTC (7h
 *  de Brasília) o texto do dia já está lá quando a aba abre — e o custo é uma
 *  chamada por dia, não uma por olhada.
 * ========================================================================== */

insert into public.internal_cron_tokens (name, token)
values ('notas-diagnostico', encode(gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

select cron.unschedule('notas-diagnostico-manha')
 where exists (select 1 from cron.job where jobname = 'notas-diagnostico-manha');

select cron.schedule('notas-diagnostico-manha', '0 10 * * *', $cron$
  select net.http_post(
    url := 'https://lgcxyxyidoirqmbdlldh.supabase.co/functions/v1/notas-diagnostico',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select token from public.internal_cron_tokens where name = 'notas-diagnostico')
    ),
    body := '{"action":"gerar"}'::jsonb
  );
$cron$);
