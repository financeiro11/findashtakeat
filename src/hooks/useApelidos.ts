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

/** Quem está nomeando. `null` não impede gravar — a Base escreve "—". */
async function quemSou(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export type FornecedorCadastro = {
  id: string;
  nome: string;
  documento: string | null;
  apelido: string | null;
  o_que_e: string | null;
  dono_id: string | null;
  origem: string | null;
  categoria: string | null;
  /* Quem nomeou e quando — a coluna "Quem nomeou" da Base. `apelido_em` é
     separado de `atualizado_em` de propósito: o sync do Omie mexe no segundo, e
     a Base passaria a dizer que todo mundo foi nomeado hoje de manhã. */
  apelido_por: string | null;
  apelido_em: string | null;
  revisar: boolean;
};

const COLUNAS_CADASTRO =
  "id,nome,documento,apelido,o_que_e,dono_id,origem,categoria,apelido_por,apelido_em,revisar";

export type Grafia = { id: string; fornecedor_id: string; alias: string; fonte: string | null };

let _cadastro: FornecedorCadastro[] | null = null;
let _grafias: Grafia[] = [];
let _mapa: MapaApelidos | null = null;
let _carregando: Promise<void> | null = null;
const _inscritos = new Set<() => void>();

const avisar = () => { for (const fn of _inscritos) fn(); };

/* O cadastro INTEIRO vai para o mapa, não só quem tem apelido: `montarMapaApelidos` usa
   os sem apelido apenas no índice por documento (`porDocumentoNome`), que é o que dá nome
   ao Pix do Sicoob — lá o extrato manda só o CNPJ, e a razão social do cadastro já é
   infinitamente melhor do que "Pagamento Pix". Os outros mapas continuam só com apelido,
   então a fila e a cobertura da Parametrização não mudam. */
function remontar() {
  const todos = (_cadastro ?? []).map((f) => ({
    id: f.id,
    nome: f.nome,
    apelido: (f.apelido ?? "").trim(),
    oQueE: f.o_que_e,
    documento: f.documento,
    origem: f.origem,
  }));
  _mapa = montarMapaApelidos(todos, _grafias);
}

async function buscar(): Promise<void> {
  const [cad, ali] = await Promise.all([
    db.from("lib_fornecedores").select(COLUNAS_CADASTRO).order("nome"),
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
  const agora = new Date().toISOString();

  const valores = {
    apelido,
    o_que_e: campos.oQueE?.trim() || null,
    dono_id: campos.donoId || null,
    atualizado_em: agora,
    apelido_por: await quemSou(),
    apelido_em: agora,
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

/**
 * Grava vários apelidos de uma vez — o "o nome já serve" da fila.
 *
 * Não é um laço em cima de `salvarApelido`: aquele recarrega o cadastro INTEIRO
 * ao fim de cada gravação, e marcar quarenta linhas viraria quarenta releituras
 * da tabela com a tela piscando a cada uma. Aqui os que ainda não existem entram
 * num `insert` só, os que já existem são atualizados em paralelo, e a releitura
 * acontece uma vez, no fim.
 *
 * Só mexe no `apelido` de quem já está cadastrado: `o_que_e` e `dono_id` que
 * alguém tenha escrito antes não são apagados por um gesto em lote.
 *
 * Espera a lista já resolvida por `planoNomeQueJaServe` — a dedução da grafia e o
 * corte dos nomes curtos ficam do lado puro, que é onde dá para testar.
 */
export async function salvarApelidosEmLote(
  itens: { nome: string; apelido: string; documento?: string | null; categoria?: string | null; origem?: string | null }[],
): Promise<{ gravados: number; erros: string[] }> {
  await garantirCarga();

  const agora = new Date().toISOString();
  const erros: string[] = [];
  const novos: Record<string, unknown>[] = [];
  const atualizacoes: { id: string; apelido: string }[] = [];
  const aliases: Record<string, unknown>[] = [];

  for (const it of itens ?? []) {
    const nome = String(it?.nome ?? "").trim();
    const apelido = String(it?.apelido ?? "").trim();
    const chave = chaveContraparte(nome);
    if (chave.length < MIN_CHAVE || apelido.length < 2) {
      erros.push(`"${nome}": nome curto demais para casar com segurança.`);
      continue;
    }

    const existente = acharExistente(nome, it.documento);
    if (existente) {
      atualizacoes.push({ id: existente.id, apelido });
      // Mesma regra do caminho de uma linha só: grafia diferente da canônica
      // vira alias, para o apelido valer nas duas formas.
      if (chaveContraparte(existente.nome) !== chave
        && !_grafias.some((g) => g.fornecedor_id === existente.id && chaveContraparte(g.alias) === chave)) {
        aliases.push({
          fornecedor_id: existente.id,
          alias: nome,
          fonte: it.origem ?? "manual",
          documento_norm: soDigitos(it.documento) || null,
          origem: "manual",
        });
      }
    } else {
      novos.push({
        nome,
        documento: it.documento?.trim() || null,
        categoria: it.categoria?.trim() || null,
        origem: it.origem ?? "manual",
        apelido,
        atualizado_em: agora,
      });
    }
  }

  let gravados = 0;

  if (novos.length) {
    const { error } = await db.from("lib_fornecedores").insert(novos);
    if (error) erros.push(error.message);
    else gravados += novos.length;
  }

  const quem = await quemSou();
  const respostas = await Promise.all(
    atualizacoes.map(({ id, apelido }) =>
      db.from("lib_fornecedores")
        .update({ apelido, atualizado_em: agora, apelido_por: quem, apelido_em: agora })
        .eq("id", id)),
  );
  for (const r of respostas) {
    if (r?.error) erros.push(r.error.message);
    else gravados++;
  }

  // Alias é acessório: sem ele o apelido continua valendo pela chave canônica.
  if (aliases.length) await db.from("contrapartes_alias").insert(aliases);

  await recarregarApelidos();
  return { gravados, erros };
}

/* -------------------------------------------------------------------------
 * Confirmar um grupo inteiro
 * ---------------------------------------------------------------------- */

export type GrafiaParaGravar = {
  nome: string;
  documento?: string | null;
  categoria?: string | null;
  origem?: string | null;
};

export type GrupoParaGravar = {
  apelido: string;
  oQueE?: string | null;
  /** Todas as grafias do grupo. A âncora sai daqui — ver abaixo. */
  grafias: GrafiaParaGravar[];
};

/**
 * Grava um nome interno para um GRUPO de grafias.
 *
 * A diferença para `salvarApelidosEmLote` não é o volume, é a forma: lá cada
 * nome vira um cadastro; aqui um grupo vira UM cadastro e as outras grafias
 * viram alias dele. É o que faz "FACEBK *ADS AB12X9" e "META PLATFORMS IRELAND"
 * pararem de pedir a mesma resposta duas vezes.
 *
 * A âncora é a primeira grafia que JÁ EXISTE no cadastro — assim confirmar um
 * grupo não cria um segundo fornecedor ao lado do que já estava lá. Se nenhuma
 * existe, a primeira da lista entra como cadastro novo (a chamadora manda a
 * principal na frente).
 *
 * Tudo em três idas ao banco, não uma por grupo: confirmar quarenta grupos de
 * uma vez é o gesto normal desta tela.
 */
export async function salvarGruposApelido(
  grupos: GrupoParaGravar[],
): Promise<{ gravados: number; grafias: number; erros: string[] }> {
  await garantirCarga();

  const agora = new Date().toISOString();
  const quem = await quemSou();
  const erros: string[] = [];

  type Pendente = { grupo: GrupoParaGravar; ancora: GrafiaParaGravar; resto: GrafiaParaGravar[] };
  const emExistente: { id: string; p: Pendente }[] = [];
  const emNovo: Pendente[] = [];

  for (const g of grupos ?? []) {
    const apelido = String(g?.apelido ?? "").trim();
    const grafias = (g?.grafias ?? []).filter((x) => String(x?.nome ?? "").trim());
    if (apelido.length < 2 || !grafias.length) continue;

    const jaTem = grafias
      .map((x) => ({ x, f: acharExistente(x.nome, x.documento) }))
      .find((r) => r.f);

    const ancora = jaTem?.x ?? grafias[0];
    if (!jaTem && chaveContraparte(ancora.nome).length < MIN_CHAVE) {
      erros.push(`"${ancora.nome}": nome curto demais para casar com segurança.`);
      continue;
    }

    const resto = grafias.filter((x) => x !== ancora);
    const p: Pendente = { grupo: { ...g, apelido }, ancora, resto };
    if (jaTem?.f) emExistente.push({ id: jaTem.f.id, p });
    else emNovo.push(p);
  }

  const carimbo = (p: Pendente) => ({
    apelido: p.grupo.apelido,
    o_que_e: p.grupo.oQueE?.trim() || null,
    atualizado_em: agora,
    apelido_por: quem,
    apelido_em: agora,
    revisar: false,
  });

  let gravados = 0;
  const alias: Record<string, unknown>[] = [];

  const juntarResto = (fornecedorId: string, p: Pendente) => {
    for (const x of p.resto) {
      const chave = chaveContraparte(x.nome);
      if (chave.length < MIN_CHAVE) continue; // "DM", "IG": alias assim casaria qualquer coisa
      if (chave === chaveContraparte(p.ancora.nome)) continue;
      if (_grafias.some((gr) => gr.fornecedor_id === fornecedorId && chaveContraparte(gr.alias) === chave)) continue;
      if (alias.some((a) => a.fornecedor_id === fornecedorId && chaveContraparte(String(a.alias)) === chave)) continue;
      alias.push({
        fornecedor_id: fornecedorId,
        alias: x.nome,
        fonte: x.origem ?? "manual",
        documento_norm: soDigitos(x.documento) || null,
        origem: "manual",
      });
    }
  };

  if (emNovo.length) {
    const { data, error } = await db.from("lib_fornecedores").insert(
      emNovo.map((p) => ({
        nome: p.ancora.nome,
        documento: p.ancora.documento?.trim() || null,
        categoria: p.ancora.categoria?.trim() || null,
        origem: p.ancora.origem ?? "manual",
        ...carimbo(p),
      })),
    ).select("id,nome");
    if (error) erros.push(error.message);
    else {
      const criados = (data ?? []) as { id: string; nome: string }[];
      gravados += criados.length;
      for (const p of emNovo) {
        const novo = criados.find((f) => f.nome === p.ancora.nome);
        if (novo) juntarResto(novo.id, p);
      }
    }
  }

  /* Em lotes, e não tudo de uma vez: "Marcar visíveis" com a fila inteira na
     tela põe duzentos grupos neste gesto, e duzentas requisições paralelas
     travam o navegador antes de chegarem ao PostgREST. */
  const LOTE = 25;
  for (let i = 0; i < emExistente.length; i += LOTE) {
    const fatia = emExistente.slice(i, i + LOTE);
    const respostas = await Promise.all(
      fatia.map(({ id, p }) => db.from("lib_fornecedores").update(carimbo(p)).eq("id", id)),
    );
    respostas.forEach((r, k) => {
      if (r?.error) erros.push(r.error.message);
      else { gravados++; juntarResto(fatia[k].id, fatia[k].p); }
    });
  }

  if (alias.length) {
    const { error } = await db.from("contrapartes_alias").insert(alias);
    // Sem o alias o nome do grupo continua valendo para a âncora; as outras
    // grafias voltam para a fila. Vale avisar, não vale derrubar o gesto.
    if (error) erros.push(`Grafias não juntadas: ${error.message}`);
  }

  await recarregarApelidos();
  return { gravados, grafias: alias.length, erros };
}

/** "Reler depois" — o nome está lá, mas alguém duvidou dele. */
export async function marcarRevisao(id: string, revisar: boolean): Promise<{ error: string | null }> {
  const { error } = await db.from("lib_fornecedores").update({ revisar }).eq("id", id);
  if (error) return { error: error.message };
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

/**
 * O mesmo gesto para o grupo inteiro — o "X" da fila.
 *
 * Descartar uma grafia e deixar as outras duas do mesmo grupo para trás faria o
 * grupo voltar amanhã pela metade, que é pior do que não ter descartado.
 */
export async function ignorarContrapartes(
  itens: { nome: string; documento?: string | null; origem?: string | null }[],
): Promise<{ error: string | null }> {
  await garantirCarga();

  const agora = new Date().toISOString();
  const ids: string[] = [];
  const novos: Record<string, unknown>[] = [];

  for (const it of itens ?? []) {
    const n = String(it?.nome ?? "").trim();
    if (!n) continue;
    const existente = acharExistente(n, it.documento);
    if (existente) ids.push(existente.id);
    else novos.push({
      nome: n,
      documento: it.documento?.trim() || null,
      origem: it.origem ?? "manual",
      status: "ignorado",
    });
  }

  const erros: string[] = [];
  if (ids.length) {
    const { error } = await db.from("lib_fornecedores")
      .update({ status: "ignorado", atualizado_em: agora }).in("id", ids);
    if (error) erros.push(error.message);
  }
  if (novos.length) {
    const { error } = await db.from("lib_fornecedores").insert(novos);
    if (error) erros.push(error.message);
  }

  await recarregarApelidos();
  return { error: erros[0] ?? null };
}

export async function desfazerGrafia(id: string): Promise<{ error: string | null }> {
  const { error } = await db.from("contrapartes_alias").delete().eq("id", id);
  if (error) return { error: error.message };
  await recarregarApelidos();
  return { error: null };
}
