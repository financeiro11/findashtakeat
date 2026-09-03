import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BellRing, Check, ChevronDown, ChevronRight, ExternalLink, Loader2,
  Mail, Pencil, Plane, Plus, RefreshCw, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { comValorExato } from "@/components/ValorExato";
import { db, fmtBRL as fmtBRLStr, fmtData, parseValor } from "./lib";
import { aeroporto, diasAte, linkGoogleFlights, rotaTexto } from "@/lib/passagens";
/* CAMADA 2 — a MESMA régua de teto do Radar, não uma segunda. Duas divergiriam
   no primeiro ajuste, e o sintoma seria as duas telas discordando sobre o que é
   um teto bom. `sugerirTeto` é determinística e testada; a curva de passagens
   chega no formato dela por `passagens_curva_diaria`. */
import { sugerirTeto, DIAS_PARA_SUGERIR, type PontoHistorico } from "@/lib/radarPrecos";
import { NovaViagemDialog, type ViagemRow } from "./NovaViagemDialog";

/* Valor arredondado na tela, número cheio no hover — convenção do Hub. */
const fmtBRL = (v: number | null | undefined) => comValorExato(v, fmtBRLStr(v));

interface Linha {
  viagem: ViagemRow & { created_at: string; preco_comprado: number | null; comprado_em: string | null };
  menor_visto: number | null;
  menor_em: string | null;
  ultimo_preco: number | null;
  ultimo_em: string | null;
  primeiro_preco: number | null;
  pontos: number;
}

interface EmailOrfao {
  id: number;
  assunto: string | null;
  recebido_em: string | null;
  preco: number | null;
  motivo: string | null;
}

