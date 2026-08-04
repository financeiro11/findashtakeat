/**
 * Parsing da aba "Equipe" da planilha do BP — sem I/O, pra poder ser testado
 * isoladamente (mesma ideia do ./parse.ts da aba Consolidado).
 *
 * A aba vem como matriz crua (linhas × colunas). O layout é um bloco por área,
 * cada um dividido em grupos e, dentro deles, uma linha por cargo:
 *
 *   4.1.Equipe Administrativa                                  -96750  -111750 …
 *     Backoffice                                               -31750   -46750 …
 *       Analista Financeiro | 5.000 | var. | 0 | PJ | base |    -5000   -10000 …
 *       # Quantidade                          |    | Min. |        1        2 …
 *       Head Pessoas        | 10.000 |    1 | 2 | PJ | key  |        0   -10000 …
 *
 * Duas formas de quantidade: **fixa** (número na coluna "Quantidade", entra no
 * mês da coluna "Início") e **variável** ("var.", com a quantidade mês a mês na
 * sub-linha "# Quantidade" logo abaixo). No fim da aba vem o bloco "Headcount
 * Equipes", que é a fonte oficial do headcount por área.
 */
import { normRotulo, paraNumero, partirRotulo, soma } from "./format";
import { AREAS, LINHA_DE_CUSTO, type Area } from "./plano2026";

/** Célula crua da planilha, como sai do XLSX. */
export type Celula = string | number | boolean | null;

/**
 * Corta linhas e colunas vazias das bordas da matriz. A aba Operação declara
 * 16 mil colunas de nada; sem isso a planilha inteira não caberia no banco.
 */
export function recortar(matriz: unknown): Celula[][] {
  if (!Array.isArray(matriz)) return [];
  const linhas = (matriz as Celula[][]).map((l) => (Array.isArray(l) ? l : []));
  const preenchida = (c: Celula) => c !== null && c !== undefined && c !== "";
  let colunas = 0;
  let ultima = -1;
  linhas.forEach((l, i) => {
    for (let j = l.length - 1; j >= 0; j--) {
      if (!preenchida(l[j])) continue;
      colunas = Math.max(colunas, j + 1);
      ultima = i;
      break;
    }
  });
  return linhas
    .slice(0, ultima + 1)
    .map((l) => Array.from({ length: colunas }, (_, j) => (l[j] === undefined ? null : l[j])));
}

export type ModeloContratacao = "PJ" | "CLT" | "Estágio";
export type IndiceReajuste = "diretoria" | "key" | "base";

export type CargoBP = {
  id: string;
  area: Area;
  /** Subdivisão dentro da área ("Backoffice", "Inside Sales", "Produto"). */
  grupo: string;
  cargo: string;
  /** Remuneração base mensal; null quando a vaga está zerada no plano. */
  remBase: number | null;
  modelo: ModeloContratacao;
  reajuste: IndiceReajuste;
  /** Primeiro mês com gente no cargo (0-11); null se não abre no ano. */
  entrada: number | null;
  qtdMes: number[];
  /** Custo mensal, sempre positivo. */
  custoMes: number[];
  qtdJan: number;
  qtdDez: number;
  custoAno: number;
};

export type EquipeBP = {
  headcountPorArea: Record<Area, number[]>;
  headcountGeral: number[];
  contratacoes: number[];
  quadro: CargoBP[];
  beneficioPorPessoa: number | null;
  custoKitOnboarding: number | null;
};

const MODELOS: Record<string, ModeloContratacao> = {
  pj: "PJ",
  clt: "CLT",
  estag: "Estágio",
  estagio: "Estágio",
  estagiario: "Estágio",
  estagiarios: "Estágio",
};

const REAJUSTES: Record<string, IndiceReajuste> = {
  diretoria: "diretoria",
  key: "key",
  base: "base",
};

