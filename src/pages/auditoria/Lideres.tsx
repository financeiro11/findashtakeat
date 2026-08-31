/**
 * Auditoria › Líderes — o outro lado do /l/<token>.
 *
 * O link do líder existia desde 07/2026 mas não tinha painel nenhum: `magic_tokens` era
 * escrita pelos modais de cobrança e nunca lida por tela alguma, então não dava para saber
 * quem abriu, quem nunca abriu, nem para revogar o acesso de alguém que saiu da empresa.
 *
 * A ordem da tela é deliberada: contestação em cima. É a única coisa aqui que o líder
 * iniciou e que fica parada até alguém responder — se ela ficar embaixo da tabela, ninguém
 * vê. O resto é consulta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { brl, fmtDateBR } from "./utils";
import { Link2, Copy, Ban, Flag, Check, X, Plus, Eye, EyeOff, RotateCcw } from "lucide-react";

const COMPETENCIA_INICIAL = "2026-08-01";

const MOTIVOS: Record<string, string> = {
  nao_e_meu: "Não é meu",
  nao_reconheco: "Não reconheço",
  valor_errado: "Valor errado",
  outro: "Outro motivo",
};

type Token = {
  token: string;
  responsavel: string;
  card_final: string | null;
  status: string;
  acessos: number;
  ultimo_acesso: string | null;
  fatura_abertura_em: string | null;
  criado_em: string;
};

type Lanc = {
  id_unico: string;
  card_final: string | null;
  gestor: string | null;
  time: string | null;
  valor: number;
  status_nf: string;
  link_comprovante: string | null;
  estabelecimento: string | null;
  data: string | null;
};

type Contestacao = {
  id: string;
  id_unico: string;
  card_final: string;
  responsavel: string | null;
  motivo: string;
  texto: string | null;
  status: string;
  criado_em: string;
};

type Portador = {
  id: string;
  card_final: string;
  nome: string;
  time: string | null;
  status: "ativo" | "encerrado";
  acesso_ate: string | null;
  encerrado_em: string | null;
  motivo: string | null;
};

/** Uma linha da tabela: o cartão, quem é o dono, e o estado do link dele. */
type Cartao = {
  card_final: string;
  gestor: string;
  time: string | null;
  lancamentos: number;
  total: number;
  pendentes: number;
  comNota: number;
  token: Token | null;
  portador: Portador | null;
  /** encerrado mas ainda no prazo de graça */
  encerrando: boolean;
};

