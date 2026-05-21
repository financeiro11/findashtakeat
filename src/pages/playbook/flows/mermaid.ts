import type { Edge, Node } from "@xyflow/react";

function sanitize(id: string) {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
function esc(s: string) {
  return (s || "").replace(/"/g, "'").replace(/\n/g, " ");
}

export function flowToMermaid(nodes: Node[], edges: Edge[]): string {
  const lines: string[] = ["flowchart TD"];
  for (const n of nodes) {
    const id = sanitize(n.id);
    const label = esc(((n.data as any)?.label ?? n.type ?? "").toString());
    let shape = `["${label}"]`;
    if (n.type === "decision") shape = `{"${label}"}`;
    else if (n.type === "start" || n.type === "end") shape = `(["${label}"])`;
    else if (n.type === "subprocess") shape = `[["${label}"]]`;
    else if (n.type === "note") shape = `>"${label}"]`;
    else if (n.type === "lane") continue;
    lines.push(`  ${id}${shape}`);
  }
  for (const e of edges) {
    const s = sanitize(e.source);
    const t = sanitize(e.target);
    const lbl = e.label ? `|${esc(String(e.label))}|` : "";
    lines.push(`  ${s} -->${lbl} ${t}`);
  }
  return lines.join("\n");
}
