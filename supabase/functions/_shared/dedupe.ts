// SHA-256 hash for fallback deduplication
export async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

export async function makeHash(titulo: string, orgao?: string | null, dataPub?: string | null): Promise<string> {
  return await sha256([norm(titulo), norm(orgao ?? ""), dataPub ?? ""].join("|"));
}