export default function Lideres({ abas }: { abas?: React.ReactNode }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [lancs, setLancs] = useState<Lanc[]>([]);
  const [portadores, setPortadores] = useState<Portador[]>([]);
  const [contestacoes, setContestacoes] = useState<Contestacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarResolvidas, setMostrarResolvidas] = useState(false);
  const [mostrarEncerrados, setMostrarEncerrados] = useState(false);

  const carregar = useCallback(async () => {
    const [t, l, p, c] = await Promise.all([
      supabase.from("magic_tokens")
        .select("token, responsavel, card_final, status, acessos, ultimo_acesso, fatura_abertura_em, criado_em")
        .neq("status", "revogado"),
      supabase.from("auditoria_cartao_lancamentos")
        .select("id_unico, card_final, gestor, time, valor, status_nf, link_comprovante, estabelecimento, data")
        .gte("competencia", COMPETENCIA_INICIAL)
        .limit(5000),
      supabase.from("cartao_portadores").select("*"),
      supabase.from("cartao_contestacoes")
        .select("*").order("criado_em", { ascending: false }),
    ]);
    if (t.error || l.error || p.error || c.error) toast.error("Erro ao carregar o painel dos líderes");
    setTokens((t.data ?? []) as Token[]);
    setLancs((l.data ?? []) as Lanc[]);
    setPortadores((p.data ?? []) as Portador[]);
    setContestacoes((c.data ?? []) as Contestacao[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* A lista sai de `cartao_portadores`, não dos lançamentos: é o cadastro que sabe quem
     encerrou, e é dele que vem UM nome por cartão — nos lançamentos o mesmo Luiz aparece
     como "Luiz PC Chacara" e "Luiz P C Chácara" e viraria duas pessoas com meia fatura. */
  const cartoes = useMemo<Cartao[]>(() => {
    const stats = new Map<string, { lancamentos: number; total: number; pendentes: number; comNota: number }>();
    for (const r of lancs) {
      if (!r.card_final) continue;
      const s = stats.get(r.card_final) ?? { lancamentos: 0, total: 0, pendentes: 0, comNota: 0 };
      s.lancamentos += 1;
      s.total += Number(r.valor || 0);
      if (r.link_comprovante) s.comNota += 1;
      else if (!["OK", "ENCARGO", "DISPENSADO (<piso)", "SEM NF-ESPERADO", "PARCELA (origem)"].includes(r.status_nf)) {
        s.pendentes += 1;
      }
      stats.set(r.card_final, s);
    }

    const agora = Date.now();
    return portadores.map(p => {
      const s = stats.get(p.card_final) ?? { lancamentos: 0, total: 0, pendentes: 0, comNota: 0 };
      return {
        card_final: p.card_final,
        gestor: p.nome,
        time: p.time,
        ...s,
        token: tokens.find(t => t.card_final === p.card_final && p.status === "ativo") ?? null,
        portador: p,
        encerrando: p.status === "encerrado"
          && !!p.acesso_ate && new Date(p.acesso_ate).getTime() > agora,
      };
    }).sort((a, b) =>
      // Ativos primeiro; dentro de cada grupo, quem gasta mais em cima.
      Number(b.portador?.status === "ativo") - Number(a.portador?.status === "ativo")
      || b.total - a.total);
  }, [lancs, tokens, portadores]);

  const ativos = cartoes.filter(c => c.portador?.status === "ativo" || c.encerrando);
  const encerrados = cartoes.filter(c => c.portador?.status === "encerrado" && !c.encerrando);
  const visiveis = mostrarEncerrados ? [...ativos, ...encerrados] : ativos;

  const abertas = contestacoes.filter(c => c.status === "aberta");
  const fechadas = contestacoes.filter(c => c.status !== "aberta");
  const porIdUnico = useMemo(() => new Map(lancs.map(l => [l.id_unico, l])), [lancs]);

  const responder = async (c: Contestacao, status: "resolvida" | "recusada") => {
    const { error } = await supabase.from("cartao_contestacoes")
      .update({ status, resolvido_em: new Date().toISOString() })
      .eq("id", c.id);
    if (error) { toast.error("Não foi possível gravar"); return; }
    toast.success(status === "resolvida" ? "Contestação aceita" : "Contestação recusada");
    await carregar();
  };

  const copiarLink = async (t: Token) => {
    const url = `${window.location.origin}/l/${t.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado", { description: url });
    } catch {
      toast.error("Não consegui copiar", { description: url });
    }
  };

  /* Não há mais botão de "criar link": todo cartão ativo já nasce com o dele, garantido
     pelo gatilho no banco. Este botão existe só para o caso raro de alguém ter revogado
     à mão e querer de volta. */
  const recriarLink = async () => {
    const { data, error } = await supabase.rpc("garantir_links_dos_cartoes");
    if (error) { toast.error("Não foi possível criar os links", { description: error.message }); return; }
    const n = Number(data ?? 0);
    toast.success(n > 0 ? `${n} link${n === 1 ? "" : "s"} criado${n === 1 ? "" : "s"}`
                        : "Todo cartão ativo já tinha link");
    await carregar();
  };

  const encerrar = async (c: Cartao) => {
    const resposta = prompt(
      `Encerrar o cartão de ${c.gestor}.\n\n` +
      `Por quantos dias ele ainda deve conseguir abrir o link para enviar o que ficou ` +
      `pendente? (0 fecha na hora)` +
      (c.pendentes > 0 ? `\n\nAtenção: ele tem ${c.pendentes} lançamento(s) sem resposta.` : ""),
      c.pendentes > 0 ? "7" : "0",
    );
    if (resposta === null) return;
    const dias = Number(resposta);
    if (!Number.isFinite(dias) || dias < 0 || dias > 90) {
      toast.error("Informe um número de dias entre 0 e 90"); return;
    }
    const motivo = prompt("Motivo (opcional):", "Colaborador desligado") ?? null;

    const { data, error } = await supabase.rpc("encerrar_cartao", {
      p_card_final: c.card_final, p_dias_graca: dias, p_motivo: motivo,
    });
    const r = data as { ok?: boolean; erro?: string } | null;
    if (error || !r?.ok) { toast.error(r?.erro || error?.message || "Não foi possível encerrar"); return; }
    toast.success(dias > 0
      ? `Cartão encerrado — o link fecha em ${dias} dia${dias === 1 ? "" : "s"}`
      : "Cartão encerrado — o link já não abre");
    await carregar();
  };

  const reativar = async (c: Cartao) => {
    if (!confirm(`Reativar o cartão de ${c.gestor}? Ele volta a ver a própria fatura.`)) return;
    const { data, error } = await supabase.rpc("reativar_cartao", { p_card_final: c.card_final });
    const r = data as { ok?: boolean; erro?: string } | null;
    if (error || !r?.ok) { toast.error(r?.erro || error?.message || "Não foi possível reativar"); return; }
    toast.success("Cartão reativado");
    await carregar();
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 pt-3 pb-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Hub Financeiro · Governança
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-0.5">Líderes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            O link que cada líder usa para ver a própria fatura · acessos, contestações e revogação.
          </p>
        </div>
        <div className="flex items-center gap-2">{abas}</div>
      </div>

      {/* Contestações — primeiro porque é o que espera resposta */}
      {loading ? <Skeleton className="h-24 rounded-xl" /> : (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Flag className="h-3.5 w-3.5 text-[hsl(38_92%_40%)]" />
            <h2 className="text-sm font-semibold">Contestações</h2>
            {abertas.length > 0 && (
              <span className="num rounded-full bg-[hsl(38_92%_95%)] px-2 py-0.5 text-[11px] font-semibold text-[hsl(30_80%_35%)]">
                {abertas.length} aberta{abertas.length === 1 ? "" : "s"}
              </span>
            )}
            {fechadas.length > 0 && (
              <button
                onClick={() => setMostrarResolvidas(v => !v)}
                className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {mostrarResolvidas ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {mostrarResolvidas ? "Esconder" : "Ver"} as {fechadas.length} já respondidas
              </button>
            )}
          </header>

          {abertas.length === 0 && !mostrarResolvidas ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum líder contestou nada. Quando alguém disser que um gasto não é dele, aparece aqui.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {[...abertas, ...(mostrarResolvidas ? fechadas : [])].map(c => {
                const lanc = porIdUnico.get(c.id_unico);
                const aberta = c.status === "aberta";
                return (
                  <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          aberta
                            ? "border-[hsl(38_92%_85%)] bg-[hsl(38_92%_95%)] text-[hsl(30_80%_35%)]"
                            : "border-border bg-muted text-muted-foreground",
                        )}>
                          {MOTIVOS[c.motivo] ?? c.motivo}
                        </span>
                        <span className="text-sm font-medium">
                          {lanc?.estabelecimento ?? c.id_unico}
                        </span>
                        {lanc && <span className="num text-sm text-muted-foreground">{brl(Number(lanc.valor))}</span>}
                        {!aberta && (
                          <span className="text-[11px] text-muted-foreground">
                            · {c.status === "resolvida" ? "aceita" : "recusada"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {c.responsavel} · cartão •••• {c.card_final}
                        {lanc?.data && <> · {fmtDateBR(lanc.data)}</>}
                        <> · contestado em {fmtDateBR(c.criado_em)}</>
                      </div>
                      {c.texto && <p className="mt-1.5 text-[13px] leading-snug">"{c.texto}"</p>}
                    </div>
                    {aberta && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => responder(c, "resolvida")}>
                          <Check className="mr-1 h-3 w-3" />Aceitar
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => responder(c, "recusada")}>
                          <X className="mr-1 h-3 w-3" />Recusar
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Um cartão por linha */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Cartões</h2>
          <span className="text-[11px] text-muted-foreground">
            {ativos.length} ativo{ativos.length === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {encerrados.length > 0 && (
              <button
                onClick={() => setMostrarEncerrados(v => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {mostrarEncerrados ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {mostrarEncerrados ? "Esconder" : "Ver"} os {encerrados.length} encerrados
              </button>
            )}
            <button
              onClick={recriarLink}
              title="Cria o link de qualquer cartão ativo que esteja sem — normalmente não é preciso"
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" />Conferir links
            </button>
          </div>
        </header>

        <div className="grid grid-cols-[1.3fr_100px_78px_105px_80px_86px_1fr_128px] gap-3 border-b border-border px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>Líder</div>
          <div>Time</div>
          <div>Cartão</div>
          <div className="text-right">Fatura</div>
          <div className="text-right">Com nota</div>
          <div className="text-right">Pendentes</div>
          <div>Acesso</div>
          <div className="text-right">Ações</div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : visiveis.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum cartão cadastrado ainda.
          </p>
        ) : visiveis.map(c => {
          const fechado = c.portador?.status === "encerrado" && !c.encerrando;
          return (
            <div
              key={c.card_final}
              className={cn(
                "grid grid-cols-[1.3fr_100px_78px_105px_80px_86px_1fr_128px] items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0 hover:bg-muted/30",
                fechado && "opacity-55",
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{c.gestor}</div>
                {c.encerrando && (
                  <div className="truncate text-[11px] text-[hsl(30_80%_40%)]">
                    encerrado · acesso até {fmtDateBR(c.portador!.acesso_ate)}
                  </div>
                )}
                {fechado && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {c.portador?.motivo || "encerrado"}
                  </div>
                )}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">{c.time ?? "—"}</div>
              <div className="num text-[12px] text-muted-foreground">•••• {c.card_final}</div>
              <div className="num text-right">{brl(c.total)}</div>
              <div className="num text-right text-[hsl(152_60%_36%)]">{c.comNota}</div>
              <div className={cn("num text-right", c.pendentes > 0 && "font-semibold text-[hsl(30_80%_40%)]")}>
                {c.pendentes}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {!c.token ? "—"
                  : c.token.acessos === 0 ? <span className="text-[hsl(30_80%_40%)]">nunca abriu</span>
                  : <>{c.token.acessos} acesso{c.token.acessos === 1 ? "" : "s"}
                    {c.token.ultimo_acesso && <> · {fmtDateBR(c.token.ultimo_acesso)}</>}
                    {c.token.fatura_abertura_em && <> · viu a fatura</>}</>}
              </div>
              <div className="flex items-center justify-end gap-1">
                {c.token && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copiarLink(c.token!)} title="Copiar o link do líder">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <a
                      href={`/l/${c.token.token}`} target="_blank" rel="noreferrer"
                      title="Abrir o link como o líder vê"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Link2 className="h-3 w-3" />
                    </a>
                  </>
                )}
                {fechado ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-foreground"
                          title="Reativar o cartão" onClick={() => reativar(c)}>
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" title="Encerrar o cartão"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => encerrar(c)}>
                    <Ban className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Todo cartão ativo tem link, criado sozinho — não depende de você ter cobrado alguma
        coisa. O líder confirma os 4 últimos dígitos para abrir a fatura, então o link
        encaminhado sozinho não mostra os gastos; cinco erros deixam o link dormindo por 15
        minutos, e o link em si nunca expira. Ao encerrar um cartão você escolhe por quantos
        dias ele ainda abre, para a pessoa terminar de enviar o que devia — o histórico dela
        continua aqui para sempre. A fatura começa em {fmtDateBR(COMPETENCIA_INICIAL)}: antes
        disso o .ofx do Sicoob vem consolidado num cartão só, sem separar por portador.
      </p>
    </div>
  );
}
