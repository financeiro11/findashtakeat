// Camada de voz do Assistente — síntese de fala gratuita, via navegador.
//
// Usa a Web Speech API (`speechSynthesis`), que não custa nada e não faz chamada de
// backend. Duas realidades descobertas testando na máquina do time (06/08/2026):
//
//   • As vozes disponíveis MUDAM por navegador. O Edge expõe as neurais da Microsoft
//     (Thalita, Francisca, Antônio); o Chrome não — lá a melhor é a do Google.
//   • Nenhuma voz boa existe nos dois. Por isso a escolha é uma CADEIA de preferência:
//     cada pessoa ouve a melhor voz do navegador dela, e nunca ficamos mudos.
//
// Se um dia a diferença de voz entre pessoas incomodar, o caminho é contratar a mesma
// voz no Azure e trocar só a implementação de `falar()` — a interface daqui não muda.

/**
 * Ordem de preferência, da melhor para a pior. Casada contra `voice.name` por regex
 * porque o nome exato varia com o idioma do Windows ("Multilingual" vs "multilíngue").
 */
const PREFERENCIA: RegExp[] = [
  /thalita/i,                    // Edge — neural multilíngue, a preferida do time
  /francisca|ant[oô]nio/i,       // Edge/Windows 11 — neurais em pt-BR
  /google.*portugu[eê]s/i,       // Chrome — melhor opção disponível lá
  /natural|neural/i,             // qualquer outra neural que apareça
  /maria|daniel|helo[ií]sa/i,    // vozes antigas do Windows: último recurso
];

/** Só vozes em português; sem isso o fallback acabaria falando pt com sotaque inglês. */
function emPortugues(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return vozes.filter((v) => v.lang.toLowerCase().startsWith("pt"));
}

/**
 * Escolhe a melhor voz disponível seguindo `PREFERENCIA`.
 * Devolve `null` quando não há nenhuma voz em português instalada — nesse caso o
 * chamador deve manter o texto na tela e simplesmente não falar.
 */
export function escolherVoz(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const candidatas = emPortugues(vozes);
  if (candidatas.length === 0) return null;

  for (const padrao of PREFERENCIA) {
    const achada = candidatas.find((v) => padrao.test(v.name));
    if (achada) return achada;
  }
  return candidatas[0]; // há voz pt, só não reconhecida: melhor falar do que calar
}

// ---------------------------------------------------------------------------
// Preparo do texto
// ---------------------------------------------------------------------------
//
// Sintetizadores leem símbolos mal: "R$ 128.412,00" vira algo como "erre cifrão cento
// e vinte e oito ponto quatro doze vírgula zero zero". O número EXATO continua na tela;
// o que é falado é a versão redonda e legível. Isso não é perda de precisão — é a regra
// de que a voz diz o significado e a tela mostra o número.

const UNIDADES: [number, string, string][] = [
  [1_000_000_000, "bilhão", "bilhões"],
  [1_000_000, "milhão", "milhões"],
  [1_000, "mil", "mil"],
];

/** "1234567" → "1,2 milhão"; "128412" → "128 mil"; "847" → "847". */
function magnitude(valor: number): string {
  const abs = Math.abs(valor);
  for (const [corte, singular, plural] of UNIDADES) {
    if (abs >= corte) {
      const n = valor / corte;
      // Uma casa decimal só quando ela informa algo (1,2 milhão vs 3 milhões).
      const arredondado = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
      const texto = arredondado.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      const nome = Math.abs(arredondado) === 1 ? singular : plural;
      return `${texto} ${nome}`;
    }
  }
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** Converte "1.234.567,89" (formato pt-BR) para número. */
function parseBR(bruto: string): number {
  return parseFloat(bruto.replace(/\./g, "").replace(",", "."));
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Reescreve um texto para ser FALADO, sem alterar o que vai para a tela.
 *
 * - `R$ 128.412,00` → `128 mil reais`
 * - `10,00%`        → `10 por cento`
 * - `07/2026`       → `julho de 2026`
 * - `05/08/2026`    → `5 de agosto de 2026`
 */
export function prepararParaFala(texto: string): string {
  let t = texto;

  // Dinheiro — antes dos percentuais, senão "R$ 1,00" perderia o cifrão.
  t = t.replace(/R\$\s*([\d.]+,\d{2}|\d+)/g, (_, num: string) => {
    const v = parseBR(num);
    if (!Number.isFinite(v)) return num;
    const escala = magnitude(v);
    const nome = Math.abs(v) === 1 ? "real" : "reais";
    // "milhão"/"bilhão" exigem preposição — "3 milhões DE reais" —, "mil" não:
    // "128 mil reais". Sem isto a fala sai agramatical.
    const conector = /milh|bilh/.test(escala) ? " de " : " ";
    return `${escala}${conector}${nome}`;
  });

  // Percentuais: descarta casas decimais nulas ("10,00%" → "10 por cento").
  t = t.replace(/(\d+(?:,\d+)?)\s*%/g, (_, num: string) => {
    const v = parseBR(num);
    if (!Number.isFinite(v)) return num;
    const texto = v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `${texto} por cento`;
  });

  // Data completa DD/MM/AAAA (antes de MM/AAAA, que casaria com o pedaço final).
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (todo, d: string, m: string, a: string) => {
    const mes = MESES[parseInt(m, 10) - 1];
    return mes ? `${parseInt(d, 10)} de ${mes} de ${a}` : todo;
  });

  // Competência MM/AAAA.
  t = t.replace(/\b(\d{1,2})\/(\d{4})\b/g, (todo, m: string, a: string) => {
    const mes = MESES[parseInt(m, 10) - 1];
    return mes ? `${mes} de ${a}` : todo;
  });

  return t;
}

// ---------------------------------------------------------------------------
// Reprodução
// ---------------------------------------------------------------------------

let utteranceAtual: SpeechSynthesisUtterance | null = null; // sem isto o GC do Chrome corta a fala
let keepAlive: number | null = null;

function limparKeepAlive() {
  if (keepAlive !== null) {
    window.clearInterval(keepAlive);
    keepAlive = null;
  }
}

export function suportaVoz(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function pararFala() {
  if (!suportaVoz()) return;
  limparKeepAlive();
  window.speechSynthesis.cancel();
}

/**
 * Fala `texto` com a melhor voz disponível. Aplica `prepararParaFala` automaticamente.
 *
 * Silencioso por design: se não há voz, não há suporte, ou a fala falha, a função apenas
 * não produz áudio. A voz é SEMPRE um extra — o texto e os números na tela são a resposta
 * de verdade, e nunca dependem daqui.
 */
export function falar(texto: string, opts: { velocidade?: number } = {}): void {
  if (!suportaVoz() || !texto.trim()) return;

  const voz = escolherVoz(window.speechSynthesis.getVoices());
  if (!voz) return; // nenhuma voz em português: segue mudo, a tela já mostrou tudo

  pararFala();

  const u = new SpeechSynthesisUtterance(prepararParaFala(texto));
  u.voice = voz;
  u.lang = voz.lang;
  u.rate = opts.velocidade ?? 1;
  u.onend = limparKeepAlive;
  u.onerror = limparKeepAlive;
  utteranceAtual = u;

  // Dois defeitos conhecidos do Chrome: speak() colado no cancel() engasga, e a fala
  // morre sozinha por volta dos 15s. O atraso resolve o primeiro; o pause/resume
  // periódico, o segundo.
  window.setTimeout(() => {
    window.speechSynthesis.speak(u);
    keepAlive = window.setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        limparKeepAlive();
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }, 10_000);
  }, 60);
}
