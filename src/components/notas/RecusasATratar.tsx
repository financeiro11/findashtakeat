/**
 * AS NOTAS QUE A PREFEITURA RECUSOU — e o que fazer com cada uma.
 *
 * Nasceu em 01/09/2026, no dia em que a emissão do Asaas foi desligada. Antes,
 * uma recusa era contratempo: o Asaas emitia a nota daquela cobrança de qualquer
 * jeito. Com o Omie como único emissor, recusa virou cliente SEM NOTA — e o que
 * não tem tela não é trabalhado.
 *
 * AGRUPADA POR AÇÃO, não por código de erro. "E0240, 49 casos" descreve o
 * defeito; o que a pessoa precisa é saber o que fazer, e são três coisas:
 *
 *   ✔ consertado        → a máquina já corrigiu o cadastro. Falta só reenviar.
 *   ✖ precisa_de_gente  → o cadastro bate com a Receita e mesmo assim recusa.
 *   ~ so_reenviar       → oscilação da prefeitura; não há cadastro a corrigir.
 *
 * O REENVIO NÃO TEM BOTÃO AQUI, e não é esquecimento: OS faturada com recusa não
 * volta pela API do Omie (dez métodos sondados, todos "Method not exists"). O
 * único caminho é o "Reenviar NFS-e" na tela do Omie. Prometer o botão aqui
 * seria pior do que não ter: a pessoa clicaria e nada aconteceria.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Check, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";

const sb = supabase as any;

type Recusa = {
  n_cod_os: number;
  c_num_os: string | null;
  id_cobranca: string | null;
  cnpj_cpf: string | null;
  nome: string | null;
  valor: number;
  data_faturamento: string | null;
  motivo: string | null;
  motivo_curto: string | null;
  cep: string | null;
  cep_generico: boolean | null;
  emitivel: boolean | null;
  situacao: "consertado" | "precisa_de_gente" | "so_reenviar";
  consertado_em: string | null;
  o_que_foi_feito: string | null;
};

const fmtBRL = (v: number) =>
  comValorExato(
    v,
    Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
  );

const dataBR = (d: string | null) => {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}` : d;
};

const GRUPOS = [
  {
    chave: "consertado" as const,
    titulo: "Já consertei o cadastro",
    ajuda: "Corrigi o endereço no ERP depois da recusa. Falta só reenviar a nota na tela do Omie.",
    Icone: Check,
    cor: "text-emerald-600 dark:text-emerald-400",
    borda: "border-l-emerald-500",
  },
  {
    chave: "precisa_de_gente" as const,
    titulo: "Precisam de você",
    ajuda:
      "O cadastro bate com a Receita e a prefeitura recusa mesmo assim — em geral endereço materialmente errado (logradouro com nome de cidade, número “00”). Conferir com o cliente.",
    Icone: AlertTriangle,
    cor: "text-amber-600 dark:text-amber-400",
    borda: "border-l-amber-500",
  },
  {
    chave: "so_reenviar" as const,
    titulo: "Só reenviar",
    ajuda: "A prefeitura oscilou. Não há cadastro a corrigir — reenviar costuma bastar.",
    Icone: RefreshCw,
    cor: "text-sky-600 dark:text-sky-400",
    borda: "border-l-sky-500",
  },
];

export default function RecusasATratar() {
  const [linhas, setLinhas] = useState<Recusa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState(45);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    sb.rpc("nfse_recusas_a_tratar", { p_dias: dias }).then(({ data, error }: any) => {
      if (!vivo) return;
      if (error) setErro(error.message);
      else {
        setErro(null);
        setLinhas((data ?? []) as Recusa[]);
      }
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [dias]);

  const total = useMemo(() => linhas.reduce((s, l) => s + Number(l.valor ?? 0), 0), [linhas]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo as recusas…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Não deu para ler as recusas: {erro}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div className="text-sm">
          <span className="font-semibold">{linhas.length}</span> nota(s) recusada(s) ·{" "}
          <span className="font-semibold">{fmtBRL(total)}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Com o Omie como único emissor, enquanto não saírem esses clientes ficam sem nota.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {[15, 45, 120].map((d) => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                dias === d
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {linhas.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nenhuma recusa no período. Tudo que foi emitido saiu.
        </div>
      )}

      {GRUPOS.map(({ chave, titulo, ajuda, Icone, cor, borda }) => {
        const itens = linhas.filter((l) => l.situacao === chave);
        if (!itens.length) return null;
        const soma = itens.reduce((s, l) => s + Number(l.valor ?? 0), 0);
        return (
          <section key={chave} className={cn("rounded-lg border border-l-4 border-border bg-card", borda)}>
            <header className="border-b border-border p-3">
              <h3 className={cn("flex items-center gap-2 text-sm font-semibold", cor)}>
                <Icone className="h-4 w-4" />
                {titulo}
                <span className="text-muted-foreground">
                  · {itens.length} · {fmtBRL(soma)}
                </span>
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
            </header>
            <div className="divide-y divide-border">
              {itens.map((l) => (
                <div key={l.n_cod_os} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-2.5 text-sm">
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    OS {l.c_num_os ?? l.n_cod_os}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.nome ?? "—"}</span>
                  <span className="num shrink-0">{fmtBRL(Number(l.valor ?? 0))}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {dataBR(l.data_faturamento)}
                  </span>
                  <div className="w-full text-xs text-muted-foreground">
                    {l.motivo_curto}
                    {l.cep_generico && <span className="ml-2 text-amber-600 dark:text-amber-400">[CEP de cidade]</span>}
                    {l.emitivel === false && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">[cadastro incompleto]</span>
                    )}
                    {l.o_que_foi_feito && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                        escrevi: {l.o_que_foi_feito}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-1 text-xs text-muted-foreground">
        Não há botão de reenviar aqui de propósito: OS faturada com recusa não volta pela API do Omie
        (dez métodos sondados, todos inexistentes). O caminho é o “Reenviar NFS-e” na tela do Omie.
      </p>
    </div>
  );
}
