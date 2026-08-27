/* ---------------------------------------------------------------------------
 * QUANDO ESTE CRON DISPARA DE NOVO.
 *
 * O `pg_cron` sabe a resposta e não a expõe: `cron.job` guarda só a expressão.
 * Calcular no cliente tem uma vantagem que o servidor não teria — a contagem
 * regressiva anda de segundo em segundo sem uma ida ao banco por segundo.
 *
 * TUDO EM UTC, e isto é o ponto que erra quem não repara: o `pg_cron` do
 * Supabase agenda em UTC. Ler "40 12 * * *" como 12h40 de Brasília mostraria
 * "faltam 3 horas" para algo que já rodou. Os cálculos usam os getters `UTC*`
 * do `Date`; quem converte para o fuso de quem lê é a formatação, no fim.
 *
 * NÃO É FORÇA BRUTA. Varrer minuto a minuto até achar custa 11.520 iterações
 * por automação, e são 46 delas — meio milhão de voltas a cada render, para uma
 * faixa que atualiza a cada segundo. Aqui o algoritmo pula: hora não permitida
 * salta para a próxima hora permitida, dia não permitido salta para o próximo
 * dia. Um cron mensal resolve em dezenas de passos.
 * ------------------------------------------------------------------------- */

/** Os cinco campos, já expandidos nos valores que cada um aceita. */
type Campos = {
  minutos: Set<number>;
  horas: Set<number>;
  dias: Set<number>;
  meses: Set<number>;
  semana: Set<number>;
  /** `*` nos dois campos de dia muda a regra de OU para E — ver `diaVale`. */
  diaLivre: boolean;
  semanaLivre: boolean;
};

/**
 * Expande um campo do cron: curinga, valor solto, lista, faixa e passo
 * (asterisco-barra-15, faixa-barra-10).
 *
 * O exemplo com asterisco-barra vai por extenso porque escrito de verdade ele
 * fecha este comentário — a sequência é a mesma que termina um bloco JSDoc.
 *
 * Fora da faixa é ERRO e não silêncio: uma expressão que ninguém consegue ler
 * deve aparecer como "—" na tela, não como um horário inventado.
 */
function expandir(campo: string, min: number, max: number): Set<number> | null {
  const fora = new Set<number>();
  for (const parte of campo.split(",")) {
    const [faixa, passoTxt] = parte.split("/");
    const passo = passoTxt ? Number(passoTxt) : 1;
    if (!isFinite(passo) || passo < 1) return null;

    let de: number;
    let ate: number;
    if (faixa === "*") {
      de = min; ate = max;
    } else if (faixa.includes("-")) {
      const [a, b] = faixa.split("-").map(Number);
      if (!isFinite(a) || !isFinite(b)) return null;
      de = a; ate = b;
    } else {
      const n = Number(faixa);
      if (!isFinite(n)) return null;
      de = n; ate = passoTxt ? max : n;
    }
    if (de < min || ate > max || de > ate) return null;
    for (let v = de; v <= ate; v += passo) fora.add(v);
  }
  return fora.size ? fora : null;
}

export function lerCron(expr: string): Campos | null {
  const p = String(expr ?? "").trim().split(/\s+/);
  if (p.length !== 5) return null;
  const minutos = expandir(p[0], 0, 59);
  const horas = expandir(p[1], 0, 23);
  const dias = expandir(p[2], 1, 31);
  const meses = expandir(p[3], 1, 12);
  // `7` é domingo em algumas implementações; normaliza para 0.
  const semanaBruta = expandir(p[4], 0, 7);
  if (!minutos || !horas || !dias || !meses || !semanaBruta) return null;
  const semana = new Set([...semanaBruta].map((d) => (d === 7 ? 0 : d)));
  return {
    minutos, horas, dias, meses, semana,
    diaLivre: p[2] === "*",
    semanaLivre: p[4] === "*",
  };
}

/**
 * A regra do dia, que é a única esquisitice herdada do cron original:
 * quando os DOIS campos de dia estão preenchidos, vale QUALQUER um dos dois
 * (OU, não E). "0 0 1 * 1" é "todo dia 1 **e também** toda segunda".
 */
function diaVale(c: Campos, d: Date): boolean {
  const dia = c.dias.has(d.getUTCDate());
  const sem = c.semana.has(d.getUTCDay());
  if (c.diaLivre && c.semanaLivre) return true;
  if (c.diaLivre) return sem;
  if (c.semanaLivre) return dia;
  return dia || sem;
}

/**
 * O próximo disparo depois de `agora`, ou `null` se não houver um em 400 dias
 * (o que só acontece com expressão impossível, tipo 31 de fevereiro).
 */
export function proximoDisparo(expr: string, agora: Date = new Date()): Date | null {
  const c = lerCron(expr);
  if (!c) return null;

  // Começa no minuto seguinte, com segundos zerados: o disparo é no minuto cheio.
  const d = new Date(agora.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);

  const limite = new Date(agora.getTime() + 400 * 86_400_000);
  while (d <= limite) {
    if (!c.meses.has(d.getUTCMonth() + 1)) {
      // Pula para o dia 1 do mês seguinte, à meia-noite.
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!diaVale(c, d)) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!c.horas.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutos.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

/**
 * "3m12s", "2h04", "em 3 dias" — a distância dita como quem fala.
 *
 * Segundos só aparecem abaixo de dez minutos: acima disso eles piscam sem
 * informar nada, e um número que muda o tempo todo cansa quem só quer saber se
 * é "já" ou "daqui a pouco".
 */
export function faltam(ate: Date | null, agora: Date = new Date()): string {
  if (!ate) return "—";
  const s = Math.round((ate.getTime() - agora.getTime()) / 1000);
  if (s <= 0) return "agora";
  if (s < 600) {
    const m = Math.floor(s / 60);
    return m ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  }
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  const dias = Math.round(h / 24);
  return dias === 1 ? "amanhã" : `${dias} dias`;
}

/** "há 3min", "há 2h", "ontem" — para o último disparo. */
export function desde(quando: string | Date | null, agora: Date = new Date()): string {
  if (!quando) return "nunca";
  const d = quando instanceof Date ? quando : new Date(quando);
  if (isNaN(d.getTime())) return "—";
  const s = Math.round((agora.getTime() - d.getTime()) / 1000);
  if (s < 60) return "agora há pouco";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}
