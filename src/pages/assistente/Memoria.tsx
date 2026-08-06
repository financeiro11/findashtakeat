// O que o Assistente lembra sobre você — e o botão de apagar.
//
// Requisito do projeto, não enfeite: memória que a pessoa não pode inspecionar nem apagar
// é vigilância. A RLS de `assistente_memoria` permite SELECT e DELETE apenas das próprias
// linhas; a gravação é exclusiva da Edge Function, para ninguém plantar um fato sobre si.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Lembranca = {
  id: string;
  texto: string;
  tipo: "fato" | "preferencia";
  origem: string;
  criado_em: string;
};

export default function AssistenteMemoria() {
  const [itens, setItens] = useState<Lembranca[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [apagando, setApagando] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Assistente · Memória";
    carregar();
  }, []);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("assistente_memoria" as any)
      .select("id, texto, tipo, origem, criado_em")
      .order("criado_em", { ascending: false });

    if (error) toast.error(`Não consegui carregar a memória: ${error.message}`);
    setItens((data ?? []) as unknown as Lembranca[]);
    setCarregando(false);
  };

  const apagar = async (id: string) => {
    setApagando(id);
    const { error } = await supabase.from("assistente_memoria" as any).delete().eq("id", id);
    if (error) toast.error(`Não consegui apagar: ${error.message}`);
    else {
      setItens((l) => l.filter((i) => i.id !== id));
      toast.success("Esquecido.");
    }
    setApagando(null);
  };

  const apagarTudo = async () => {
    if (itens.length === 0) return;
    // Sem diálogo de confirmação por enquanto: a ação é reversível na prática, já que o
    // assistente volta a aprender conversando. Se virar destrutivo, entra confirmação.
    const { error } = await supabase
      .from("assistente_memoria" as any)
      .delete()
      .in("id", itens.map((i) => i.id));

    if (error) toast.error(`Não consegui limpar: ${error.message}`);
    else {
      setItens([]);
      toast.success("Memória limpa.");
    }
  };

  const fmtData = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="h-5 w-5 text-muted-foreground" />
            O que o Assistente lembra de você
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Fatos e preferências aprendidos nas conversas. Nunca guardamos valores
            financeiros aqui — todo número vem de consulta na hora da pergunta.
          </p>
        </div>
        {itens.length > 0 && (
          <Button variant="outline" size="sm" onClick={apagarTudo}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Esquecer tudo
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <span className="text-[13px] font-semibold">
            {carregando ? "Carregando…" : `${itens.length} ${itens.length === 1 ? "lembrança" : "lembranças"}`}
          </span>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando…
            </div>
          ) : itens.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nada lembrado ainda. Converse com o Assistente e ele vai aprender como você
              trabalha.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {itens.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{i.texto}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {i.tipo === "preferencia" ? "preferência" : "fato"}
                      </Badge>
                      <span className="text-[11.5px] text-muted-foreground">
                        {i.origem === "manual" ? "adicionado por você" : "aprendido conversando"}
                        {" · "}
                        {fmtData(i.criado_em)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-muted-foreground"
                    onClick={() => apagar(i.id)}
                    disabled={apagando === i.id}
                    title="Esquecer"
                  >
                    {apagando === i.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
