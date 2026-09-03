import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invocar } from "@/lib/erroEdge";
import { db, parseValor, fmtBRL } from "./lib";
import { useAuth } from "@/hooks/useAuth";
import {
  AEROPORTOS, aeroporto, linkGoogleFlights, norm, lerTeto,
  type VereditoGoogle,
} from "@/lib/passagens";

export interface ViagemRow {
  id: string;
  origem: string;
  destino: string;
  data_ida: string;
  data_volta: string | null;
  teto: number;
  quem_viaja: string | null;
  motivo: string | null;
  status: string;
  google_url: string | null;
  rastreando_em: string | null;
  google_veredito: VereditoGoogle | null;
  area: string | null;
}

/** O que a empresa já pagou nesta rota — `passagens_historico_rota`. */
interface HistoricoRota {
  compras: number;
  menor: number | null;
  mediana: number | null;
  maior: number | null;
  ultimo_preco: number | null;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  /** Null cria; preenchido edita. */
  viagem: ViagemRow | null;
}

/** Aceita "GRU" ou "São Paulo" e devolve a IATA — o campo não obriga a decorar código. */
function resolverIata(texto: string): string | null {
  const t = norm(texto);
  if (!t) return null;
  const porCodigo = AEROPORTOS.find((a) => norm(a.iata) === t);
  if (porCodigo) return porCodigo.iata;
  const porNome = AEROPORTOS.find((a) => norm(a.cidade) === t || norm(a.nome) === t);
  if (porNome) return porNome.iata;
  const comeca = AEROPORTOS.filter((a) => norm(a.cidade).startsWith(t) || norm(a.nome).startsWith(t));
  if (comeca.length === 1) return comeca[0].iata;
  // Três letras que ninguém conhece ainda é uma IATA válida: aeroporto fora da
  // lista não pode travar o cadastro da viagem.
  if (/^[a-z]{3}$/.test(t)) return t.toUpperCase();
  return null;
}