/** "4.1.Equipe Administrativa" → Administrativo. */
const AREA_POR_BLOCO = new Map<string, Area>(AREAS.map((a) => [normRotulo(LINHA_DE_CUSTO[a]), a]));
/** "Administrativo" → Administrativo, pro bloco "Headcount Equipes" do fim. */
const AREA_POR_NOME = new Map<string, Area>(AREAS.map((a) => [normRotulo(a), a]));

const CAMPOS = ["rem base", "quantidade", "inicio", "modelo", "tipo"] as const;
type Campo = (typeof CAMPOS)[number];

/**
 * Descobre a coluna do rótulo, as 12 colunas de mês e as colunas de premissa do
 * cargo. Tudo por texto de cabeçalho — a planilha muda de largura entre versões.
 */
function mapearColunas(linhas: Celula[][]) {
  let colRotulo = -1;
  const colsMes: number[] = [];
  let campos: Record<Campo, number> | null = null;

  for (const linha of linhas) {
    if (colRotulo < 0) {
      const i = linha.findIndex((c) => normRotulo(String(c ?? "")) === "mes calendario");
      if (i >= 0) {
        colRotulo = i;
        linha.forEach((c, j) => {
          const n = Number(c);
          if (j > i && Number.isInteger(n) && n >= 1 && n <= 12) colsMes[n - 1] = j;
        });
      }
    }
    if (!campos) {
      // A linha de premissas do cargo é a única que traz os cinco cabeçalhos
      // juntos — o mini-quadro de "Modelos de contratação" repete só dois deles.
      const achados: Partial<Record<Campo, number>> = {};
      linha.forEach((c, j) => {
        const k = normRotulo(String(c ?? "")) as Campo;
        if (CAMPOS.includes(k) && achados[k] === undefined) achados[k] = j;
      });
      if (CAMPOS.every((k) => achados[k] !== undefined)) campos = achados as Record<Campo, number>;
    }
  }
  return { colRotulo, colsMes, campos };
}

const doze = (v: (number | null)[]) => Array.from({ length: 12 }, (_, i) => v[i] ?? 0);

/** Cargo em construção — ganha a quantidade da sub-linha depois de criado. */
type EmObra = Omit<CargoBP, "entrada" | "qtdJan" | "qtdDez" | "custoAno"> & {
  variavel: boolean;
  qtdLida: boolean;
};

