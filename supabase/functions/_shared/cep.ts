/* ---------------------------------------------------------------------------
 * CEP — existir na base dos Correios é o que a prefeitura cobra.
 *
 * A DESCOBERTA QUE ORIGINOU ESTE MÓDULO (09/09/2026). O Hub tratava
 * `cep_generico` (terminado em `000`) como a causa do `E0240` — "o CEP informado
 * não existe ou não pertence ao município do endereço do tomador". Não é. O que
 * separa quem emite de quem é recusado é uma pergunta só: **este CEP existe na
 * base dos Correios?**
 *
 * Medido em 24 cadastros, 12 de cada lado: 12/12 dos que emitem existem no
 * ViaCEP; 12/12 dos recusados voltam `{"erro": true}`. Na população: das 253 OS
 * paradas em "precisa de gente" por CEP, **252 têm CEP inexistente**.
 *
 * O critério velho erra dos DOIS lados, e por isso não dava para consertar
 * apertando-o:
 *   • `45810-000` (Porto Seguro) termina em `000`, EXISTE, e emite. São 337
 *     cadastros com CEP "genérico" emitindo sem problema nenhum.
 *   • `41750-166` (Salvador), `90520-002` (Porto Alegre) e `66093-380` (Belém)
 *     têm cara de CEP de rua e NÃO existem mais na base. Todos recusados.
 *
 * POR QUE O VIACEP E NÃO A BRASILAPI, que este repo já usava para CEP: a
 * BrasilAPI responde bonito para `45818-000` — Porto Seguro/BA, IBGE certo —
 * porque quando a base dos Correios falha ela cai numa base alternativa
 * (`"service": "open-cep"`) e não avisa. Quem manda na prefeitura é o DNE dos
 * Correios, e é o ViaCEP que o expõe cru, inclusive a ausência. Usar a BrasilAPI
 * para esta pergunta é perguntar a quem não sabe e receber um sim.
 * ------------------------------------------------------------------------- */

export type ViaCep = "porta" | "rua" | "cidade";

