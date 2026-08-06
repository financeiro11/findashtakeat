// Assistente — conversa com o bloco de números ao lado.
//
// A tela existe para tornar a regra visível: cada resposta aparece junto da tabela dos
// números que a sustentam, com fonte e competência. O texto é a leitura; a tabela é a
// prova. Quem levar isso a uma reunião com investidor consegue apontar de onde veio cada
// valor sem sair da tela.
//
// Voz nas duas pontas, gratuita: entrada pelo reconhecimento do navegador
// (src/hooks/useMicrofone.ts) e saída pela síntese dele (src/lib/voz.ts). O áudio é sempre
// ADICIONAL — o texto e a tabela nunca dependem dele.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Brain, Loader2, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { falar, pararFala, suportaVoz } from "@/lib/voz";
import { useMicrofone } from "@/hooks/useMicrofone";

type Numero = {
  rotulo: string;
  valor: number;
  formatado: string;
  fonte: string;
  competencia: string;
};

type Resposta = {
  ok: boolean;
  consulta: string;
  resposta: string;
  numeros: Numero[];
  avisos: string[];
};

type Turno = { pergunta: string; resposta: Resposta | null; erro?: string };

const EXEMPLOS = [
  "Qual foi o caixa em julho?",
  "Por que o EBITDA caiu em relação ao mês passado?",
  "Como foi o mês passado?",
  "Quanto gastamos com Equipe Comercial?",
];

