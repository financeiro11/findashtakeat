-- ============================================================
-- CARGA 5 - Vinculo agentes <-> automacoes_catalogo (item 19)
--           + limpeza de entidade HTML remanescente
-- ============================================================

update public.agentes a set automacao_id = c.id
from public.automacoes_catalogo c
where a.automacao_id is null and (
     (a.id = 'thetys'       and c.automacao = 'Thétys - Tesouria e CAP')
  or (a.id = 'fechamento'   and c.automacao = 'Agente de Fechamento Mensal')
  or (a.id = 'fpa'          and c.automacao = 'Agente de FP&A')
  or (a.id = 'edi'          and c.automacao = 'Edi - Agente de Editais')
  or (a.id = 'orquestrador' and c.automacao = 'Orquestrador')
);

-- &apos; sobrou da decodificacao de entidades HTML vindas do Omie
update public.lib_fornecedores
   set nome = replace(nome, '&apos;', '''')
 where nome like '%&apos;%';

update public.contrapartes_alias
   set alias = replace(alias, '&apos;', '''')
 where alias like '%&apos;%';

update public.omie_titulos
   set favorecido_texto = replace(favorecido_texto, '&apos;', '''')
 where favorecido_texto like '%&apos;%';;
