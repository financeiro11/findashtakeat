-- "Achada — falta você confirmar" era um beco sem saída.
--
-- O quadro dizia, em cima de 5 títulos e R$ 49.438: *um clique resolve*. Só que
-- o clique não resolvia nada — e nem chegava a mentir, porque não existia botão
-- na tela onde a frase estava escrita. Quem achasse o botão na aba "Acervo de
-- notas" recebia "confirmado, o cron das :30 leva ao ERP" e o cron nunca levava.
--
-- O MOTIVO É ESTA FUNÇÃO. `notas_externas_enfileirar` exige `parece_nota`, e os
-- cinco documentos daquela tela são um boleto (Flash App), um recibo (Café -
-- Sede), uma "fatura23295" (IEVENTO) e dois PDFs que o leitor ainda não abriu
-- (Baptista Luz, R$ 48.000; CAPTIONS.AI). Nenhum passa pela porta. A pessoa
-- confirmava, o `alvo_manual` era carimbado, e a linha ficava em
-- `espera_confirmacao` para sempre — sem erro, sem fila, sem aviso.
--
-- ---------------------------------------------------------------------------
-- A GUARDA CONTINUA, MAS DEIXA DE VALER CONTRA GENTE
--
-- `parece_nota` existe por um motivo bom, e ele não muda: "Notas no ERP" mede
-- NOTA, e anexar um boleto onde se cobra nota fiscal faz o título sumir da lista
-- de cobrança como se tivesse respondido ao contador. A guarda foi escrita para
-- impedir que a MÁQUINA fizesse isso sozinha, e nesse papel ela fica inteira:
-- casamento por CNPJ, por valor, por nome — nada disso enfileira um boleto.
--
-- O que ela não pode fazer é impedir uma PESSOA. Quem confirma está com o
-- documento aberto no visor, ao lado da linha que o cobra, e o palpite de
-- `parece_nota` sai do nome do arquivo — literalmente da palavra escrita no
-- ".pdf". Entre "o nome do arquivo não diz nota" e "alguém olhou e disse que é",
-- a segunda afirmação é melhor. `alvo_manual` é exatamente o carimbo de que
-- houve alguém, e é ele que passa a valer.
--
-- Sem retroatividade: as 15 linhas que hoje esperam a fila têm `alvo_manual` em
-- `false`, então nada entra sozinho por causa desta migração. A porta continua
-- fechada até um clique de gente abrir.

create or replace function public.notas_externas_enfileirar(p_ids bigint[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_n integer;
begin
  update public.notas_externas
     set fila_erp = true, erro_erp = null, atualizado_em = now()
   where id = any(p_ids)
     and enviado_erp_em is null
     and ignorado_em is null
     and alvo_tipo is not null
     and conferencia in ('falta_anexar', 'promessa_falsa')
     and tem_arquivo
     and copia_de is null
     /* A GUARDA DO PAPEL, e a exceção de quem olhou.
        `parece_nota` sai do nome do arquivo e impede a máquina de anexar boleto,
        recibo ou logotipo onde se cobra nota fiscal — some da cobrança como se
        tivesse respondido. Contra `alvo_manual` ela não vale: esse carimbo só
        existe quando alguém abriu o documento no visor, ao lado da linha, e
        disse que é este. Ver o cabeçalho desta migração. */
     and (parece_nota or alvo_manual);
  get diagnostics v_n = row_count;

  update public.auditoria_cartao_lancamentos a
     set status_nf = 'OK',
         link_comprovante = nt.link,
         arquivo_comprovante = coalesce(a.arquivo_comprovante, nt.fonte || coalesce(' · linha ' || nt.linha, '')),
         updated_at = now()
    from public.notas_externas nt
   where nt.id = any(p_ids)
     and nt.alvo_tipo = 'cartao'
     and nt.tem_arquivo and (nt.parece_nota or nt.alvo_manual)
     and a.id_unico = nt.alvo_id_unico
     and coalesce(a.status_nf, '') <> 'OK'
     and coalesce(a.link_comprovante, '') = '';

  return v_n;
end;
$function$;
