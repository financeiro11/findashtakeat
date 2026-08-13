import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  montarMapaApelidos, chaveContraparte, soDigitos, MIN_CHAVE,
  MAPA_APELIDOS_VAZIO, type MapaApelidos,
} from "@/lib/apelidos";

/* ---------------------------------------------------------------------------
 * O cadastro de apelidos, carregado uma vez e compartilhado.
 *
 * Cache em nível de módulo com aviso aos inscritos — mesmo desenho do
 * `usePessoasPJ`, e pelo mesmo motivo: o drill-down da DRE tem dezenas de linhas
 * e cada uma precisa do mapa para saber que nome escrever. Uma busca por linha
 * seria uma rajada de requisições idênticas, e linhas vizinhas mostrariam nomes
 * diferentes enquanto as respostas chegam fora de ordem.
 *
 * Guarda o cadastro INTEIRO, não só quem já tem apelido: `salvarApelido` precisa
 * dos sem apelido para achar o fornecedor que já existe em vez de criar um
 * segundo com o mesmo CNPJ.
 * ------------------------------------------------------------------------- */

/* `types.ts` é gerado pelo Supabase CLI e ainda não conhece as colunas criadas
   na migration 20260812200000 (apelido, o_que_e, dono_id, origem) nem as RPCs.
   Mesmo atalho das justificativas e das perguntas — some quando os tipos forem
   regerados. */
const db = supabase as unknown as {
  from: (tabela: string) => any;
  rpc: (nome: string, args?: Record<string, unknown>) => any;
};

export type FornecedorCadastro = {
  id: string;
  nome: string;
  documento: string | null;
  apelido: string | null;
  o_que_e: string | null;
  dono_id: string | null;
  origem: string | null;
  categoria: string | null;
};

export type Grafia = { id: string; fornecedor_id: string; alias: string; fonte: string | null };

let _cadastro: FornecedorCadastro[] | null = null;
let _grafias: Grafia[] = [];
let _mapa: MapaApelidos | null = null;
let _carregando: Promise<void> | null = null;
const _inscritos = new Set<() => void>();

const avisar = () => { for (const fn of _inscritos) fn(); };

function remontar() {
  const comApelido = (_cadastro ?? [])
    .filter((f) => (f.apelido ?? "").trim())
    .map((f) => ({
      id: f.id,
      nome: f.nome,
      apelido: f.apelido as string,
      oQueE: f.o_que_e,
      documento: f.documento,
      origem: f.origem,
    }));
  _mapa = montarMapaApelidos(comApelido, _grafias);
}

async function buscar(): Promise<void> {
  const [cad, ali] = await Promise.all([
    db.from("lib_fornecedores").select("id,nome,documento,apelido,o_que_e,dono_id,origem,categoria").order("nome"),
    db.from("contrapartes_alias").select("id,fornecedor_id,alias,fonte"),
  ]);

  if (cad.error) {
    // Acessório: sem o cadastro a tela mostra os nomes como sempre mostrou.
    // Nunca derruba a grade da DRE.
    _cadastro = [];
    _grafias = [];
    _mapa = MAPA_APELIDOS_VAZIO;
    return;
  }

  _cadastro = (cad.data ?? []) as FornecedorCadastro[];
  _grafias = (ali.error ? [] : (ali.data ?? [])) as Grafia[];
  remontar();
}

function garantirCarga(): Promise<void> {
  if (_mapa) return Promise.resolve();
  if (!_carregando) {
    _carregando = buscar().finally(() => { _carregando = null; avisar(); });
  }
  return _carregando;
}

export async function recarregarApelidos(): Promise<void> {
  _mapa = null;
  _cadastro = null;
  await garantirCarga();
}

/** Redesenha este componente quando o cadastro muda. */
function useInscricao(): void {
  const [, forcar] = useState(0);
  useEffect(() => {
    const fn = () => forcar((n) => n + 1);
    _inscritos.add(fn);
    garantirCarga();
    return () => { _inscritos.delete(fn); };
  }, []);
}

/** O mapa para exibir. Devolve o vazio enquanto a primeira carga não volta. */
export function useApelidos(): MapaApelidos {
  useInscricao();
  return _mapa ?? MAPA_APELIDOS_VAZIO;
}

/** O cadastro cru, para a página de Parametrização. */
export function useApelidosCadastro(): {
  cadastro: FornecedorCadastro[];
  grafias: Grafia[];
  carregado: boolean;
  recarregar: () => Promise<void>;
} {
  useInscricao();
  return {
    cadastro: _cadastro ?? [],
    grafias: _grafias,
    carregado: _cadastro !== null,
    recarregar: recarregarApelidos,
  };
}

/** Acha o cadastro que já corresponde a este nome/documento, se houver. */
function acharExistente(nome: string, documento?: string | null): FornecedorCadastro | null {
  const doc = soDigitos(documento);
  if (doc.length >= 11) {
    const porDoc = (_cadastro ?? []).find((f) => soDigitos(f.documento) === doc);
    if (porDoc) return porDoc;
  }

  const chave = chaveContraparte(nome);
  if (chave.length < MIN_CHAVE) return null;

  const porNome = (_cadastro ?? []).find((f) => chaveContraparte(f.nome) === chave);
  if (porNome) return porNome;

  // Pela grafia alternativa: é o que evita pedir apelido de novo para o mesmo
  // fornecedor só porque o extrato o cortou em 20 caracteres desta vez.
  const grafia = _grafias.find((g) => chaveContraparte(g.alias) === chave);
  return grafia ? (_cadastro ?? []).find((f) => f.id === grafia.fornecedor_id) ?? null : null;
}