interface Ponto { preco: number; fonte: string; coletado_em: string }

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  rastreando: { label: "rastreando", cls: "bg-muted text-muted-foreground border-border" },
  comprada:   { label: "comprada",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900" },
  cancelada:  { label: "cancelada",  cls: "bg-muted text-muted-foreground border-border" },
  expirada:   { label: "expirada",   cls: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
};

export default function Passagens() {
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [orfaos, setOrfaos] = useState<EmailOrfao[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [curvas, setCurvas] = useState<Record<string, Ponto[]>>({});
  /** A mesma curva agregada por dia, no formato que `sugerirTeto` consome. */
  const [diarias, setDiarias] = useState<Record<string, PontoHistorico[]>>({});
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<ViagemRow | null>(null);
  const [lendo, setLendo] = useState(false);
  const [precoManual, setPrecoManual] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, o] = await Promise.all([
      db.rpc("passagens_painel"),
      db.from("passagens_emails")
        .select("id, assunto, recebido_em, preco, motivo")
        .is("viagem_id", null)
        .order("created_at", { ascending: false }).limit(30),
    ]);
    setLinhas((p.data as Linha[]) ?? []);
    setOrfaos((o.data as EmailOrfao[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const abertas = useMemo(() => linhas.filter((l) => l.viagem.status === "rastreando"), [linhas]);
  /* Quantas ainda não têm o alerta ligado no Google. É a falha mais silenciosa
     do módulo: a viagem existe, o teto existe, e nunca chega preço nenhum. */
  const semAlerta = useMemo(() => abertas.filter((l) => !l.viagem.rastreando_em).length, [abertas]);
  /* O espelho da anterior: viagem já fechada cujo alerta ninguém desligou no
     Google. A expiração é automática, então esta é a fila que cresce sem que
     ninguém tenha clicado em nada — e ela vira e-mail órfão daqui a semanas. */
  const rastreioOrfao = useMemo(
    () => linhas.filter((l) => l.viagem.status !== "rastreando" && l.viagem.rastreando_em).length,
    [linhas],
  );

  async function expandir(id: string) {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (curvas[id]) return;
    const [{ data }, { data: diaria }] = await Promise.all([
      db.from("passagens_precos")
        .select("preco, fonte, coletado_em").eq("viagem_id", id)
        .order("coletado_em", { ascending: false }).limit(60),
      db.rpc("passagens_curva_diaria", { p_viagem_id: id, p_dias: 180 }),
    ]);
    setCurvas((c) => ({ ...c, [id]: (data as Ponto[]) ?? [] }));
    setDiarias((d) => ({ ...d, [id]: (diaria as PontoHistorico[]) ?? [] }));
  }

  async function lerCaixa() {
    setLendo(true);
    try {
      const r = await invocar<any>(supabase.functions.invoke("passagens-gmail-sync", {
        body: { action: "sync", dias: 7 },
      }));
      if (r.mensagem) toast.info(r.mensagem, { duration: 9000 });
      else {
        const partes = [`${r.lidos} e-mail(s) novo(s)`];
        if (r.casados) partes.push(`${r.casados} casado(s) com viagem`);
        if (r.avisos) partes.push(`${r.avisos} aviso(s) no sino`);
        if (r.orfaos) partes.push(`${r.orfaos} sem dono`);
        if (r.ja_vistos) partes.push(`${r.ja_vistos} já lido(s) antes`);
        toast.success(partes.join(" · "), { duration: 9000 });
      }
      setCurvas({});
      setDiarias({});
      await load();
    } catch (e: any) {
      toast.error(`Não deu para ler a caixa: ${e.message ?? e}`);
    } finally {
      setLendo(false);
    }
  }

  /** O preço digitado passa pela função, não por insert direto — é lá que mora
   *  a decisão do teto e a abertura do sinal. */
  async function registrarPreco(viagemId: string) {
    const v = parseValor(precoManual[viagemId] ?? "");
    if (!v || v <= 0) { toast.error("Digite o preço que você viu."); return; }
    setOcupado(viagemId);
    try {
      const r = await invocar<any>(supabase.functions.invoke("passagens-gmail-sync", {
        body: { action: "preco", viagem_id: viagemId, preco: v },
      }));
      toast.success(r.avisou ? `Preço gravado — e virou aviso: ${r.motivo}.` : `Preço gravado. ${r.motivo}.`);
      setPrecoManual((p) => ({ ...p, [viagemId]: "" }));
      setCurvas((c) => { const n = { ...c }; delete n[viagemId]; return n; });
      setDiarias((d) => { const n = { ...d }; delete n[viagemId]; return n; });
      await load();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Fecha a viagem — e lembra da METADE QUE O HUB NÃO CONTROLA.
   *
   * Desligar o rastreamento tem dois lados, e o Hub só manda num deles. Aqui a
   * viagem para de casar e-mail (o casador só olha `rastreando`); no Google, o
   * alerta continua vivo e mandando para sempre, porque não existe API para
   * removê-lo — mesmo motivo de ligar ter exigido clique humano.
   * Sem este lembrete, o entulho aparece semanas depois na lista de órfãos,
   * quando ninguém mais liga o e-mail à viagem que fechou.
   */
  async function mudarStatus(l: Linha, status: string, preco?: number) {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "comprada") { patch.preco_comprado = preco ?? null; patch.comprado_em = new Date().toISOString(); }
    const { error } = await db.from("passagens_viagens").update(patch).eq("id", l.viagem.id);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "comprada" ? "Viagem marcada como comprada." : `Viagem ${status}.`);
    if (l.viagem.rastreando_em) {
      const link = l.viagem.google_url ?? linkGoogleFlights({
        origem: l.viagem.origem, destino: l.viagem.destino,
        data_ida: l.viagem.data_ida, data_volta: l.viagem.data_volta,
      });
      toast.warning(
        "Falta desligar o rastreamento no Google — senão os e-mails desta rota continuam chegando para sempre.",
        { duration: 15000, action: { label: "Abrir no Google", onClick: () => window.open(link, "_blank", "noreferrer") } },
      );
    }
    load();
  }

  /**
   * "Já desliguei lá" — devolve `rastreando_em` para null.
   *
   * A coluna quer dizer UMA coisa: o alerta do Google está ligado para esta
   * viagem. Ligar preenche, desligar zera. Reusar o mesmo campo (em vez de criar
   * um `rastreio_encerrado_em`) é o que faz o selo sumir sozinho quando o
   * trabalho foi feito — e selo que não some é selo que se aprende a ignorar.
   */
  async function desligarRastreio(l: Linha) {
    const { error } = await db.from("passagens_viagens")
      .update({ rastreando_em: null, updated_at: new Date().toISOString() })
      .eq("id", l.viagem.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Anotado: o Google não rastreia mais esta rota.");
    load();
  }

  async function marcarRastreando(l: Linha) {
    const { error } = await db.from("passagens_viagens")
      .update({ rastreando_em: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", l.viagem.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marcada como rastreada — agora o alerta do Google alimenta a curva.");
    load();
  }

  async function apagar(l: Linha) {
    /* Duas perdas e uma pendência, ditas antes: a curva some, e o alerta do
       Google NÃO some. Quem quer só encerrar a viagem tem "Comprei" e "Cancelar
       viagem", que preservam o histórico — excluir é para o que foi cadastrado
       errado. */
    const aviso = [
      `Excluir a viagem ${rotaTexto(l.viagem.origem, l.viagem.destino)}?`,
      "",
      "O histórico de preço dela vai junto.",
      l.viagem.rastreando_em
        ? "E o alerta continua ligado no Google: os e-mails vão continuar chegando, sem viagem para casar. Desligue lá antes."
        : "",
      "Para só encerrar a viagem sem perder a curva, use “Comprei” ou “Cancelar viagem”.",
    ].filter(Boolean).join("\n");
    if (!window.confirm(aviso)) return;
    const { error } = await db.from("passagens_viagens").delete().eq("id", l.viagem.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Viagem excluída.");
    load();
  }

  async function atribuir(emailId: number, viagemId: string) {
    try {
      await invocar<any>(supabase.functions.invoke("passagens-gmail-sync", {
        body: { action: "atribuir", email_id: emailId, viagem_id: viagemId },
      }));
      toast.success("E-mail atribuído — o preço entrou na curva da viagem.");
      setCurvas({});
      setDiarias({});
      await load();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Passagens</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            Registre a viagem marcada e o quanto vale a pena pagar. Quem vigia o preço é o{" "}
            <span className="font-medium text-foreground">alerta do Google Flights</span>, de graça; o Hub lê os
            e-mails que ele manda e só faz barulho quando o preço entra no seu teto — não a cada vez que ele mexe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={lerCaixa} disabled={lendo}>
            {lendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Ler a caixa agora
          </Button>
          <Button onClick={() => { setEditando(null); setDialogAberto(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Nova viagem
          </Button>
        </div>
      </div>

      {/* O PASSO MANUAL PRECISA GRITAR. Viagem sem alerta ligado no Google nunca
          recebe e-mail: fica na tela, com teto, parecendo monitorada, e em
          silêncio para sempre. É o único jeito de este módulo falhar sem dar
          erro nenhum. */}
      {semAlerta > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">{semAlerta} viagem(ns) sem o alerta ligado no Google.</span>{" "}
            Enquanto ninguém abrir o link e clicar em "Rastrear preços", nenhum e-mail chega e a curva fica vazia —
            o Hub não tem como buscar preço sozinho.
          </span>
        </div>
      )}

      {rastreioOrfao > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">{rastreioOrfao} viagem(ns) fechada(s) com o alerta ainda ligado no Google.</span>{" "}
            Elas já não casam e-mail nenhum, então o que chegar vai para "Alertas sem dono". Abra a linha e desligue
            o rastreamento lá — o Hub não consegue fazer isso por você.
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-md" />)}</div>
      ) : linhas.length === 0 ? (
        <div className="card-surface py-16 text-center">
          <Plane className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <div className="mt-3 text-[13px] text-muted-foreground">
            Nenhuma viagem ainda. Cadastre a próxima que já está marcada — com o teto que faria valer a pena comprar.
          </div>
          <Button className="mt-4" onClick={() => { setEditando(null); setDialogAberto(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Nova viagem
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {linhas.map((l) => {
            const v = l.viagem;
            const st = STATUS_STYLE[v.status] ?? STATUS_STYLE.rastreando;
            const expandido = aberto === v.id;
            const dias = diasAte(v.data_ida);
            const noTeto = l.ultimo_preco != null && Number(l.ultimo_preco) <= Number(v.teto);
            const variacao = l.primeiro_preco && l.ultimo_preco
              ? ((Number(l.ultimo_preco) - Number(l.primeiro_preco)) / Number(l.primeiro_preco)) * 100
              : null;
            const link = v.google_url ?? linkGoogleFlights({
              origem: v.origem, destino: v.destino, data_ida: v.data_ida, data_volta: v.data_volta,
            });

            return (
              <div key={v.id} className={cn("card-surface", v.status !== "rastreando" && "opacity-70")}>
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <button
                    type="button" onClick={() => expandir(v.id)}
                    className="ghost-icone mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={expandido ? "Fechar" : "Ver o histórico"}
                  >
                    {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="num text-[14px] font-semibold text-foreground">
                        {rotaTexto(v.origem, v.destino)}
                      </span>
                      <span className="text-[11.5px] text-muted-foreground">
                        {aeroporto(v.origem)?.cidade ?? v.origem} → {aeroporto(v.destino)?.cidade ?? v.destino}
                      </span>
                      <span className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-medium", st.cls)}>{st.label}</span>
                      {v.status === "rastreando" && !v.rastreando_em && (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                          title="Ninguém ligou o alerta no Google Flights — sem isso não chega e-mail e a curva não anda."
                        >
                          <BellRing className="h-3 w-3" /> alerta desligado
                        </span>
                      )}
                      {noTeto && v.status === "rastreando" && (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                          dentro do teto
                        </span>
                      )}
                      {/* A PENDÊNCIA QUE SÓ EXISTE FORA DO HUB. Viagem fechada
                          com o alerta ainda ligado lá continua gerando e-mail
                          para sempre — e como a expiração é automática, para a
                          maioria dos casos ninguém viu toast nenhum. Selo, e não
                          aviso de passagem: some sozinho quando o trabalho for
                          feito, que é o que o impede de virar ruído. */}
                      {v.status !== "rastreando" && v.rastreando_em && (
                        <span
                          className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                          title="A viagem fechou, mas o alerta continua ligado no Google — os e-mails desta rota seguem chegando sem ter com o que casar."
                        >
                          <BellRing className="h-3 w-3" /> Google ainda rastreia
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {fmtData(v.data_ida)}{v.data_volta ? ` – ${fmtData(v.data_volta)}` : " · só ida"}
                      {v.status === "rastreando" && (
                        <span className={cn(dias <= 7 && dias >= 0 && "text-amber-700 dark:text-amber-400")}>
                          {" · "}{dias > 0 ? `em ${dias} dia(s)` : dias === 0 ? "é hoje" : `há ${Math.abs(dias)} dia(s)`}
                        </span>
                      )}
                      {v.quem_viaja && ` · ${v.quem_viaja}`}
                      {v.motivo && ` · ${v.motivo}`}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Teto</div>
                    <div className="num text-[13px] font-medium text-foreground">{fmtBRL(Number(v.teto))}</div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      {v.status === "comprada" ? "Pago" : "Último visto"}
                    </div>
                    {v.status === "comprada" && v.preco_comprado ? (
                      <div className="num text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {fmtBRL(Number(v.preco_comprado))}
                      </div>
                    ) : l.ultimo_preco != null ? (
                      <div className={cn("num text-[13px] font-semibold", noTeto ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                        {fmtBRL(Number(l.ultimo_preco))}
                        {variacao != null && Math.abs(variacao) >= 1 && (
                          <span className={cn("ml-1 text-[11px] font-normal", variacao < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                            {variacao > 0 ? "+" : ""}{Math.round(variacao)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-[12px] text-muted-foreground">sem preço</div>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Menor visto</div>
                    <div className="num text-[13px] text-muted-foreground">
                      {l.menor_visto != null ? fmtBRL(Number(l.menor_visto)) : "—"}
                      <span className="ml-1 text-[10.5px]">({l.pontos})</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <a href={link} target="_blank" rel="noreferrer" title="Abrir a busca no Google Flights">
                      <Button size="sm" variant="ghost" className="ghost-icone"><ExternalLink className="h-3.5 w-3.5" /></Button>
                    </a>
                    <button
                      type="button" className="ghost-icone rounded p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => { setEditando(v); setDialogAberto(true); }} aria-label="Editar"
                    ><Pencil className="h-3.5 w-3.5" /></button>
                    <button
                      type="button" className="ghost-icone rounded p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => apagar(l)} aria-label="Excluir"
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>

                {expandido && (
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    {v.status === "rastreando" && (
                      <div className="flex flex-wrap items-center gap-2">
                        {!v.rastreando_em && (
                          <Button size="sm" variant="outline" onClick={() => marcarRastreando(l)}>
                            <Check className="mr-1 h-3.5 w-3.5" /> Já liguei o alerta no Google
                          </Button>
                        )}
                        {/* A ENTRADA MANUAL NÃO É PLANO B: enquanto o formato do
                            e-mail do Google não foi conferido contra um alerta
                            real, é ela que faz o módulo já valer — alguém olha o
                            preço e digita, e o teto, a curva e o sino funcionam
                            igual. */}
                        <div className="flex items-center gap-1">
                          <Input
                            value={precoManual[v.id] ?? ""}
                            onChange={(e) => setPrecoManual((p) => ({ ...p, [v.id]: e.target.value }))}
                            placeholder="preço que vi"
                            className="num h-8 w-28 text-[12px]"
                          />
                          <Button size="sm" variant="outline" onClick={() => registrarPreco(v.id)} disabled={ocupado === v.id}>
                            {ocupado === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Registrar"}
                          </Button>
                        </div>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => mudarStatus(l, "comprada", Number(l.ultimo_preco ?? 0) || undefined)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" /> Comprei
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => mudarStatus(l, "cancelada")}>
                          <X className="mr-1 h-3.5 w-3.5" /> Cancelar viagem
                        </Button>
                      </div>
                    )}

                    {/* A viagem fechada também tem trabalho a fazer, e antes ela
                        não tinha botão nenhum aqui — a única saída era lembrar
                        sozinho de ir ao Google. */}
                    {v.status !== "rastreando" && v.rastreando_em && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
                        <span className="flex-1 text-[12px] text-amber-800 dark:text-amber-300">
                          O alerta desta rota continua ligado no Google. Enquanto estiver, os e-mails chegam e
                          caem em "Alertas sem dono", porque esta viagem já fechou.
                        </span>
                        <a href={link} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir no Google
                          </Button>
                        </a>
                        <Button size="sm" variant="outline" onClick={() => desligarRastreio(l)}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Já desliguei lá
                        </Button>
                      </div>
                    )}

                    {/* CAMADA 2 — o que a CURVA diz do teto, pela mesma função
                        que o Radar usa. Mostra mesmo com poucos pontos, dizendo
                        quantos são: aqui os preços chegam quando o Google
                        resolve escrever (não 4x ao dia como no Radar), então
                        exigir os 14 dias da função esconderia a leitura para
                        sempre. Com cinco pontos ela ainda vale — desde que se
                        saiba que são cinco. */}
                    {(() => {
                      const d = diarias[v.id];
                      if (!d?.length) return null;
                      const s = sugerirTeto(d, Number(v.teto));
                      const VER: Record<string, { txt: string; cls: string }> = {
                        abaixo_do_minimo: { txt: "abaixo de tudo o que já se viu — pode nunca disparar", cls: "text-amber-700 dark:text-amber-400" },
                        apertado:         { txt: "apertado, mas alcançável", cls: "text-foreground" },
                        bom:              { txt: "no lugar certo", cls: "text-emerald-700 dark:text-emerald-400" },
                        folgado:          { txt: "folgado — vai disparar no preço de sempre", cls: "text-amber-700 dark:text-amber-400" },
                      };
                      const ver = s.veredito ? VER[s.veredito] : null;
                      return (
                        <div className="rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px]">
                          <span className="font-medium text-foreground">O que a curva diz do seu teto:</span>{" "}
                          {ver && <span className={cn("font-medium", ver.cls)}>{ver.txt}</span>}
                          <span className="text-muted-foreground">
                            {ver ? " · " : ""}menor visto {fmtBRLStr(Number(s.minimo))} · típico {fmtBRLStr(Number(s.tipico))}
                            {" · "}sugestão {fmtBRLStr(Number(s.teto))}
                          </span>
                          <div className="mt-0.5 text-muted-foreground/80">
                            {s.dias} dia(s) medido(s)
                            {!s.pode && ` — a partir de ${DIAS_PARA_SUGERIR} a leitura fica firme; até lá, é indício.`}
                          </div>
                        </div>
                      );
                    })()}

                    {!curvas[v.id] ? (
                      <Skeleton className="h-16 rounded" />
                    ) : curvas[v.id].length === 0 ? (
                      <div className="rounded-md border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
                        Sem preço ainda. A curva começa quando o primeiro alerta do Google chegar — ou quando alguém
                        registrar um preço aqui.
                      </div>
                    ) : (
                      <div className="max-h-[220px] overflow-y-auto rounded-md border border-border">
                        <table className="w-full border-collapse text-[11.5px]">
                          <thead className="sticky top-0 bg-muted/50">
                            <tr className="text-left uppercase tracking-wide text-muted-foreground">
                              <th className="px-3 py-1.5 font-semibold">Quando</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Preço</th>
                              <th className="px-3 py-1.5 font-semibold">De onde</th>
                            </tr>
                          </thead>
                          <tbody>
                            {curvas[v.id].map((p, i) => (
                              <tr key={i} className="border-t border-border/60">
                                <td className="px-3 py-1.5">{new Date(p.coletado_em).toLocaleString("pt-BR")}</td>
                                <td className={cn("num px-3 py-1.5 text-right font-medium",
                                  Number(p.preco) <= Number(v.teto) ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                                  {fmtBRL(Number(p.preco))}
                                </td>
                                <td className="px-3 py-1.5 text-muted-foreground">
                                  {p.fonte === "manual" ? "digitado" : "alerta do Google"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* E-MAIL QUE NÃO ACHOU DONO NÃO SOME. Ou o Google mudou o texto, ou duas
          viagens para o mesmo destino empataram sem data no corpo. Nos dois
          casos a resposta é uma pessoa dizer de qual viagem é — e o motivo fica
          escrito para não virar adivinhação. */}
      {orfaos.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[15px] font-semibold text-foreground">Alertas sem dono</h2>
            <span className="text-[12px] text-muted-foreground">{orfaos.length} e-mail(s) que não casaram com viagem nenhuma</span>
          </div>
          <div className="card-surface divide-y divide-border/60">
            {orfaos.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-foreground" title={e.assunto ?? ""}>{e.assunto ?? "(sem assunto)"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {e.recebido_em ? new Date(e.recebido_em).toLocaleString("pt-BR") : "—"}
                    {e.preco != null && <> · leu <span className="num font-medium text-foreground">{fmtBRLStr(Number(e.preco))}</span></>}
                    {e.motivo && ` · ${e.motivo}`}
                  </div>
                </div>
                {e.preco != null && abertas.length > 0 && (
                  <select
                    className="h-8 rounded border border-border bg-background px-2 text-[12px]"
                    defaultValue=""
                    onChange={(ev) => { if (ev.target.value) atribuir(e.id, ev.target.value); }}
                  >
                    <option value="" disabled>atribuir a…</option>
                    {abertas.map((l) => (
                      <option key={l.viagem.id} value={l.viagem.id}>
                        {rotaTexto(l.viagem.origem, l.viagem.destino)} · {fmtData(l.viagem.data_ida)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <NovaViagemDialog
        aberto={dialogAberto}
        onFechar={() => setDialogAberto(false)}
        onSalvo={load}
        viagem={editando}
      />
    </div>
  );
}