export function parsearEquipe(linhas: unknown): EquipeBP | null {
  if (!Array.isArray(linhas) || !linhas.length) return null;
  const matriz = linhas as Celula[][];
  const { colRotulo, colsMes, campos } = mapearColunas(matriz);
  if (colRotulo < 0 || !campos || colsMes.filter((c) => c != null).length < 12) return null;

  const emObra: EmObra[] = [];
  const headcountPorArea = {} as Record<Area, number[]>;
  let headcountGeral: number[] | null = null;
  let contratacoes: number[] | null = null;
  let beneficioPorPessoa: number | null = null;
  let custoKitOnboarding: number | null = null;

  let area: Area | null = null;
  let grupo = "";
  let cargo: EmObra | null = null;
  let bloco: "quadro" | "headcount" | "beneficios" | "kit" = "quadro";

  matriz.forEach((linha, i) => {
    if (!Array.isArray(linha)) return;
    const bruto = String(linha[colRotulo] ?? "").trim();
    if (!bruto) return;
    const chave = normRotulo(bruto);
    if (!chave) return;
    const meses = colsMes.map((c) => paraNumero(linha[c]));

    if (chave === "headcount equipes") {
      bloco = "headcount";
      area = null;
      cargo = null;
      return;
    }
    if (chave === "headcount geral") {
      headcountGeral = doze(meses);
      return;
    }
    if (chave === "contratacoes") {
      contratacoes = doze(meses);
      return;
    }
    if (bloco === "headcount") {
      const a = AREA_POR_NOME.get(chave);
      if (a) headcountPorArea[a] = doze(meses);
      return;
    }

    // Sub-linhas ("# Quantidade", "$ Receita Bruta") são os drivers do cargo.
    if (/^[#$]/.test(bruto)) {
      if (chave === "quantidade" && cargo?.variavel && !cargo.qtdLida) {
        cargo.qtdMes = doze(meses);
        cargo.qtdLida = true;
      }
      if (chave === "incremental por trigger extra") {
        const valor = meses.find((v) => v != null) ?? null;
        if (bloco === "beneficios") beneficioPorPessoa = valor;
        if (bloco === "kit") custoKitOnboarding = valor;
      }
      return;
    }

    const { numero, texto } = partirRotulo(bruto);

    // Linha numerada = troca de bloco. "4.1.Equipe Administrativa" abre uma
    // área; "4.6.Benefícios" fecha as áreas e abre o bloco de benefícios.
    if (numero) {
      area = AREA_POR_BLOCO.get(normRotulo(texto)) ?? null;
      grupo = "";
      cargo = null;
      bloco = area ? "quadro" : chave === "beneficios" ? "beneficios" : "quadro";
      return;
    }
    if (chave === "kit novos colaboradores") {
      bloco = "kit";
      area = null;
      cargo = null;
      return;
    }
    if (!area) return;

    const modelo = MODELOS[normRotulo(String(linha[campos.modelo] ?? ""))];
    const reajuste = REAJUSTES[normRotulo(String(linha[campos.tipo] ?? ""))];

    // Sem modelo/tipo é cabeçalho de grupo ("Backoffice", "Inside Sales").
    if (!modelo || !reajuste) {
      grupo = texto;
      cargo = null;
      return;
    }

    const remBase = paraNumero(linha[campos["rem base"]]);
    const qtdFixa = paraNumero(linha[campos.quantidade]); // "var." → null
    const inicio = paraNumero(linha[campos.inicio]); // 1-12; 0 = desde jan; 100 = não abre
    const custoMes = doze(meses).map(Math.abs);
    const variavel = qtdFixa == null;

    cargo = {
      id: `equipe-${i}`,
      area,
      grupo,
      cargo: texto,
      remBase: remBase || null,
      modelo,
      reajuste,
      variavel,
      qtdLida: false,
      // Cargo fixo entra no mês de "Início"; o variável espera a sub-linha
      // "# Quantidade" e, se ela não vier, sai do próprio custo.
      qtdMes: variavel
        ? custoMes.map((c) => (remBase ? Math.round(c / remBase) : 0))
        : custoMes.map((_, m) => (inicio != null && inicio > m + 1 ? 0 : (qtdFixa ?? 0))),
      custoMes,
    };
    emObra.push(cargo);
  });

  const quadro: CargoBP[] = emObra.map(({ variavel, qtdLida, ...c }) => {
    const entrada = c.qtdMes.findIndex((q) => q > 0);
    return {
      ...c,
      entrada: entrada < 0 ? null : entrada,
      qtdJan: c.qtdMes[0],
      qtdDez: c.qtdMes[11],
      custoAno: soma(c.custoMes) ?? 0,
    };
  });

  if (!quadro.length && !headcountGeral) return null;

  // Áreas que a planilha não trouxer no bloco final saem da soma do quadro.
  for (const a of AREAS) {
    if (headcountPorArea[a]) continue;
    const daArea = quadro.filter((c) => c.area === a);
    headcountPorArea[a] = Array.from({ length: 12 }, (_, m) =>
      daArea.reduce((acc, c) => acc + (c.qtdMes[m] ?? 0), 0),
    );
  }

  return {
    headcountPorArea,
    headcountGeral:
      headcountGeral ??
      Array.from({ length: 12 }, (_, m) => AREAS.reduce((a, ar) => a + headcountPorArea[ar][m], 0)),
    contratacoes: contratacoes ?? Array(12).fill(0),
    quadro,
    beneficioPorPessoa,
    custoKitOnboarding,
  };
}
