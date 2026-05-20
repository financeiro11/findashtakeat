import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SHEET_ID = "17MOvrcc7OpMVPFxzoKn4Nufg0zKU33qgmvZ-N3eCwgk";
const RANGE = "Página1!A1:Z1000";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

const RESPONSAVEL = "Júlia · Financeiro";
const EVENT_MARKER = (h: string) => `[evento:${h}]`;
const VIAGEM_MARKER = (h: string) => `[viagem:${h}]`;

const fmtBR = (iso: string | null) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("pt-BR") : "—";
const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function sha1(input: string) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API keys" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = `${GATEWAY_URL}/spreadsheets/${SHEET_ID}/values/${RANGE}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
      },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Sheets [${r.status}]: ${JSON.stringify(data)}`);

    const rows: string[][] = data.values || [];
    if (rows.length < 2) {
      return new Response(JSON.stringify({ viagens: [], tarefas_criadas: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const headers = rows[0].map((h) => h.toString().trim().toLowerCase());
    const idx = (name: string) => headers.findIndex((h) => h === name || h.includes(name));
    const iCol = idx("colaborador");
    const iDest = idx("destino");
    const iIda = idx("data_ida");
    const iVolta = headers.findIndex((h) => h.includes("volta"));
    const iDias = idx("dias");
    const iValor = idx("valor");

    const parseValor = (v: string) => {
      if (!v) return 0;
      let s = v.toString().replace(/[R$\s]/g, "");
      if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };
    const parseData = (v: string) => {
      if (!v) return null;
      const s = v.toString().trim();
      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m) {
        const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
      return s;
    };

    const viagensRaw = rows.slice(1)
      .filter((r) => r.some((c) => c && c.toString().trim()))
      .map((r, i) => ({
        id: `row-${i}`,
        colaborador: r[iCol] || "",
        destino: r[iDest] || "",
        data_ida: parseData(r[iIda] || ""),
        data_volta: parseData(r[iVolta] || ""),
        dias: parseInt(r[iDias] || "0", 10) || 0,
        valor_total: parseValor(r[iValor] || ""),
      }));

    // hash por viagem individual (mantém compatibilidade com a UI de cards)
    const viagens = await Promise.all(
      viagensRaw.map(async (v) => {
        const hash = await sha1(
          `${v.colaborador}|${v.destino}|${v.data_ida || ""}`.toLowerCase(),
        );
        return { ...v, viagem_hash: hash };
      }),
    );

    // Agrupa por evento (destino + data_ida)
    let tarefas_criadas = 0;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      type Grupo = {
        destino: string;
        data_ida: string | null;
        data_volta: string | null;
        viagens: typeof viagens;
      };
      const grupos = new Map<string, Grupo>();
      for (const v of viagens) {
        const key = (v.destino || "").toLowerCase().trim();
        const g = grupos.get(key);
        if (g) {
          g.viagens.push(v);
          if (v.data_ida && (!g.data_ida || v.data_ida < g.data_ida)) g.data_ida = v.data_ida;
          if (v.data_volta && (!g.data_volta || v.data_volta > g.data_volta)) g.data_volta = v.data_volta;
        } else {
          grupos.set(key, {
            destino: v.destino,
            data_ida: v.data_ida,
            data_volta: v.data_volta,
            viagens: [v],
          });
        }
      }


      const eventos = await Promise.all(
        Array.from(grupos.entries()).map(async ([key, g]) => ({
          ...g,
          evento_hash: await sha1(key),
        })),
      );

      const allHashes = eventos.map((e) => e.evento_hash);

      // Excluídos pelo usuário — não recriar
      const { data: excluidos } = await admin
        .from("viagens_eventos_excluidos")
        .select("evento_hash")
        .in("evento_hash", allHashes);
      const excluidosSet = new Set((excluidos || []).map((e: any) => e.evento_hash));

      // Já existentes
      const orFilter = allHashes
        .map((h) => `observacao.ilike.%${EVENT_MARKER(h)}%`)
        .join(",");
      const { data: existing } = orFilter
        ? await admin.from("tarefas").select("id, observacao").or(orFilter)
        : { data: [] as any[] };
      const existentes = new Set<string>();
      for (const t of existing || []) {
        const m = (t.observacao || "").match(/\[evento:([a-f0-9]+)\]/);
        if (m) existentes.add(m[1]);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const novas = eventos
        .filter((e) => !existentes.has(e.evento_hash) && !excluidosSet.has(e.evento_hash))
        .map((e) => {
          let prioridade = "Média";
          if (e.data_ida) {
            const di = new Date(e.data_ida + "T00:00");
            const diff = (di.getTime() - today.getTime()) / 86400000;
            if (diff <= 7) prioridade = "Alta";
          }
          const total = e.viagens.reduce((a, v) => a + Number(v.valor_total || 0), 0);
          const desc = [
            `Evento: ${e.destino || "—"}`,
            `Período: ${fmtBR(e.data_ida)} → ${fmtBR(e.data_volta)}`,
            `Colaboradores: ${e.viagens.length}`,
            `Valor total: ${fmtBRL(total)}`,
            "",
            ...e.viagens.map(
              (v) =>
                `• ${v.colaborador || "—"} — ${v.dias} dia(s) — ${fmtBRL(Number(v.valor_total))} ${VIAGEM_MARKER(v.viagem_hash)}`,
            ),
            "",
            `Setor: Financeiro`,
            EVENT_MARKER(e.evento_hash),
          ].join("\n");

          const subtarefas = e.viagens.map((v) => ({
            id: crypto.randomUUID(),
            titulo: `${v.colaborador || "—"} — ${fmtBRL(Number(v.valor_total))}${v.dias ? ` (${v.dias}d)` : ""}`,
            responsavel: null,
            done: false,
          }));

          return {
            titulo: `Recarga de viagem - ${e.destino || "Sem evento"}`,
            observacao: desc,
            prazo: e.data_ida,
            prioridade,
            status: "Backlog",
            responsavel: RESPONSAVEL,
            subtarefas,
            ordem: 0,
          };
        });

      if (novas.length) {
        const { error: insErr } = await admin.from("tarefas").insert(novas);
        if (!insErr) tarefas_criadas = novas.length;
        else console.error("Erro criando tarefas:", insErr);
      }
    }

    return new Response(JSON.stringify({ viagens, tarefas_criadas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
