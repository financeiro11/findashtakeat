// Quem lê o quê — derivado do código, não adivinhado pelo nome da tabela.
//
// POR QUE ISTO EXISTE. Para trancar uma tabela por capacidade é preciso saber
// quais capacidades dependem dela, e o palpite pelo prefixo do nome erra feio:
// `omie_cache` parece "conciliação" e alimenta a DRE, o Caixa, a Remuneração e a
// Auditoria. Fechar por palpite tira a tela de quem tinha acesso legítimo — e o
// sintoma é tela vazia sem erro nenhum, que é o pior de diagnosticar.
//
// O que ele faz: varre `src/`, casa cada arquivo com a(s) rota(s) que o montam,
// pergunta ao PORTÃO qual capacidade cada rota exige, e devolve, por tabela e
// por RPC, o conjunto de capacidades que a alcançam. Uma tabela lida por três
// telas de capacidades diferentes precisa aceitar as três.
//
// Uso: node scripts/mapa-acesso.mjs [--json]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(RAIZ, "src");

/* ── O portão, lido do próprio modules.ts ──────────────────────────────────
   Reimplementar a lista aqui criaria a terceira cópia da mesma verdade. Ler o
   arquivo e extrair os pares é feio, mas mantém uma fonte só — e este script é
   ferramenta de análise, não código que vai a produção. */
function lerPortao() {
  const txt = readFileSync(join(SRC, "lib", "modules.ts"), "utf8");
  const bloco = txt.slice(txt.indexOf("const PORTAO"), txt.indexOf("/** De que capacidade"));
  const pares = [];
  for (const m of bloco.matchAll(/\["([^"]+)",\s*(?:"([^"]+)"|null)\]/g)) {
    pares.push([m[1], m[2] ?? null]);
  }
  return pares;
}

const PORTAO = lerPortao();

function capacidadeDaRota(rota) {
  if (rota === "/") return "metricas";
  for (const [prefixo, cap] of PORTAO) {
    if (rota === prefixo || rota.startsWith(prefixo + "/")) return cap;
  }
  return null;
}

/* ── Rotas do App.tsx: arquivo de página → rota ──────────────────────────── */
function rotasPorArquivo() {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  const importados = new Map(); // nome do componente -> caminho relativo
  for (const m of app.matchAll(/import\s+(\w+)[^;]*?from\s+"([./@][^"]+)"/g)) {
    importados.set(m[1], m[2]);
  }
  const porArquivo = new Map(); // caminho -> Set(rotas)
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<(\w+)/g)) {
    const [, rota, comp] = m;
    const alvo = importados.get(comp);
    if (!alvo) continue;
    const chave = alvo.replace(/^@\//, "").replace(/^\.\//, "");
    if (!porArquivo.has(chave)) porArquivo.set(chave, new Set());
    porArquivo.get(chave).add(rota.startsWith("/") ? rota : "/" + rota);
  }
  return porArquivo;
}

const ROTAS = rotasPorArquivo();

/** A rota de um arquivo: a que o App.tsx declara, ou a inferida pela pasta. */
function rotasDoArquivo(rel) {
  const semExt = rel.replace(/\\/g, "/").replace(/\.(tsx|ts)$/, "");
  const achadas = new Set();
  for (const [alvo, rotas] of ROTAS) {
    if (semExt === alvo || semExt === alvo.replace(/^src\//, "")) {
      for (const r of rotas) achadas.add(r);
    }
  }
  if (achadas.size) return [...achadas];

  /* Componente de uma pasta de MÓDULO (pages/bp/EquipeTab.tsx) herda a rota da
     página que o monta — a pasta é o módulo, então a aproximação erra pouco.
     `pages/` e `components/` na raiz NÃO valem: ali a "pasta" é todo o Hub, e a
     herança devolveria as quinze capacidades para qualquer arquivo solto. Foi o
     que aconteceu com `AutomacoesCatalogo.tsx` e `DePara.tsx`, duas páginas
     órfãs (sem `<Route>`) que apareciam lendo tudo. */
  const partes = semExt.split("/");
  const pasta = partes.slice(0, -1).join("/");
  const ehPastaDeModulo = partes.length > 2; // pages/<modulo>/Arquivo
  if (ehPastaDeModulo) {
    for (const [alvo, rotas] of ROTAS) {
      const alvoPasta = alvo.replace(/^src\//, "").split("/").slice(0, -1).join("/");
      if (alvoPasta === pasta) for (const r of rotas) achadas.add(r);
    }
  }
  return [...achadas];
}

/* ── Varredura ────────────────────────────────────────────────────────────── */
function arquivos(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.(tsx|ts)$/.test(nome) && !/\.test\.(tsx|ts)$/.test(nome)) out.push(p);
  }
  return out;
}

const tabelas = new Map(); // tabela -> Map(capacidade|"?" -> Set(arquivos))
const rpcs = new Map();

function registrar(mapa, nome, cap, arquivo) {
  if (!mapa.has(nome)) mapa.set(nome, new Map());
  const porCap = mapa.get(nome);
  const chave = cap ?? "(livre/indefinido)";
  if (!porCap.has(chave)) porCap.set(chave, new Set());
  porCap.get(chave).add(arquivo);
}

for (const arq of arquivos(SRC)) {
  const rel = relative(RAIZ, arq).replace(/\\/g, "/");
  const txt = readFileSync(arq, "utf8");
  const achouTabela = [...txt.matchAll(/\.from\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  const achouRpc = [...txt.matchAll(/\.rpc\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  if (!achouTabela.length && !achouRpc.length) continue;

  const rotas = rotasDoArquivo(rel.replace(/^src\//, ""));
  const caps = rotas.length
    ? [...new Set(rotas.map(capacidadeDaRota))]
    : [null]; // componente compartilhado: aparece como indefinido, para revisão

  for (const t of new Set(achouTabela)) for (const c of caps) registrar(tabelas, t, c, rel);
  for (const f of new Set(achouRpc)) for (const c of caps) registrar(rpcs, f, c, rel);
}

/* ── Saída ────────────────────────────────────────────────────────────────── */
function resumo(mapa) {
  return [...mapa.entries()]
    .map(([nome, porCap]) => ({
      nome,
      capacidades: [...porCap.keys()].sort(),
      arquivos: [...new Set([...porCap.values()].flatMap((s) => [...s]))],
    }))
    .sort((a, b) => b.capacidades.length - a.capacidades.length || a.nome.localeCompare(b.nome));
}

const saida = { tabelas: resumo(tabelas), rpcs: resumo(rpcs) };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(saida, null, 2));
} else {
  for (const [titulo, lista] of [["TABELAS", saida.tabelas], ["RPCs", saida.rpcs]]) {
    console.log(`\n=== ${titulo} (${lista.length}) ===`);
    for (const it of lista) {
      const marca = it.capacidades.length > 1 ? " ⚠ várias" : "";
      console.log(`${it.nome.padEnd(42)} ${it.capacidades.join(", ")}${marca}`);
    }
  }
  const ambiguas = saida.tabelas.filter((t) => t.capacidades.length > 1).length;
  const indefinidas = saida.tabelas.filter((t) => t.capacidades.includes("(livre/indefinido)")).length;
  console.log(`\n${saida.tabelas.length} tabelas · ${ambiguas} lidas por mais de uma capacidade · ${indefinidas} com origem indefinida`);
}
