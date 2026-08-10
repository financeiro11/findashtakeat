import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  montarMapaPessoas, chavePessoa, MAPA_VAZIO, MIN_CHAVE,
  type MapaPessoas, type PessoaPJ,
} from "@/lib/pessoasPJ";

/* ---------------------------------------------------------------------------
 * O de-para "razão social -> pessoa" carregado uma vez e compartilhado.
 *
 * Cache em nível de módulo com aviso aos inscritos, como o `LibAutofillInput`
 * faz com colaboradores e fornecedores: a DRE tem dezenas de balões na tela e
 * cada um precisa do mapa para renderizar. Uma busca por balão seria uma rajada
 * de requisições idênticas — e, pior, balões vizinhos mostrando nomes diferentes
 * enquanto as respostas chegam fora de ordem.
 *
 * Cadastrar um nome pelo balão chama `salvarPessoaPJ`, que atualiza o cache e
 * avisa todo mundo: o nome novo aparece na hora em TODOS os comentários da grade,
 * sem recarregar a página e sem regerar nada.
 * ------------------------------------------------------------------------- */

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece a tabela criada na
   migration 20260811140000. Mesmo atalho das justificativas e das perguntas —
   some quando os tipos forem regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => any;
};

let _mapa: MapaPessoas | null = null;
let _linhas: PessoaPJ[] = [];
let _carregando: Promise<void> | null = null;
const _inscritos = new Set<() => void>();

const avisar = () => { for (const fn of _inscritos) fn(); };

async function buscar(): Promise<void> {
  const { data, error } = await db
    .from("contrapartes_pessoas")
    .select("id,nome,pessoa,documento,observacao,status")
    .eq("status", "ativo")
    .order("nome");
  if (error) {
    // Acessório: sem o de-para os comentários aparecem como estão gravados, com
    // a razão social. Nunca derruba a grade.
    _mapa = MAPA_VAZIO;
    _linhas = [];
    return;
  }
  _linhas = (data ?? []) as PessoaPJ[];
  _mapa = montarMapaPessoas(_linhas);
}

/** Carrega no máximo uma vez, mesmo com N componentes pedindo ao mesmo tempo. */
function garantirCarga(): Promise<void> {
  if (_mapa) return Promise.resolve();
  if (!_carregando) {
    _carregando = buscar().finally(() => { _carregando = null; avisar(); });
  }
  return _carregando;
}

export async function recarregarPessoasPJ(): Promise<void> {
  _mapa = null;
  await garantirCarga();
}

/** O mapa para exibir. Devolve o vazio enquanto a primeira carga não volta. */
export function usePessoasPJ(): MapaPessoas {
  const [, forcar] = useState(0);

  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    _inscritos.add(fn);
    garantirCarga();
    return () => { _inscritos.delete(fn); };
  }, []);

  return _mapa ?? MAPA_VAZIO;
}

/** A lista crua, para a tela de gestão na Biblioteca. */
export function usePessoasPJLista(): { linhas: PessoaPJ[]; recarregar: () => Promise<void> } {
  const [, forcar] = useState(0);

  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    _inscritos.add(fn);
    garantirCarga();
    return () => { _inscritos.delete(fn); };
  }, []);

  return { linhas: _linhas, recarregar: recarregarPessoasPJ };
}

/**
 * Cadastra — ou corrige, se aquela grafia já tem dono.
 *
 * Reescrever é o gesto natural de quem cadastrou "Dalber" e quis "Dalber Souza":
 * um erro de chave duplicada no meio da leitura do comentário não explicaria isso.
 *
 * A linha existente é procurada no cache que já está em memória, pela MESMA chave
 * normalizada que o índice único usa. Não dá para pedir `upsert` ao PostgREST
 * aqui: o índice é sobre uma expressão (`upper(btrim(...))`), e `onConflict` só
 * aceita coluna.
 */
export async function salvarPessoaPJ(
  nome: string,
  pessoa: string,
  extras?: { documento?: string | null; observacao?: string | null },
): Promise<{ error: string | null }> {
  const n = nome.trim();
  const p = pessoa.trim();
  if (chavePessoa(n).length < MIN_CHAVE) {
    return { error: "Essa razão social é curta demais para casar com segurança no texto." };
  }
  if (p.length < 2) return { error: "Escreva o nome da pessoa." };

  await garantirCarga();
  const chave = chavePessoa(n);
  const existente = _linhas.find((l) => chavePessoa(l.nome) === chave);

  const campos = {
    nome: n,
    pessoa: p,
    documento: extras?.documento ?? null,
    observacao: extras?.observacao ?? null,
    status: "ativo",
  };

  const { error } = existente?.id
    ? await db.from("contrapartes_pessoas").update(campos).eq("id", existente.id)
    : await db.from("contrapartes_pessoas").insert(campos);
  if (error) return { error: error.message };

  await recarregarPessoasPJ();
  return { error: null };
}

export async function removerPessoaPJ(id: string): Promise<{ error: string | null }> {
  const { error } = await db.from("contrapartes_pessoas").delete().eq("id", id);
  if (error) return { error: error.message };
  await recarregarPessoasPJ();
  return { error: null };
}
