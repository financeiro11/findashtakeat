// Contexto organizacional (Biblioteca) injetado em todas as IAs do Hub.
// Lê das tabelas lib_* e devolve um bloco markdown compacto.
//
// Uso:
//   const ctx = await buildOrgContext(supabase);
//   const system = `${BASE_PROMPT}\n\n${ctx}`;

type SB = any;

const cap = (s: string | null | undefined, n: number) =>
  !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s;

export async function buildOrgContext(supabase: SB): Promise<string> {
  const [deps, cargos, ccs, colabs, forns, pols, notas] = await Promise.all([
    supabase.from("lib_departamentos").select("id,nome,descricao,gestor_id").order("nome"),
    supabase.from("lib_cargos").select("id,nome").order("nome"),
    supabase.from("lib_centros_custo").select("codigo,nome").order("nome"),
    supabase
      .from("lib_colaboradores")
      .select("nome,email,status,tags,cargo:lib_cargos(nome),departamento:lib_departamentos(nome),centro:lib_centros_custo(nome),gestor_id")
      .order("nome"),
    supabase
      .from("lib_fornecedores")
      .select("nome,categoria,documento,status,tags")
      .eq("status", "ativo")
      .order("nome")
      .limit(200),
    supabase
      .from("lib_politicas")
      .select("titulo,categoria,conteudo,aplica_a,tags,ativa")
      .eq("ativa", true)
      .order("titulo")
      .limit(50),
    supabase
      .from("base_conhecimento")
      .select("titulo,tipo,conteudo,created_at")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const depsRows = (deps.data || []) as any[];
  const colabsRows = (colabs.data || []) as any[];
  const ccsRows = (ccs.data || []) as any[];
  const cargosRows = (cargos.data || []) as any[];
  const fornsRows = (forns.data || []) as any[];
  const polsRows = (pols.data || []) as any[];
  const notasRows = (notas.data || []) as any[];
  // separa notas de empresa de planilhas importadas
  const isPlanilha = (n: any) =>
    /hist[oó]ric|dre|planilha|excel|vendas/i.test(n.tipo || "") ||
    String(n.conteudo || "").startsWith("Origem: planilha");
  const notasEmpresa = notasRows.filter((n) => !isPlanilha(n));

  // mapa de gestor por nome
  const colabById = new Map<string, string>();
  for (const c of colabsRows as any[]) colabById.set((c as any).id || "", c.nome);
  // gestor_id pode não vir; ignoramos se não tiver

  const parts: string[] = [];
  parts.push("=== CONTEXTO ORGANIZACIONAL (BIBLIOTECA) ===");
  parts.push(
    "Use estas informações como verdade sobre a empresa: nomes reais de colaboradores, departamentos, centros de custo, fornecedores recorrentes e políticas internas. " +
      "Sempre que uma pergunta envolver pessoas, áreas, fornecedores ou regras internas, prefira esses dados a suposições.",
  );

  if (depsRows.length) {
    parts.push(
      "\n## Departamentos\n" +
        depsRows
          .map((d) => `- ${d.nome}${d.descricao ? ` — ${cap(d.descricao, 120)}` : ""}`)
          .join("\n"),
    );
  }

  if (cargosRows.length) {
    parts.push("\n## Cargos\n" + cargosRows.map((c) => `- ${c.nome}`).join("\n"));
  }

  if (ccsRows.length) {
    parts.push(
      "\n## Centros de custo\n" +
        ccsRows.map((c) => `- ${c.codigo ? `[${c.codigo}] ` : ""}${c.nome}`).join("\n"),
    );
  }

  if (colabsRows.length) {
    const ativos = colabsRows.filter((c) => (c.status || "ativo") === "ativo");
    parts.push(
      `\n## Colaboradores ativos (${ativos.length})\n` +
        ativos
          .map((c) => {
            const dep = c.departamento?.nome || "";
            const cargo = c.cargo?.nome || "";
            const cc = c.centro?.nome || "";
            const meta = [cargo, dep, cc ? `CC: ${cc}` : ""].filter(Boolean).join(" · ");
            return `- ${c.nome}${meta ? ` (${meta})` : ""}${c.email ? ` — ${c.email}` : ""}`;
          })
          .join("\n"),
    );
  }

  if (fornsRows.length) {
    parts.push(
      `\n## Fornecedores ativos (${fornsRows.length})\n` +
        fornsRows
          .map((f) => {
            const meta = [f.categoria, f.documento].filter(Boolean).join(" · ");
            return `- ${f.nome}${meta ? ` (${meta})` : ""}`;
          })
          .join("\n"),
    );
  }

  if (polsRows.length) {
    parts.push(
      "\n## Políticas internas ativas\n" +
        polsRows
          .map((p) => {
            const tag = p.categoria ? `[${p.categoria}] ` : "";
            const aplica = Array.isArray(p.aplica_a) && p.aplica_a.length
              ? ` (aplica a: ${p.aplica_a.join(", ")})`
              : "";
            return `### ${tag}${p.titulo}${aplica}\n${cap(p.conteudo, 800)}`;
          })
          .join("\n\n"),
    );
  }

  if (notasEmpresa.length) {
    parts.push(
      "\n## Base de Conhecimento da empresa\n" +
        notasEmpresa
          .map((n) => {
            const tag = n.tipo ? `[${n.tipo}] ` : "";
            return `### ${tag}${n.titulo}\n${cap(n.conteudo, 1200)}`;
          })
          .join("\n\n"),
    );
  }

  if (parts.length === 2) {
    // só headers, biblioteca vazia
    return "=== CONTEXTO ORGANIZACIONAL (BIBLIOTECA) ===\n(Biblioteca ainda vazia — sem colaboradores, fornecedores ou políticas cadastrados.)";
  }

  return parts.join("\n");
}
