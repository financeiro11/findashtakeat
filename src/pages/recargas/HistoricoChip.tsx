// Histórico de um chip: recargas feitas e por quem ele passou.
//
// A tela principal mostra só a última recarga. Aqui a linha inteira aparece na
// vertical, para responder "quanto essa linha custou no semestre" e "quem estava com
// ela quando isso foi gasto" — perguntas que uma data só não responde.
//
// As duas listas vêm de tabelas diferentes de propósito: recarga é evento pontual,
// titularidade é intervalo. Um chip pode passar meses sem recarga e ainda assim trocar
// de dono no meio.

import { useEffect, useState } from "react";
import { CalendarCheck, User, Wallet, Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Recarga = {
  id: string;
  colaborador: string | null;
  valor: number | null;
  recarregado_em: string;
};

type Titular = {
  id: string;
  colaborador: string;
  de: string;
  ate: string | null;
};

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00`).toLocaleDateString("pt-BR") : "—";

// "3 meses", "1 ano e 2 meses" — dias soltos não ajudam a ler um período de posse.
function duracao(de: string, ate: string | null) {
  const ini = new Date(`${de}T00:00`);
  const fim = ate ? new Date(`${ate}T00:00`) : new Date();
  const meses = Math.max(
    0,
    (fim.getFullYear() - ini.getFullYear()) * 12 + (fim.getMonth() - ini.getMonth()),
  );
  if (meses < 1) return "menos de 1 mês";
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${resto ? ` e ${resto} ${resto === 1 ? "mês" : "meses"}` : ""}`;
}

export type HistoricoChipProps = {
  linhaId: string | null;
  titulo?: string;
  numero?: string | null;
  onOpenChange: (aberto: boolean) => void;
};

export default function HistoricoChip({ linhaId, titulo, numero, onOpenChange }: HistoricoChipProps) {
  const [recargas, setRecargas] = useState<Recarga[]>([]);
  const [titulares, setTitulares] = useState<Titular[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [semTabela, setSemTabela] = useState(false);

  useEffect(() => {
    if (!linhaId) return;
    let cancelado = false;

    (async () => {
      setCarregando(true);
      const [h, t] = await Promise.all([
        supabase
          .from("recargas_celulares_historico" as never)
          .select("id, colaborador, valor, recarregado_em")
          .eq("linha_id", linhaId)
          .order("recarregado_em", { ascending: false }),
        supabase
          .from("recargas_celulares_titulares" as never)
          .select("id, colaborador, de, ate")
          .eq("linha_id", linhaId)
          .order("de", { ascending: false }),
      ]);
      if (cancelado) return;
      setCarregando(false);

      // 42P01 = tabela inexistente; PGRST205 = schema cache do PostgREST sem ela.
      const faltando = [h.error, t.error].some(
        (e) => e && (e.code === "42P01" || e.code === "PGRST205"),
      );
      setSemTabela(faltando);
      if (faltando) return;

      setRecargas((h.data as unknown as Recarga[]) || []);
      setTitulares((t.data as unknown as Titular[]) || []);
    })();

    return () => {
      cancelado = true;
    };
  }, [linhaId]);

  const total = recargas.reduce((a, r) => a + Number(r.valor || 0), 0);

  return (
    <Dialog open={!!linhaId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            Histórico · {titulo || "Chip"}
            {numero && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{numero}</span>}
          </DialogTitle>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : semTabela ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            O histórico ainda não existe neste banco. Falta aplicar a migration{" "}
            <code>20260813150000_recargas_celulares_historico.sql</code>.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Titulares — quem estava com o chip, e por quanto tempo */}
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Quem esteve com o chip
              </h4>
              {!titulares.length ? (
                <p className="text-sm text-muted-foreground">Sem registro de titularidade.</p>
              ) : (
                <ol className="space-y-1.5">
                  {titulares.map((t) => (
                    <li
                      key={t.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2",
                        !t.ate && "border-primary/40 bg-primary/5",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.colaborador}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtData(t.de)} → {t.ate ? fmtData(t.ate) : "hoje"} · {duracao(t.de, t.ate)}
                        </div>
                      </div>
                      {!t.ate && (
                        <Badge variant="outline" className="rounded-full px-2 text-[10.5px] text-primary">
                          Atual
                        </Badge>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Recargas — o que foi gasto, com quem o chip estava na hora */}
            <section>
              <h4 className="mb-2 flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-1.5">
                  <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground" /> Recargas
                </span>
                {recargas.length > 0 && (
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" />
                    {recargas.length} · {fmtBRL(total)}
                  </span>
                )}
              </h4>
              {!recargas.length ? (
                <p className="text-sm text-muted-foreground">Nenhuma recarga registrada ainda.</p>
              ) : (
                <ol className="space-y-1.5">
                  {recargas.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{fmtData(r.recarregado_em)}</div>
                        {/* O nome vem congelado do momento da recarga — não é o dono de hoje. */}
                        <div className="truncate text-[11px] text-muted-foreground">
                          {r.colaborador || "—"}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm">{fmtBRL(Number(r.valor || 0))}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