export function NovaViagemDialog({ aberto, onFechar, onSalvo, viagem }: Props) {
  const { profile } = useAuth();
  const [origem, setOrigem] = useState("VIX");
  const [destino, setDestino] = useState("");
  const [ida, setIda] = useState("");
  const [volta, setVolta] = useState("");
  const [teto, setTeto] = useState("");
  const [quem, setQuem] = useState("");
  const [motivo, setMotivo] = useState("");
  const [precoGoogle, setPrecoGoogle] = useState("");
  const [vereditoGoogle, setVereditoGoogle] = useState<VereditoGoogle | "">("");
  const [historico, setHistorico] = useState<HistoricoRota | null>(null);
  const [areas, setAreas] = useState<{ chave: string; nome: string }[]>([]);
  const [area, setArea] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    db.from("passagens_areas").select("chave, nome").eq("ativa", true).order("ordem")
      .then(({ data }: any) => setAreas(data ?? []));
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setOrigem(viagem?.origem ?? "VIX");
    setDestino(viagem?.destino ?? "");
    setIda(viagem?.data_ida ?? "");
    setVolta(viagem?.data_volta ?? "");
    setTeto(viagem ? String(viagem.teto) : "");
    setQuem(viagem?.quem_viaja ?? "");
    setMotivo(viagem?.motivo ?? "");
    setPrecoGoogle("");
    setVereditoGoogle(viagem?.google_veredito ?? "");
    setArea(viagem?.area ?? "");
    setHistorico(null);
  }, [aberto, viagem]);

  const oIata = resolverIata(origem);
  const dIata = resolverIata(destino);
  const tetoNum = parseValor(teto);

  /* A PRÉVIA DO LINK É A PRÓPRIA CONFERÊNCIA. Ela usa a mesma função que o
     servidor usa para casar o e-mail de volta — ver o link aqui é ver que o
     Hub entendeu a rota certa, antes de gravar qualquer coisa. */
  const link = useMemo(
    () => (oIata && dIata && ida ? linkGoogleFlights({ origem: oIata, destino: dIata, data_ida: ida, data_volta: volta || null }) : null),
    [oIata, dIata, ida, volta],
  );

  /* CAMADA 3 — o que a empresa já pagou nesta rota. É a referência mais
     defensável das três (é extrato, não estimativa) e a única que responde no
     instante do cadastro, antes de existir curva. */
  useEffect(() => {
    if (!aberto || !oIata || !dIata) { setHistorico(null); return; }
    let vivo = true;
    db.rpc("passagens_historico_rota", { p_origem: oIata, p_destino: dIata })
      .then(({ data }: any) => { if (vivo) setHistorico((data?.[0] as HistoricoRota) ?? null); });
    return () => { vivo = false; };
  }, [aberto, oIata, dIata]);

  /* CAMADA 1 — o que o teto digitado significa contra o preço de hoje. Não
     sugere número: traduz o que a pessoa escreveu. Ver `lerTeto`. */
  const leitura = useMemo(
    () => lerTeto(tetoNum ?? 0, parseValor(precoGoogle), vereditoGoogle || null),
    [tetoNum, precoGoogle, vereditoGoogle],
  );

  async function salvar() {
    if (!oIata) { toast.error("Não reconheci a origem. Use a sigla (VIX) ou a cidade."); return; }
    if (!dIata) { toast.error("Não reconheci o destino. Use a sigla (REC) ou a cidade."); return; }
    if (oIata === dIata) { toast.error("Origem e destino são o mesmo aeroporto."); return; }
    if (!ida) { toast.error("Informe a data de ida."); return; }
    if (volta && volta < ida) { toast.error("A volta é antes da ida."); return; }
    if (!tetoNum || tetoNum <= 0) { toast.error("Defina o teto — é ele que decide quando o Hub avisa."); return; }

    setSalvando(true);
    const linha = {
      origem: oIata, destino: dIata,
      data_ida: ida, data_volta: volta || null,
      teto: tetoNum,
      quem_viaja: quem.trim() || null,
      motivo: motivo.trim() || null,
      google_url: linkGoogleFlights({ origem: oIata, destino: dIata, data_ida: ida, data_volta: volta || null }),
      google_veredito: vereditoGoogle || null,
      area: area || null,
      updated_at: new Date().toISOString(),
      ...(viagem ? {} : { criado_por: profile?.nome ?? null }),
    };
    const { data, error } = viagem
      ? await db.from("passagens_viagens").update(linha).eq("id", viagem.id).select("id").single()
      : await db.from("passagens_viagens").insert(linha).select("id").single();
    if (error) { setSalvando(false); toast.error(error.message); return; }

    /* O PREÇO DE REFERÊNCIA VIRA O PRIMEIRO PONTO DA CURVA, e vai pela Edge
       Function em vez de um insert direto: é `gravarPreco` que lê o menor
       anterior, compara com o teto e abre o sinal. Gravando aqui, um preço já
       dentro do teto entraria mudo — e o único caso em que isso acontece é o
       mais urgente de todos: a passagem já está barata na hora do cadastro. */
    const ref = parseValor(precoGoogle);
    if (!viagem && ref && ref > 0) {
      try {
        await invocar<any>(supabase.functions.invoke("passagens-gmail-sync", {
          body: { action: "preco", viagem_id: data.id, preco: ref },
        }));
      } catch (e: any) {
        // A viagem foi criada; só o ponto de partida falhou. Dizer qual das
        // duas coisas deu errado evita a pessoa cadastrar tudo de novo.
        toast.warning(`Viagem criada, mas não deu para gravar o preço de referência: ${e.message ?? e}`);
      }
    }

    setSalvando(false);
    toast.success(viagem ? "Viagem atualizada." : "Viagem criada — agora ligue o alerta no Google.");
    onSalvo();
    onFechar();
  }

  const nomeDe = (iata: string | null) => (iata ? aeroporto(iata)?.nome ?? iata : "—");

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{viagem ? "Editar viagem" : "Nova viagem"}</DialogTitle>
          <DialogDescription>
            O Hub não compra e não busca preço sozinho: quem monitora é o alerta do Google Flights.
            Aqui você registra a rota e o teto — e o Hub cala a boca até o preço entrar nele.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-origem">Origem</Label>
              <Input id="v-origem" value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="VIX" list="aeroportos" />
              <div className="text-[11px] text-muted-foreground">{nomeDe(oIata)}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-destino">Destino</Label>
              <Input id="v-destino" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="REC ou Recife" list="aeroportos" />
              <div className="text-[11px] text-muted-foreground">{nomeDe(dIata)}</div>
            </div>
          </div>
          {/* `datalist` e não `Select`: a lista tem ~45 itens e o campo aceita
              IATA fora dela — um select fecharia a porta para o aeroporto que
              ninguém lembrou de cadastrar. */}
          <datalist id="aeroportos">
            {AEROPORTOS.map((a) => <option key={a.iata} value={a.iata}>{a.nome}</option>)}
          </datalist>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-ida">Ida</Label>
              <Input id="v-ida" type="date" value={ida} onChange={(e) => setIda(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-volta">Volta <span className="text-muted-foreground">(vazio = só ida)</span></Label>
              <Input id="v-volta" type="date" value={volta} min={ida || undefined} onChange={(e) => setVolta(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-teto">Teto</Label>
              <Input id="v-teto" value={teto} onChange={(e) => setTeto(e.target.value)} placeholder="1.200" className="num" />
              <div className="text-[11px] text-muted-foreground">
                {tetoNum ? `avisa abaixo de ${fmtBRL(tetoNum)}` : "o preço que faz valer a pena comprar"}
              </div>
            </div>

            {/* CAMADA 3, no lugar onde a decisão acontece. Aparece só quando há
                compra registrada nesta rota — sem histórico, um bloco vazio
                dizendo "nenhuma compra" seria ruído no formulário. */}
            {historico && historico.compras > 0 && (
              <div className="col-span-2 rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px]">
                <span className="font-medium text-foreground">O que vocês já pagaram nesta rota:</span>{" "}
                <span className="text-muted-foreground">
                  {historico.compras === 1
                    ? `uma compra, de ${fmtBRL(Number(historico.menor))}.`
                    : `${historico.compras} compras, de ${fmtBRL(Number(historico.menor))} a ${fmtBRL(Number(historico.maior))} · típico ${fmtBRL(Number(historico.mediana))}.`}
                  {historico.ultimo_preco != null && ` A última saiu por ${fmtBRL(Number(historico.ultimo_preco))}.`}
                </span>
              </div>
            )}
            {/* DE QUEM É ESTA VIAGEM. Não é permissão — é o que faz a viagem
                cair na fila certa. Sem área ela aparece em "Todas" e some da
                fila de todo mundo, que é o pior lugar para uma pendência estar. */}
            <div className="space-y-1.5">
              <Label htmlFor="v-area">Área</Label>
              <select
                id="v-area"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-[14px]"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">sem área</option>
                {areas.map((a) => <option key={a.chave} value={a.chave}>{a.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-quem">Quem viaja</Label>
              <Input id="v-quem" value={quem} onChange={(e) => setQuem(e.target.value)} placeholder="opcional" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-motivo">Motivo <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="v-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Visita a cliente, evento…" />
          </div>

          {/* CAMADA 1 — a âncora. Só na criação: depois, quem atualiza o preço é
              o campo "preço que vi" na linha da viagem, que faz exatamente isso
              e não corre o risco de regravar o mesmo ponto a cada salvamento. */}
          {!viagem && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="v-google">Preço que o Google pede agora <span className="text-muted-foreground">(opcional)</span></Label>
                <Input id="v-google" value={precoGoogle} onChange={(e) => setPrecoGoogle(e.target.value)} placeholder="3.793" className="num" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-veredito">O Google diz que está</Label>
                <select
                  id="v-veredito"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-[14px]"
                  value={vereditoGoogle}
                  onChange={(e) => setVereditoGoogle(e.target.value as VereditoGoogle | "")}
                >
                  <option value="">não informado</option>
                  <option value="baixo">barato para esta rota</option>
                  <option value="tipico">no preço de sempre</option>
                  <option value="alto">caro para esta rota</option>
                </select>
              </div>
            </div>
          )}

          {/* O que o teto digitado significa. Não sugere número — traduz o que a
              pessoa escreveu contra o preço que ela mesma acabou de ler. */}
          {tetoNum != null && tetoNum > 0 && (
            <div className={cn(
              "rounded-md border p-2.5 text-[11.5px]",
              leitura.dispara_agora
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-border bg-muted/40 text-muted-foreground",
            )}>
              {leitura.frase}
            </div>
          )}

          {link && (
            <div className="rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px] text-muted-foreground">
              A busca que o Hub vai monitorar:{" "}
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2">
                {oIata} → {dIata} <ExternalLink className="h-3 w-3" />
              </a>
              <div className="mt-1">Depois de salvar, abra esse link e clique em <span className="font-medium text-foreground">Rastrear preços</span> — é o passo que faz o e-mail chegar.</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {viagem ? "Salvar" : "Criar viagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