export default function AssistenteChat() {
  const [pergunta, setPergunta] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [vozLigada, setVozLigada] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  // Identifica a conversa no log de execução — some ao recarregar, que é o comportamento
  // esperado: cada sessão de trabalho é uma conversa.
  const conversaIdRef = useRef<string>(crypto.randomUUID());

  // `turnos` dentro do callback do microfone ficaria congelado no valor do primeiro render;
  // a ref garante que o histórico enviado seja o atual.
  const turnosRef = useRef<Turno[]>([]);
  useEffect(() => { turnosRef.current = turnos; }, [turnos]);

  const perguntarRef = useRef<(t: string) => void>(() => {});
  const mic = useMicrofone((texto) => perguntarRef.current(texto));

  useEffect(() => {
    document.title = "Assistente · Central do Financeiro";
    return () => pararFala();
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turnos, carregando, mic.parcial]);

  useEffect(() => {
    if (mic.erro) toast.error(mic.erro);
  }, [mic.erro]);

  const perguntar = async (texto: string) => {
    const limpa = texto.trim();
    if (!limpa || carregando) return;

    setPergunta("");
    setCarregando(true);
    pararFala();

    // Só as últimas trocas bem-sucedidas: contexto para "e no mês anterior?", sem inchar
    // o prompt nem carregar erros passados.
    const historico = turnosRef.current
      .filter((t) => t.resposta?.ok)
      .slice(-4)
      .map((t) => ({ pergunta: t.pergunta, resposta: t.resposta!.resposta }));

    try {
      const { data, error } = await supabase.functions.invoke("assistente-responder", {
        body: { pergunta: limpa, historico, conversa_id: conversaIdRef.current },
      });
      if (error) throw error;

      const resposta = data as Resposta;
      setTurnos((t) => [...t, { pergunta: limpa, resposta }]);
      if (vozLigada && resposta?.resposta) falar(resposta.resposta);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao consultar o assistente.";
      setTurnos((t) => [...t, { pergunta: limpa, resposta: null, erro: msg }]);
      toast.error(msg);
    } finally {
      setCarregando(false);
    }
  };
  perguntarRef.current = perguntar;

  const alternarVoz = () => {
    if (vozLigada) {
      pararFala();
      setVozLigada(false);
      return;
    }
    if (!suportaVoz()) {
      toast.error("Este navegador não tem síntese de voz.");
      return;
    }
    setVozLigada(true);
    toast.success("Vou ler as respostas em voz alta.");
  };

  const ouvindo = mic.estado === "ouvindo";

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Assistente</h1>
          <p className="text-[13px] text-muted-foreground">
            Todo número exibido veio de uma consulta feita agora. Nada é estimado.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/assistente/memoria">
              <Brain className="mr-1.5 h-4 w-4" />
              Memória
            </Link>
          </Button>
          <Button variant={vozLigada ? "default" : "outline"} size="sm" onClick={alternarVoz}>
            {vozLigada ? <Volume2 className="mr-1.5 h-4 w-4" /> : <VolumeX className="mr-1.5 h-4 w-4" />}
            {vozLigada ? "Voz ligada" : "Voz desligada"}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {turnos.length === 0 && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">
                Pergunte sobre caixa, EBITDA, os totais de um mês ou uma rubrica do DRE.
                Cada resposta vem com a tabela dos números usados, com fonte e competência.
              </p>
              <div className="flex flex-wrap gap-2">
                {EXEMPLOS.map((ex) => (
                  <Button key={ex} variant="outline" size="sm" onClick={() => perguntar(ex)}>
                    {ex}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {turnos.map((t, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                {t.pergunta}
              </div>
            </div>

            {t.erro && (
              <Card className="border-destructive/40">
                <CardContent className="flex items-start gap-2.5 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>{t.erro}</span>
                </CardContent>
              </Card>
            )}

            {t.resposta && (
              <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
                <Card>
                  <CardContent className="p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {t.resposta.resposta}
                    </p>
                    {suportaVoz() && t.resposta.resposta && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 h-7 px-2 text-muted-foreground"
                        onClick={() => falar(t.resposta!.resposta)}
                      >
                        <Volume2 className="mr-1.5 h-3.5 w-3.5" />
                        Ouvir
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <BlocoNumeros numeros={t.resposta.numeros} avisos={t.resposta.avisos} />
              </div>
            )}
          </div>
        ))}

        {ouvindo && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-lg border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground">
              {mic.texto || mic.parcial
                ? `${mic.texto} ${mic.parcial}`.trim()
                : "Ouvindo… pode falar."}
            </div>
          </div>
        )}

        {carregando && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando os dados…
          </div>
        )}
        <div ref={fimRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          perguntar(pergunta);
        }}
        className="flex gap-2"
      >
        {mic.suportado && (
          <Button
            type="button"
            variant={ouvindo ? "default" : "outline"}
            size="icon"
            onClick={mic.alternar}
            disabled={carregando}
            title={ouvindo ? "Parar e enviar" : "Falar"}
            className={ouvindo ? "animate-pulse" : undefined}
          >
            {ouvindo ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
        <Input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder={ouvindo ? "Falando…" : "Pergunte sobre o caixa, o EBITDA ou uma rubrica…"}
          disabled={carregando || ouvindo}
        />
        <Button type="submit" disabled={carregando || ouvindo || !pergunta.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * A tabela dos números usados na resposta — a "prova" ao lado da leitura.
 *
 * Os avisos aparecem aqui e não são escondíveis: quando um dado falta ou uma conferência
 * chamou atenção, isso precisa estar tão visível quanto o próprio número.
 */
function BlocoNumeros({ numeros, avisos }: { numeros: Numero[]; avisos: string[] }) {
  if (numeros.length === 0 && avisos.length === 0) return null;

  return (
    <Card className="h-fit">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Números usados</span>
          {numeros.length > 0 && <Badge variant="secondary">{numeros.length}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {numeros.map((n, i) => (
          <div key={i} className="border-b border-border pb-2 last:border-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">{n.rotulo}</span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                {n.formatado}
              </span>
            </div>
            <div className="text-[11.5px] text-muted-foreground/80">
              {n.fonte} · {n.competencia}
            </div>
          </div>
        ))}

        {avisos.map((a, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-[12px] text-muted-foreground">{a}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
