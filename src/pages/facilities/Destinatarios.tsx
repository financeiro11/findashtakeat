import { useEffect, useState } from "react";
import { AlertTriangle, MessageCircle, Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { db } from "./lib";

interface Destinatario {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
}

/** 55 + DDD + número. Aceita quem digita sem o 55 — é o jeito normal de escrever. */
function normalizarTelefone(t: string): string | null {
  const d = t.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

function telefoneLegivel(d: string): string {
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d;
}

/**
 * QUEM RECEBE O AVISO NO WHATSAPP. O aviso sai quando a conferência confirma um
 * achado com estoque e dentro do teto — nunca de vitrine. A lista é dado (a
 * tabela `facilities_radar_destinatarios`), não constante no código.
 *
 * E A TELA DIZ QUANDO O CANAL NÃO ESTÁ LIGADO. Uma lista de números bem
 * preenchida, com o n8n desconfigurado no servidor, é a forma mais convincente
 * de silêncio: parece pronto e ninguém recebe nada.
 */
export function Destinatarios() {
  const { profile } = useAuth();
  const [lista, setLista] = useState<Destinatario[] | null>(null);
  const [canal, setCanal] = useState<boolean | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const { data, error } = await db.from("facilities_radar_destinatarios")
      .select("id, nome, telefone, ativo").order("created_at");
    if (error) { toast.error(error.message); setLista([]); return; }
    setLista((data as Destinatario[]) ?? []);
  }

  useEffect(() => {
    carregar();
    supabase.functions.invoke("facilities-radar", { body: { action: "canal" } })
      .then(({ data }) => setCanal(data?.configurado ?? null))
      .catch(() => setCanal(null));
  }, []);

  async function adicionar() {
    const tel = normalizarTelefone(telefone);
    if (!nome.trim()) { toast.error("Escreva o nome de quem vai receber."); return; }
    if (!tel) { toast.error("Telefone com DDD, ex.: (27) 99999-9999."); return; }
    setSalvando(true);
    const { error } = await db.from("facilities_radar_destinatarios")
      .insert({ nome: nome.trim(), telefone: tel, criado_por: profile?.nome ?? null });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    setNome(""); setTelefone("");
    toast.success("Adicionado — recebe a partir do próximo achado confirmado.");
    carregar();
  }

  async function alternar(d: Destinatario) {
    const { error } = await db.from("facilities_radar_destinatarios").update({ ativo: !d.ativo }).eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    carregar();
  }

  async function remover(d: Destinatario) {
    if (!window.confirm(`Tirar ${d.nome} da lista de aviso?`)) return;
    const { error } = await db.from("facilities_radar_destinatarios").delete().eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    carregar();
  }

  const ativos = lista?.filter((d) => d.ativo).length ?? 0;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="text-[15px] font-semibold text-foreground">Quem recebe o aviso no WhatsApp</h2>
        <span className="text-[12px] text-muted-foreground">{ativos} ativo(s)</span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        O aviso sai só para alvo em <span className="font-medium text-foreground">compra</span>, depois que o anúncio foi aberto e o
        estoque e o frete conferidos. Achados de vários alvos vão numa mensagem só, e o mesmo achado só é reenviado se cair mais 3%.
      </p>

      {canal === false && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            O canal de WhatsApp ainda não está ligado no servidor — por enquanto os achados ficam só nesta tela. (Para o time técnico:
            falta configurar <code>N8N_WHATSAPP_URL</code> no Supabase.)
          </span>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {lista?.map((d) => (
          <div key={d.id} className={cn("flex items-center gap-2 text-[13px]", !d.ativo && "opacity-60")}>
            <span className="min-w-[140px] font-medium text-foreground">{d.nome}</span>
            <span className="num text-muted-foreground">{telefoneLegivel(d.telefone)}</span>
            {!d.ativo && <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">pausado</span>}
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" className="ghost-icone" title={d.ativo ? "Pausar" : "Voltar a receber"} onClick={() => alternar(d)}>
                {d.ativo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" className="ghost-icone text-muted-foreground" title="Tirar da lista" onClick={() => remover(d)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {lista?.length === 0 && (
          <div className="text-[12px] text-muted-foreground">Ninguém na lista — nenhum aviso sai até alguém ser adicionado.</div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input className="h-8 w-44" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input
          className="h-8 w-44"
          placeholder="(27) 99999-9999"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }}
        />
        <Button size="sm" variant="outline" onClick={adicionar} disabled={salvando}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