export type CamposApelido = {
  apelido: string;
  oQueE?: string | null;
  donoId?: string | null;
  documento?: string | null;
  categoria?: string | null;
  origem?: string | null;
};

/**
 * Dá nome a uma contraparte — criando o cadastro se ela ainda não tem um.
 *
 * A busca pelo existente acontece AQUI, no cliente, com a mesma chave
 * normalizada que a exibição usa. O gatilho da view `contrapartes_pessoas` faz
 * uma busca mais grosseira (nome exato) porque lá não há como chamar o
 * normalizador do TS — esta é a porta boa.
 */
export async function salvarApelido(
  nome: string,
  campos: CamposApelido,
): Promise<{ error: string | null }> {
  const n = String(nome ?? "").trim();
  const apelido = String(campos?.apelido ?? "").trim();

  if (chaveContraparte(n).length < MIN_CHAVE) {
    return { error: "Esse nome é curto demais para casar com segurança. Junte-o a uma contraparte que já existe." };
  }
  if (apelido.length < 2) return { error: "Escreva o apelido." };

  await garantirCarga();
  const existente = acharExistente(n, campos.documento);

  const valores = {
    apelido,
    o_que_e: campos.oQueE?.trim() || null,
    dono_id: campos.donoId || null,
    atualizado_em: new Date().toISOString(),
  };

  if (existente) {
    const { error } = await db.from("lib_fornecedores").update(valores).eq("id", existente.id);
    if (error) return { error: error.message };

    // Nome diferente do canônico vira grafia do mesmo cadastro, para o apelido
    // valer nas duas formas sem pedir cadastro de novo.
    if (chaveContraparte(existente.nome) !== chaveContraparte(n)
      && !_grafias.some((g) => g.fornecedor_id === existente.id && chaveContraparte(g.alias) === chaveContraparte(n))) {
      await db.from("contrapartes_alias").insert({
        fornecedor_id: existente.id,
        alias: n,
        fonte: campos.origem ?? "manual",
        documento_norm: soDigitos(campos.documento) || null,
        origem: "manual",
      });
    }
  } else {
    const { error } = await db.from("lib_fornecedores").insert({
      nome: n,
      documento: campos.documento?.trim() || null,
      categoria: campos.categoria?.trim() || null,
      origem: campos.origem ?? "manual",
      ...valores,
    });
    if (error) return { error: error.message };
  }

  await recarregarApelidos();
  return { error: null };
}

/** Tira o apelido — o fornecedor continua no cadastro. */
export async function removerApelido(id: string): Promise<{ error: string | null }> {
  const { error } = await db.from("lib_fornecedores")
    .update({ apelido: null, o_que_e: null, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  await recarregarApelidos();
  return { error: null };
}

/**
 * Junta uma grafia solta a um cadastro que já existe.
 *
 * É o conserto dos 41 lojistas que o extrato entrega cortados em exatos 20
 * caracteres e dos que viram só "DE", "DM", "MERC" — nomes curtos demais para
 * ganhar apelido próprio, mas que são alguém conhecido.
 */
export async function juntarGrafia(
  fornecedorId: string,
  alias: string,
  fonte = "manual",
): Promise<{ error: string | null }> {
  const a = String(alias ?? "").trim();
  if (!a) return { error: "Sem grafia para juntar." };
  if (!fornecedorId) return { error: "Escolha a contraparte de destino." };

  await garantirCarga();
  if (_grafias.some((g) => g.fornecedor_id === fornecedorId && chaveContraparte(g.alias) === chaveContraparte(a))) {
    return { error: null }; // já está junto; repetir o gesto não é erro
  }

  const { error } = await db.from("contrapartes_alias").insert({
    fornecedor_id: fornecedorId, alias: a, fonte, origem: "manual",
  });
  if (error) return { error: error.message };

  await recarregarApelidos();
  return { error: null };
}

/**
 * "Isto não é fornecedor" — some da fila e do denominador da cobertura.
 *
 * As regras da RPC já tiram transferência entre contas próprias, pagamento de
 * fatura e tarifa de cartão. Isto é para o que escapar: sem uma saída, uma linha
 * que ninguém vai nomear fica no topo para sempre e a barra nunca fecha.
 */
export async function ignorarContraparte(
  nome: string,
  extras?: { documento?: string | null; origem?: string | null },
): Promise<{ error: string | null }> {
  const n = String(nome ?? "").trim();
  if (!n) return { error: "Sem contraparte." };

  await garantirCarga();
  const existente = acharExistente(n, extras?.documento);

  const { error } = existente
    ? await db.from("lib_fornecedores")
        .update({ status: "ignorado", atualizado_em: new Date().toISOString() })
        .eq("id", existente.id)
    : await db.from("lib_fornecedores").insert({
        nome: n,
        documento: extras?.documento?.trim() || null,
        origem: extras?.origem ?? "manual",
        status: "ignorado",
      });

  if (error) return { error: error.message };
  await recarregarApelidos();
  return { error: null };
}

export async function desfazerGrafia(id: string): Promise<{ error: string | null }> {
  const { error } = await db.from("contrapartes_alias").delete().eq("id", id);
  if (error) return { error: error.message };
  await recarregarApelidos();
  return { error: null };
}
