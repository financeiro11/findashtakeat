import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { db, parseValor, fmtBRL } from "./lib";
import { useAuth } from "@/hooks/useAuth";
import { AEROPORTOS, aeroporto, linkGoogleFlights, norm } from "@/lib/passagens";

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
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setOrigem(viagem?.origem ?? "VIX");
    setDestino(viagem?.destino ?? "");
    setIda(viagem?.data_ida ?? "");
    setVolta(viagem?.data_volta ?? "");
    setTeto(viagem ? String(viagem.teto) : "");
    setQuem(viagem?.quem_viaja ?? "");
    setMotivo(viagem?.motivo ?? "");
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
      updated_at: new Date().toISOString(),
      ...(viagem ? {} : { criado_por: profile?.nome ?? null }),
    };
    const { error } = viagem
      ? await db.from("passagens_viagens").update(linha).eq("id", viagem.id)
      : await db.from("passagens_viagens").insert(linha);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
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
            <div className="space-y-1.5">
              <Label htmlFor="v-quem">Quem viaja</Label>
              <Input id="v-quem" value={quem} onChange={(e) => setQuem(e.target.value)} placeholder="opcional" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-motivo">Motivo <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="v-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Visita a cliente, evento…" />
          </div>

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