export interface CepResolvido {
  cep: string;
  /** `porta` = o CEP daquele endereço; `rua` = a rua certa, faixa de numeração
   *  possivelmente outra; `cidade` = outra rua do mesmo município. */
  via: ViaCep;
  bairro?: string;
  /** O que foi usado para achar — entra no rastro de `nf_cadastro_correcoes`. */
  detalhe: string;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const limpo = (v: unknown) => String(v ?? "").trim();
const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function buscar(url: string, ms = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Este CEP existe na base dos Correios?
 *
 * `null` — e não `false` — quando não deu para saber (rede caiu, ViaCEP fora).
 * A diferença é a que impede o pior erro possível deste módulo: tratar silêncio
 * como "não existe" faria uma queda de rede reescrever o CEP de cadastros bons.
 * Quem chama tem de decidir explicitamente o que faz com `null`, e a resposta
 * certa é sempre "não mexe".
 */
export async function existeNosCorreios(cep: string): Promise<boolean | null> {
  const c = soDigitos(cep);
  if (c.length !== 8) return false;
  const d = await buscar(`https://viacep.com.br/ws/${c}/json/`);
  if (d === null) return null;
  // O ViaCEP responde 200 com `{ "erro": "true" }` para CEP inexistente — o
  // status HTTP não distingue, o corpo é que decide.
  if (d?.erro) return false;
  return typeof d?.localidade === "string" && d.localidade.length > 0;
}

/**
 * O logradouro do cadastro, reduzido ao que a busca reversa entende.
 *
 * O que chega do Omie e da Receita não é um nome de rua limpo: vem
 * `"10A RUA GABRIEL TEODORO"` (código de setor colado na frente),
 * `"Avenida Avenida George Oetterer"` (tipo duplicado pela junção da Receita),
 * `"FAZENDA SAO RAMIRO - ESTRADA MUNICIPAL GARCA/GALIA"` (dois endereços num
 * campo só). Mandar isso ao ViaCEP devolve zero resultado, e zero resultado é
 * indistinguível de "esta rua não existe".
 */
const TIPOS = "(RUA|R|AVENIDA|AV|PRACA|PC|TRAVESSA|TV|RODOVIA|ROD|ESTRADA|ESTR|ALAMEDA|AL)";

export function limparLogradouro(logradouro: string): string {
  let s = semAcento(limpo(logradouro)).toUpperCase();
  s = s.replace(/^\d+[A-Z]?\s+/, "");                       // "10A RUA X" → "RUA X"
  s = s.replace(new RegExp(`^${TIPOS}\\s+${TIPOS}\\s+`), "$1 "); // "AVENIDA AVENIDA X"
  s = s.split(" - ")[0].split("/")[0];                      // corta o segundo endereço
  return s.replace(/\s+/g, " ").trim();
}

/** O mesmo logradouro sem o tipo — segunda tentativa quando a primeira dá zero.
 *  O ViaCEP casa por substring, e às vezes o tipo que o cadastro usa não é o que
 *  os Correios usam ("PRACA" contra "LARGO"). */
const semTipo = (s: string) => s.replace(new RegExp(`^${TIPOS}\\s+`), "").trim();

async function reversa(uf: string, cidade: string, rua: string): Promise<any[]> {
  const u = semAcento(limpo(uf)).toUpperCase();
  const cid = semAcento(limpo(cidade));
  // O ViaCEP exige 3+ caracteres em cidade e logradouro e responde 400 abaixo
  // disso — conferir aqui evita gastar a chamada para receber erro.
  if (u.length !== 2 || cid.length < 3 || rua.length < 3) return [];
  const d = await buscar(
    `https://viacep.com.br/ws/${u}/${encodeURIComponent(cid)}/${encodeURIComponent(rua)}/json/`,
  );
  return Array.isArray(d) ? d.filter((x) => soDigitos(x?.cep).length === 8) : [];
}

/**
 * ISCAS — como se acha um CEP válido de um município que não tem CEP geral.
 *
 * A intuição que o desenho anterior tinha, e que é FALSA: "todo município tem um
 * CEP `XXXXX-000` que representa a cidade inteira". Tinha, e os Correios os
 * aposentaram ao detalhar a cidade por logradouro. Medido nos 12 municípios
 * travados: nenhum deles tem `-000` válido — Irapuã tem `14990-031` de rua e o
 * `14990-000` que a Receita entrega não existe mais.
 *
 * Como o ViaCEP não expõe "liste os CEPs desta cidade", a saída é procurar um
 * logradouro que quase toda cidade brasileira tem. As dez iscas abaixo
 * resolveram 12 de 12 municípios no teste, quase sempre na primeira.
 */
const ISCAS = [
  "Sete de Setembro", "Quinze de Novembro", "Getulio Vargas", "Sao Jose", "Brasil",
  "Santos Dumont", "Tiradentes", "Rui Barbosa", "Do Comercio", "Principal",
];

async function cepDeQualquerRuaDaCidade(uf: string, cidade: string) {
  for (const isca of ISCAS) {
    const achados = await reversa(uf, cidade, isca);
    if (achados.length) {
      // O menor CEP da lista, por estabilidade: a mesma cidade tem de devolver
      // sempre o mesmo CEP, senão duas rodadas escrevem valores diferentes no
      // mesmo cadastro e o diff de `aplicarCorrecao` nunca estabiliza.
      const ordenados = [...achados].sort((a, b) => soDigitos(a.cep).localeCompare(soDigitos(b.cep)));
      return { cep: soDigitos(ordenados[0].cep), bairro: limpo(ordenados[0].bairro), isca };
    }
  }
  return undefined;
}

/**
 * O CEP que deve ir para o cadastro — a escada inteira, em ordem de precisão.
 *
 *   1. o CEP do cadastro, se existir nos Correios ....... nada a fazer
 *   2. a rua, com resultado único ....................... `porta`
 *   3. a rua, desempatada pelo bairro ................... `porta`
 *   4. a rua certa, primeira faixa de numeração ......... `rua`
 *   5. outra rua do mesmo município (isca) .............. `cidade`
 *
 * OS DEGRAUS 4 E 5 SÃO PERDA DE PRECISÃO ASSUMIDA, e a decisão é de 09/09/2026:
 * entre um endereço aproximado e R$ 87 mil de receita recebida sem nota fiscal,
 * escolheu-se a nota. O `via` sobe junto com o CEP justamente para que essa
 * perda fique escrita no rastro, e não escondida num campo que parece exato.
 *
 * O degrau 4 é bem melhor que o 5 e por isso vem antes: a rua é a certa, só a
 * quadra pode não ser. O 5 é o último recurso dos endereços que não são
 * logradouro — `FAZENDA SAO RAMIRO`, `PRAIA DOS COQUEIROS`, `ESTRADA DE ACESSO
 * AO MORRO DO PIRENEUS` — para os quais não existe CEP de porta.
 */
export async function resolverCep(end: {
  cep?: string | null;
  uf: string;
  cidade: string;
  logradouro?: string | null;
  bairro?: string | null;
}): Promise<CepResolvido | undefined> {
  const atual = soDigitos(end.cep);
  if (atual.length === 8) {
    const existe = await existeNosCorreios(atual);
    // `null` é rede caída: não se conclui nada, e mexer seria pior que esperar.
    if (existe === null || existe === true) {
      return { cep: atual, via: "porta", detalhe: existe === null ? "não verificado" : "já existe nos Correios" };
    }
  }

  const rua = limparLogradouro(end.logradouro ?? "");
  let achados = rua ? await reversa(end.uf, end.cidade, rua) : [];
  if (!achados.length && rua) {
    const curto = semTipo(rua);
    if (curto !== rua && curto.length >= 3) achados = await reversa(end.uf, end.cidade, curto);
  }

  if (achados.length === 1) {
    return { cep: soDigitos(achados[0].cep), via: "porta", bairro: limpo(achados[0].bairro), detalhe: `rua "${rua}"` };
  }

  if (achados.length > 1) {
    const b = semAcento(limpo(end.bairro)).toUpperCase();
    if (b) {
      const casam = achados.filter((x) => semAcento(limpo(x?.bairro)).toUpperCase() === b);
      if (casam.length === 1) {
        return { cep: soDigitos(casam[0].cep), via: "porta", bairro: limpo(casam[0].bairro), detalhe: `rua "${rua}", bairro "${b}"` };
      }
    }
    const ordenados = [...achados].sort((a, b2) => soDigitos(a.cep).localeCompare(soDigitos(b2.cep)));
    return {
      cep: soDigitos(ordenados[0].cep),
      via: "rua",
      bairro: limpo(ordenados[0].bairro),
      detalhe: `rua "${rua}", ${achados.length} faixas, escolhida a menor`,
    };
  }

  const daCidade = await cepDeQualquerRuaDaCidade(end.uf, end.cidade);
  if (daCidade) {
    return {
      cep: daCidade.cep,
      via: "cidade",
      bairro: daCidade.bairro || undefined,
      detalhe: `sem logradouro na base; CEP de "${daCidade.isca}" no mesmo município`,
    };
  }
  return undefined;
}
