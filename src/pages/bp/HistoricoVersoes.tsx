import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, GitBranch, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { VERSAO_VIGENTE } from "./plano2026";
import { Card, Td, Th } from "./ui";

type Registro = { ano: number; linhas: number; atualizado: string | null };

export default function HistoricoVersoes() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    document.title = "BP · Histórico de versões";
    (async () => {
      const { data } = await supabase
        .from("bp_anual" as any)
        .select("ano, dados, updated_at")
        .order("ano", { ascending: false });
      setRegistros(
        ((data as any[]) ?? []).map((r) => ({
          ano: r.ano,
          linhas: Array.isArray(r.dados) ? r.dados.length : 0,
          atualizado: r.updated_at ?? null,
        })),
      );
      setCarregando(false);
    })();
  }, []);

  return (
    <div className="min-h-full bg-background">
      <div className="px-6 pt-5 pb-4">
        <h1 className="text-[26px] font-bold tracking-tight text-foreground">Histórico de versões</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] text-muted-foreground">
          Cada importação de planilha sobrescreve o BP do ano. O histórico completo, com versões
          nomeadas e comparação entre elas, entra quando o versionamento for para o banco.
        </p>
      </div>

      <div className="px-6 pb-10 space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <span className="text-[13px] font-semibold text-foreground">{VERSAO_VIGENTE.rotulo}</span>
            <span className="inline-flex items-center rounded bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              VIGENTE
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">{VERSAO_VIGENTE.descricao}</p>
        </div>

        <Card titulo="Planos importados" legenda="tabela bp_anual">
          {carregando ? (
            <p className="px-4 pb-4 text-[12px] text-muted-foreground">Carregando…</p>
          ) : registros.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] text-muted-foreground">Nenhum plano importado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-border bg-muted/40">
                    <Th alinhar="left" className="pl-4">ANO</Th>
                    <Th>LINHAS DA PLANILHA</Th>
                    <Th alinhar="left" className="pl-6">ÚLTIMA IMPORTAÇÃO</Th>
                    <Th className="pr-4">ABRIR</Th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.ano} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <Td alinhar="left" className="pl-4 font-semibold text-foreground">{r.ano}</Td>
                      <Td>{r.linhas}</Td>
                      <Td alinhar="left" className="pl-6 text-muted-foreground">
                        {r.atualizado
                          ? new Date(r.atualizado).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                          : "—"}
                      </Td>
                      <Td className="pr-4">
                        <Link
                          to={`/bp/${r.ano}`}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                        >
                          BP {r.ano} <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <History className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Para guardar versões nomeadas (vOriginal, vRevisão 1S, vRevisão 2S), marcar qual está
            vigente e comparar duas revisões lado a lado, é preciso uma tabela própria —{" "}
            <code className="rounded bg-background px-1 py-0.5 text-[10.5px]">bp_versoes</code> — no
            lugar do registro único por ano de <code className="rounded bg-background px-1 py-0.5 text-[10.5px]">bp_anual</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
