// Aba "Auditoria" de /operacional/notas-fiscais — o que NÃO vira nota, e por quê.
//
// A PERGUNTA DESTA ABA é a anterior à do painel. O painel do mês responde "esta
// cobrança tem nota?"; aqui se responde "existe cobrança que nunca vai virar nota
// e ninguém vai ficar sabendo?".
//
// POR QUE ELA PRECISA EXISTIR: a fila da emissão automática é montada com dois
// INNER JOIN (cobrança → cliente do Asaas → cadastro do Omie pelo MESMO CNPJ). Um
// join que não casa não devolve erro, devolve ausência: a cobrança de um cliente
// sem cadastro no Omie não entra na fila, não aparece no log de emissões (que só
// registra o que foi tentado) e não aparece em lugar nenhum. Ela não falha — ela
// some. Esta tela é o lugar onde ela deixa de sumir.
//
// AS DUAS CONTAS, e é por isso que a tela tem duas metades:
//   • PRONTIDÃO (em cima) — a previsão. Enquanto o Asaas ainda emite, o buraco
//     está tapado por fora; a prontidão mede o cadastro sobre TODA cobrança
//     recebida, sem descontar quem estava coberto. É a conta que tem de zerar
//     antes do corte, e é a que enxerga os clientes de verdade.
//   • PARTIÇÃO (embaixo) — o que aconteceu. Todo pagamento do período cai em
//     exatamente um balde e a soma fecha com o total. É isso que faz disto
//     auditoria e não relatório: não há resto.
//
// O CONSERTO NÃO ACONTECE AQUI. Cadastrar cliente e corrigir CNPJ é no Omie —
// então o produto desta tela é a lista com o motivo e a instrução, mais o botão
// que a copia. Botão que "resolve" daqui seria promessa falsa.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { comValorExato } from "@/components/ValorExato";
import {
  ShieldCheck, ShieldAlert, Loader2, Copy, Search, RefreshCw, Info, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  BALDES, PRONTIDAO, clientesEmTexto, diasDoCadastro, formatarDoc, oQueFazer, vereditoProntidao,
  type Auditoria, type Balde, type ClasseProntidao, type ClienteFaltante,
} from "@/lib/notasFiscais";

const sb = supabase as any;

const brlStr = (n: number) => `R$ ${Math.round(n || 0).toLocaleString("pt-BR")}`;
const brl = (n: number) => comValorExato(n, brlStr(n));
const dataStr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

const TOM: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  aviso: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  erro: "bg-destructive/10 text-destructive border-destructive/20",
  neutro: "bg-muted text-muted-foreground border-border",
};

const GRUPOS = [
  ["travado", "Trava a emissão"],
  ["andamento", "Em andamento"],
  ["resolvido", "Resolvido"],
] as const;

