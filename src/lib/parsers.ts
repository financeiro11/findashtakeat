import * as XLSX from "xlsx";

export type RawTx = {
  data: string;
  descricao: string;
  valor: number;
  tipo: "Crédito" | "Débito";
};

function inferType(valor: number, tipoStr?: string): "Crédito" | "Débito" {
  if (tipoStr) {
    const t = tipoStr.toString().toUpperCase();
    if (t.startsWith("C")) return "Crédito";
    if (t.startsWith("D")) return "Débito";
  }
  return valor >= 0 ? "Crédito" : "Débito";
}

function parseDate(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = v.toString().trim();
  // dd/mm/yyyy
  const m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2]}-${m[1]}`;
  }
  return s;
}

function parseValor(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = v.toString().trim().replace(/[R$\s]/g, "");
  // brazilian: 1.234,56
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export async function parseFile(file: File): Promise<RawTx[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "ofx") return parseOFX(await file.text());
  return parseSheet(file);
}

async function parseSheet(file: File): Promise<RawTx[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return rows.map((r) => {
    const keys = Object.keys(r);
    const find = (...names: string[]) =>
      keys.find((k) => names.some((n) => k.toLowerCase().includes(n)));
    const kData = find("data", "date") || keys[0];
    const kDesc = find("descr", "histor", "memo", "lanca") || keys[1];
    const kVal = find("valor", "amount", "vlr") || keys[2];
    const kTipo = find("tipo", "type", "d/c");
    const valor = parseValor(r[kVal]);
    return {
      data: parseDate(r[kData]),
      descricao: (r[kDesc] || "").toString(),
      valor: Math.abs(valor),
      tipo: inferType(valor, kTipo ? r[kTipo] : undefined),
    };
  }).filter((t) => t.descricao || t.valor);
}

function parseOFX(text: string): RawTx[] {
  const txs: RawTx[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTPOSTED").slice(0, 8); // YYYYMMDD
    const data = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
    const valor = parseFloat(get("TRNAMT")) || 0;
    const memo = get("MEMO") || get("NAME") || "";
    txs.push({
      data,
      descricao: memo,
      valor: Math.abs(valor),
      tipo: valor >= 0 ? "Crédito" : "Débito",
    });
  }
  return txs;
}
