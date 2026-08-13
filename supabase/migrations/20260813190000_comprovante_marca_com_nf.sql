-- O comprovante do Drive tira o lançamento do "SEM NF".
--
-- A auditoria do cartão já tinha a máquina inteira (`auditoria-anexar-comprovante`
-- sobe para o bucket, marca `status_nf='OK'` e o `omie-anexar-comprovante` empurra
-- para o ERP). O que faltava era alguém dizer que o comprovante JÁ EXISTE — ele
-- está no Drive desde que a pessoa mandou a foto no grupo.
--
-- POR QUE GATILHO E NÃO DENTRO DA EDGE FUNCTION: a marcação depende só do que
-- acabou de ser gravado em `comprovantes_drive`, e um gatilho não precisa de
-- redeploy nem de uma segunda passada. Se amanhã o comprovante vier por outro
-- caminho (upload na tela, e-mail), a regra continua valendo sozinha.
--
-- ATÉ ONDE ELE VAI, e nada além:
--   • marca `status_nf = 'OK'` e escreve o link do Drive;
--   • NÃO manda o anexo para o Omie. Casamento por valor+data é forte mas não é
--     identidade, e anexo no ERP é difícil de desfazer — isso continua sendo um
--     clique da pessoa, na tela da auditoria.
--   • NÃO toca em quem já tem comprovante: o que alguém anexou à mão vale mais.

create or replace function public.comprovante_marca_com_nf()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link text;
begin
  -- Só age quando o comprovante ficou de fato casado com uma linha da fatura.
  if new.casamento is null or new.cartao_data is null or new.cartao_valor is null then
    return new;
  end if;

  v_link := 'https://drive.google.com/file/d/' || new.drive_id || '/view';

  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = v_link,
         arquivo_comprovante = new.nome_arquivo,
         updated_at = now()
   where a.data = new.cartao_data
     and abs(abs(a.valor) - new.cartao_valor) < 0.02
     -- O memo é o desempate: sem ele, dois gastos de mesmo valor no mesmo dia
     -- receberiam o mesmo comprovante.
     and (new.cartao_descricao is null or a.descricao_original = new.cartao_descricao)
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return new;
end;
$$;

comment on function public.comprovante_marca_com_nf() is
  'Comprovante casado tira o lançamento do SEM NF e guarda o link do Drive. Não envia anexo ao Omie — isso continua sendo um clique da pessoa.';

drop trigger if exists comprovante_marca_com_nf_trg on public.comprovantes_drive;

create trigger comprovante_marca_com_nf_trg
  after insert or update of casamento, cartao_data, cartao_valor
  on public.comprovantes_drive
  for each row execute function public.comprovante_marca_com_nf();

revoke all on function public.comprovante_marca_com_nf() from public, anon;