export default function NotasFiscaisAuditoria({ de, ate }: { de: string; ate: string }) {
  const [dados, setDados] = useState<Auditoria | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizandoCadastro, setAtualizandoCadastro] = useState(false);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState<"todas" | ClasseProntidao>("todas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data, error } = await sb.rpc("notas_fiscais_auditoria", { p_de: de, p_ate: ate });
      if (error) throw error;
      setDados(data as Auditoria);
    } catch (e: any) {
      toast.error("Não foi possível auditar o período.", { description: e?.message });
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  /* O cadastro local do Omie é semanal e a emissão é diária: entre uma segunda e
   * a outra, cliente novo aparece aqui como "sem cadastro" sem que nada esteja
   * errado no Omie. Por isso o botão que repuxa o cadastro fica NESTA tela — é
   * aqui que a dúvida nasce, e conferir antes de sair cadastrando evita cadastrar
   * duplicado. É leitura no Omie; não escreve nada lá. */
  const atualizarCadastro = async () => {
    setAtualizandoCadastro(true);
    try {
      const { data, error } = await sb.functions.invoke("omie-clientes-sync", { body: {} });
      if (error) throw error;
      if (data?.erro) throw new Error(data.erro);
      toast.success(`${Number(data.clientes ?? 0).toLocaleString("pt-BR")} clientes lidos do Omie.`);
      await carregar();
    } catch (e: any) {
      toast.error("Falha ao reler o cadastro do Omie.", { description: e?.message });
    } finally {
      setAtualizandoCadastro(false);
    }
  };

  const veredito = useMemo(() => vereditoProntidao(dados?.prontidao ?? []), [dados]);
  const dias = diasDoCadastro(dados?.meta.cadastro_omie_em ?? null);

  const clientes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (dados?.clientes ?? []).filter((c) => {
      if (classe !== "todas" && c.classe !== classe) return false;
      if (!q) return true;
      // O documento entra cru E formatado: quem procura cola do Omie (com
      // pontuação) ou digita só os números.
      return [c.nome, c.doc, formatarDoc(c.doc), c.omie_nome, c.omie_doc, formatarDoc(c.omie_doc ?? "")]
        .some((s) => (s ?? "").toLowerCase().includes(q));
    });
  }, [dados, busca, classe]);

  const copiar = async () => {
    await navigator.clipboard.writeText(clientesEmTexto(clientes));
    toast.success(`${clientes.length} cliente(s) copiado(s).`, {
      description: "Colável em planilha — nome, documento, o que existe no Omie e quanto está parado.",
    });
  };

  if (carregando) {
    return <div className="p-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  }
  if (!dados) return null;

  const { meta } = dados;
  const porGrupo = (g: string) => dados.baldes
    .filter((b) => BALDES[b.balde as Balde]?.grupo === g)
    .sort((a, b) => b.cobrancas - a.cobrancas);

  return (
    <div className="space-y-4">
      {/* ------------------------------- veredito ------------------------------ */}
      {/* Uma frase, e ela responde a pergunta que trouxe a pessoa até aqui. O
          número grande é de COBRANÇAS porque é o que vira imposto não recolhido;
          clientes é o tamanho do trabalho de conserto, e vem ao lado. */}
      <div className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg border p-4",
        veredito.pronto ? TOM.ok : TOM.erro,
      )}>
        {veredito.pronto
          ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="flex-1">
          {veredito.pronto ? (
            <>
              <p className="text-sm font-semibold">
                Todas as {veredito.total.toLocaleString("pt-BR")} cobranças recebidas deste período têm cliente no Omie.
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                Se o Omie tivesse de emitir todas, nenhuma ficaria de fora por cadastro.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">
                <span className="num">{veredito.cobrancas.toLocaleString("pt-BR")}</span> cobranças
                {" "}({brl(veredito.valor)}) de <span className="num">{veredito.clientes.toLocaleString("pt-BR")}</span> clientes
                {" "}não virariam nota no Omie.
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                {meta.corte_vigente
                  ? "Elas não entram na fila e não aparecem no registro de emissões: a fila as descarta sem erro."
                  : `O corte é ${dataStr(meta.corte)} e até lá o Asaas ainda emite, então isto é previsão — ` +
                    "é o que passa a faltar no dia em que o Omie assumir sozinho."}
                {" "}São {(100 - veredito.cobertura * 100).toFixed(1)}% das cobranças recebidas do período.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------ prontidão ------------------------------ */}
      <div>
        <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
          Prontidão de cadastro — cobranças recebidas do período, pelo que a emissão precisa encontrar
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {(["ok", "cadastro_divergente", "sem_cadastro_omie", "sem_documento", "sem_cliente"] as ClasseProntidao[]).map((k) => {
            const p = dados.prontidao.find((x) => x.classe === k);
            const d = PRONTIDAO[k];
            const vazio = !p || p.cobrancas === 0;
            return (
              <div
                key={k}
                title={d.ajuda}
                className={cn("rounded-lg border bg-card p-3", vazio ? "border-border opacity-60" : TOM[d.tom])}
              >
                <p className="text-[11px] opacity-90">{d.rotulo}</p>
                <p className="num text-xl font-semibold">{(p?.cobrancas ?? 0).toLocaleString("pt-BR")}</p>
                <p className="truncate text-[11px] opacity-80">
                  {p?.clientes ? `${p.clientes.toLocaleString("pt-BR")} clientes · ` : ""}{brlStr(p?.valor ?? 0)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------- clientes a resolver ------------------------- */}
      {dados.clientes.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xs font-semibold text-muted-foreground">
              Clientes que a emissão não encontra ({dados.clientes.length.toLocaleString("pt-BR")})
            </h2>
            <div className="relative min-w-[180px]">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Cliente ou documento…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            {(["todas", "cadastro_divergente", "sem_cadastro_omie"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setClasse(f)}
                className={cn(
                  "rounded border px-2 py-1 text-[11px] transition-colors",
                  classe === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "todas" ? "Todos" : PRONTIDAO[f].rotulo}
              </button>
            ))}
            <button onClick={copiar} className="ghost-btn flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px]">
              <Copy className="h-3 w-3" /> Copiar lista
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/40">
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="p-2">Cliente no Asaas</th>
                  <th className="p-2">O que existe no Omie</th>
                  <th className="p-2 text-right">Cobranças</th>
                  <th className="p-2 text-right">Valor parado</th>
                  <th className="p-2">Última</th>
                  <th className="p-2">O que fazer</th>
                </tr>
              </thead>
              <tbody>
                {clientes.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum cliente neste recorte.</td></tr>
                )}
                {clientes.map((c) => (
                  <LinhaCliente key={c.doc} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------- partição ------------------------------ */}
      {/* A conferência: todo pagamento do período em exatamente um balde, e a soma
          fecha com o total. Se um dia não fechar, a partição tem furo — e é para
          isso que o total aparece escrito embaixo. */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground">
          Onde foi parar cada cobrança do período
        </h2>
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          {GRUPOS.map(([g, rotulo]) => {
            const linhas = porGrupo(g);
            if (!linhas.length) return null;
            return (
              <div key={g}>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">{rotulo}</p>
                <div className="space-y-1">
                  {linhas.map((b) => {
                    const d = BALDES[b.balde as Balde];
                    const pct = meta.total_cobrancas > 0 ? (b.cobrancas / meta.total_cobrancas) * 100 : 0;
                    return (
                      <div key={b.balde} className="flex items-center gap-2" title={d?.ajuda}>
                        <span className={cn("w-56 shrink-0 truncate rounded border px-1.5 py-0.5 text-[11px]", TOM[d?.tom ?? "neutro"])}>
                          {d?.rotulo ?? b.balde}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", d?.tom === "erro" ? "bg-destructive" : d?.tom === "aviso" ? "bg-amber-500" : d?.tom === "ok" ? "bg-emerald-500" : "bg-muted-foreground/40")}
                            style={{ width: `${Math.max(pct, 0.5)}%` }}
                          />
                        </div>
                        <span className="num w-16 shrink-0 text-right text-[11px]">{b.cobrancas.toLocaleString("pt-BR")}</span>
                        <span className="num w-24 shrink-0 text-right text-[11px] text-muted-foreground">{brl(b.valor)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" />
            {meta.total_cobrancas.toLocaleString("pt-BR")} cobranças no período, {brl(meta.total_valor)} — a soma dos baldes
            fecha com o total, então nenhuma linha ficou de fora da conta.
          </p>
        </div>
      </div>

      {/* -------------------------------- rodapé ------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          Cadastro do Omie: {meta.cadastro_omie_qtd.toLocaleString("pt-BR")} clientes, lido
          {dias === null ? " —" : dias === 0 ? " hoje" : dias === 1 ? " ontem" : ` há ${dias} dias`}.
        </span>
        {/* O sync é semanal e a emissão é diária. Cliente que entrou depois da
            última leitura aparece como "sem cadastro" sem culpa do Omie, e sair
            cadastrando nesse estado cria duplicado. */}
        {dias !== null && dias >= 2 && (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Cliente cadastrado no Omie depois dessa leitura ainda aparece como faltante — releia antes de cadastrar.
          </span>
        )}
        {meta.docs_duplicados > 0 && (
          <span
            className="flex items-center gap-1.5"
            title="A emissão resolve o cliente pelo menor código, e ninguém é avisado de que havia outro cadastro com o mesmo documento."
          >
            <AlertTriangle className="h-3 w-3" />
            {meta.docs_duplicados.toLocaleString("pt-BR")} documentos repetidos no cadastro do Omie.
          </span>
        )}
        <button
          onClick={atualizarCadastro}
          disabled={atualizandoCadastro}
          className="ghost-btn ml-auto flex items-center gap-1.5 rounded border border-border px-2 py-1"
        >
          {atualizandoCadastro ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Reler cadastro do Omie
        </button>
      </div>
    </div>
  );
}

/**
 * Uma linha da lista de conserto.
 *
 * Padrão visual do projeto (apelido em cima, nome cru embaixo) aplicado ao par de
 * cadastros: à esquerda o que o Asaas diz, à direita o que o Omie tem. É a
 * comparação lado a lado que faz o olho ver que "37.372.287/0002-71" e
 * "37.372.287/0001-90" são a mesma empresa em filiais diferentes — coisa que duas
 * telas separadas nunca mostram.
 */
function LinhaCliente({ c }: { c: ClienteFaltante }) {
  const d = PRONTIDAO[c.classe];
  return (
    <tr className="border-b border-border/50 last:border-0 align-top hover:bg-muted/30">
      <td className="max-w-[220px] p-2">
        <div className="truncate font-medium text-foreground" title={c.nome}>{c.nome || "—"}</div>
        <div className="num text-[11px] text-muted-foreground">{formatarDoc(c.doc)}</div>
      </td>
      <td className="max-w-[220px] p-2">
        {c.omie_doc ? (
          <>
            <div className="truncate text-foreground" title={c.omie_nome ?? ""}>{c.omie_nome}</div>
            <div className="num text-[11px] text-muted-foreground">{formatarDoc(c.omie_doc)}</div>
            {/* Raiz igual não é "parecido": é a mesma empresa. O selo diz isso
                para que ninguém trate os dois casos do mesmo jeito. */}
            <span
              className={cn(
                "mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[10px]",
                c.via === "raiz" ? TOM.erro : TOM.aviso,
              )}
              title={c.via === "raiz"
                ? "Os 8 primeiros dígitos do CNPJ são iguais: mesma empresa, outro estabelecimento."
                : `Nomes semelhantes (${Math.round((c.forca ?? 0) * 100)}%), documentos sem relação.`}
            >
              {c.via === "raiz" ? "mesma raiz de CNPJ" : `nome ${Math.round((c.forca ?? 0) * 100)}%`}
            </span>
          </>
        ) : (
          <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px]", TOM[d.tom])}>
            nada equivalente
          </span>
        )}
      </td>
      <td className="num p-2 text-right">
        {c.cobrancas.toLocaleString("pt-BR")}
        {/* A distinção entre "já está sem nota" e "o Asaas cobriu": a primeira é
            passivo de hoje, a segunda é o que estoura no corte. */}
        {c.sem_nota_hoje > 0 && (
          <div className="text-[10px] text-destructive" title="Cobranças que já estão sem nota em sistema nenhum">
            {c.sem_nota_hoje} sem nota hoje
          </div>
        )}
      </td>
      <td className="num p-2 text-right">{brl(Number(c.valor))}</td>
      <td className="num p-2">{dataStr(c.ultima)}</td>
      <td className="max-w-[300px] p-2 text-[11px] leading-tight text-muted-foreground">{oQueFazer(c)}</td>
    </tr>
  );
}
