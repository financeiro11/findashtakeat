import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/* ---------------------------------------------------------------------------
 * Quem é o CPF/CNPJ que o extrato mandou.
 *
 * O `useApelidos` já traz o cadastro da Parametrização inteiro para a memória —
 * são ~300 linhas e cabe. O cadastro do OMIE tem ~7.000 e mora dentro de um
 * jsonb em `omie_cache`, tabela com RLS ligado e nenhuma policy: um select da
 * tela volta VAZIO, sem erro. Por isso este hook não lê tabela nenhuma; ele
 * pergunta pelos documentos que estão na tela à RPC `contrapartes_por_documento`
 * (security definer, migration 20260825160000), que responde pelos três
 * cadastros na ordem apelido > cadastro local > Omie.
 *
 * Pergunta pelos documentos DA TELA e não pelo dicionário inteiro porque um mês
 * de extrato tem ~170 documentos distintos contra 7.000 cadastros — trazer o
 * dicionário seria carregar 40× o necessário a cada visita.
 *
 * Cache em nível de módulo, mesmo desenho do `useApelidos`: trocar de banco, de
 * filtro ou de página não repergunta o que já se sabe. O `null` é resposta
 * legítima ("perguntei, o cadastro não conhece") e evita reperguntar a cada
 * render por quem não está em lugar nenhum.
 * ------------------------------------------------------------------------- */

export type FonteNome = "apelido" | "cadastro" | "omie";

export type NomeContraparte = {
  nome: string;
  /** De onde veio: apelido da Parametrização, razão social do cadastro local, ou o Omie. */
  fonte: FonteNome;
  /** true quando o casamento foi pelos seis dígitos de um CPF mascarado. */
  aproximado: boolean;
};

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a RPC. Mesmo atalho
   do `useApelidos` — some quando os tipos forem regerados. */
const db = supabase as unknown as {
  rpc: (nome: string, args?: Record<string, unknown>) => any;
};

const _cache = new Map<string, NomeContraparte | null>();
const _pedidos = new Set<string>();
const _inscritos = new Set<() => void>();

const avisar = () => { for (const fn of _inscritos) fn(); };

/** Em lotes: um mês de extrato cabe num pedido só, um ano não. */
const LOTE = 400;

/** Separador da chave de dependência do hook. Documento nenhum tem barra vertical. */
const SEP = "|";

async function perguntar(docs: string[]): Promise<void> {
  for (const d of docs) _pedidos.add(d);
  try {
    for (let i = 0; i < docs.length; i += LOTE) {
      const fatia = docs.slice(i, i + LOTE);
      // Acessório: sem a RPC a tela mostra os nomes que o cadastro local já sabe.
      // Nunca derruba o extrato — e devolver os documentos à fila deixa a próxima
      // montagem tentar de novo, em vez de congelar o "não sei" para sempre.
      // O try envolve a chamada porque quem pergunta é um efeito: uma rejeição
      // solta aqui vira erro não tratado no console e não conserta nada.
      let data: unknown = null;
      try {
        const r = await db.rpc("contrapartes_por_documento", { p_docs: fatia });
        if (r?.error) throw new Error(r.error.message);
        data = r?.data;
      } catch {
        for (const d of fatia) _pedidos.delete(d);
        continue;
      }
      for (const d of fatia) _cache.set(d, null);
      for (const r of (data ?? []) as { doc: string; nome: string; fonte: FonteNome; aproximado: boolean }[]) {
        if (r?.doc && r?.nome) {
          _cache.set(r.doc, { nome: r.nome, fonte: r.fonte, aproximado: !!r.aproximado });
        }
      }
    }
  } finally {
    avisar();
  }
}

/**
 * O mapa `documento -> nome` dos documentos pedidos. Devolve o que já se sabe e
 * redesenha quando o resto chega.
 *
 * Os documentos entram COMO ESTÃO NA TELA (já formatados por `fmtDocumento`) e
 * voltam com a mesma grafia: a normalização acontece no Postgres, e assim não há
 * um segundo normalizador aqui para divergir do de lá.
 */
export function useNomesContraparte(
  docs: (string | null | undefined)[],
): Map<string, NomeContraparte> {
  /* Uma STRING como dependência, e não o array: a lista é recalculada a cada
     render da tela, e um array novo com o mesmo conteúdo dispararia um pedido
     por render. `|` como separador porque documento nenhum tem barra vertical. */
  const chave = useMemo(
    () => [...new Set(docs.filter((d): d is string => !!d && d.trim() !== ""))].sort().join(SEP),
    [docs],
  );

  const [versao, forcar] = useState(0);
  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    _inscritos.add(fn);
    return () => { _inscritos.delete(fn); };
  }, []);

  useEffect(() => {
    const pedidos = chave ? chave.split(SEP) : [];
    const faltando = pedidos.filter((d) => !_cache.has(d) && !_pedidos.has(d));
    if (faltando.length) perguntar(faltando);
  }, [chave]);

  return useMemo(() => {
    const m = new Map<string, NomeContraparte>();
    for (const d of chave ? chave.split(SEP) : []) {
      const achado = _cache.get(d);
      if (achado) m.set(d, achado);
    }
    return m;
    // `versao` está na lista de propósito: é o aviso de que o cache mudou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, versao]);
}
