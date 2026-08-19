-- Conferência do comprovante pela IA (auditoria-conferir-comprovante).
--
-- O que a leitura de um documento deixa gravado na linha do achado: a
-- transcrição inteira (para a tela mostrar emitente, total e as linhas sem
-- reabrir o PDF) e o veredito da regra, que é quem decide a aprovação.
--
-- `ia_arquivo` guarda QUAL comprovante foi lido. É ele que impede uma aprovação
-- de valer para um arquivo trocado depois da conferência: se
-- `ia_arquivo <> link_comprovante`, a leitura está velha e o achado volta para a
-- fila em vez de ser aprovado com o veredito antigo.

alter table public.auditoria
  add column if not exists ia_leitura      jsonb,
  add column if not exists ia_veredito     text,
  add column if not exists ia_motivo       text,
  add column if not exists ia_conferido_em timestamptz,
  add column if not exists ia_arquivo      text,
  add column if not exists ia_aprovado_em  timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'auditoria_ia_veredito_check' and conrelid = 'public.auditoria'::regclass
  ) then
    alter table public.auditoria
      add constraint auditoria_ia_veredito_check
      check (ia_veredito is null or ia_veredito in ('aprovar', 'revisar'));
  end if;
end $$;

comment on column public.auditoria.ia_leitura      is 'Transcrição do comprovante feita pela IA (emitente, total, linhas, datas) + o ponteiro dela.';
comment on column public.auditoria.ia_veredito     is 'aprovar | revisar — decidido pela regra em _shared/conferencia-comprovante.ts, não pela IA.';
comment on column public.auditoria.ia_motivo       is 'A frase que a tela mostra explicando o veredito.';
comment on column public.auditoria.ia_conferido_em is 'Quando o comprovante foi lido.';
comment on column public.auditoria.ia_arquivo      is 'O link_comprovante que foi lido; se mudou, a leitura está velha.';
comment on column public.auditoria.ia_aprovado_em  is 'Quando a aprovação automática foi aplicada.';

-- A fila da conferência: achados abertos, com comprovante e ainda sem leitura.
create index if not exists auditoria_ia_fila_idx
  on public.auditoria (competencia, ia_veredito)
  where link_comprovante is not null;
