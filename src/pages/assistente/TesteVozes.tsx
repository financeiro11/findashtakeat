// Teste de vozes do navegador (Web Speech API — `speechSynthesis`).
//
// Página de diagnóstico, não de produção: serve para decidir se a voz GRATUITA do
// navegador é boa o bastante para o Assistente, antes de contratar um serviço pago
// de síntese de fala. Nada aqui chama backend, consome API nem custa dinheiro —
// `speechSynthesis` usa as vozes já instaladas no sistema operacional (ou, em alguns
// navegadores, vozes neurais servidas pelo próprio fabricante do navegador).
//
// Duas coisas que esta tela responde e que só a máquina do usuário sabe:
//   1) QUAIS vozes em português existem neste computador (varia por SO e navegador);
//   2) COMO um número financeiro soa quando falado — ver as frases "número cru" vs
//      "preparado" abaixo, que é o achado prático mais importante daqui.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Play, Square, Volume2, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";

/** Frases de teste. Cada uma exercita um uso real do Assistente. */
const FRASES: { id: string; rotulo: string; texto: string; nota?: string }[] = [
  {
    id: "aviso",
    rotulo: "Aviso de reunião",
    texto: "Júlia, sua reunião com o Henrique começa em 10 minutos.",
    nota: "Frase curta e previsível — é o caso em que a voz grátis mais se aproxima da paga.",
  },
  {
    id: "caixa-cru",
    rotulo: "Resposta de caixa (número cru)",
    texto: "O caixa fechou julho em R$ 128.412,00, 10,00% abaixo de junho.",
    nota: "Repare COMO o valor e o percentual são lidos. É aqui que a maioria das vozes tropeça.",
  },
  {
    id: "caixa-preparado",
    rotulo: "Resposta de caixa (texto preparado)",
    texto:
      "O caixa fechou julho em cento e vinte e oito mil reais, dez por cento abaixo de junho.",
    nota: "Mesma informação, escrita por extenso antes de ir para a voz. Compare com a anterior.",
  },
  {
    id: "analise",
    rotulo: "Análise longa",
    texto:
      "O EBITDA de julho caiu dezoito por cento em relação a junho. A maior parte da queda vem de dois lugares: a Equipe Comercial subiu setenta e dois mil reais, e as Campanhas de Mídia Paga subiram quarenta e um mil. A receita líquida também recuou, mas responde por menos de um sexto da variação. A causa dentro de cada rubrica não está no DRE.",
    nota: "Texto longo é onde a diferença para a voz paga fica evidente. Ouça até o fim.",
  },
];

/** Heurística de nome para destacar vozes neurais/naturais (Microsoft, Google et al.). */
function pareceNatural(v: SpeechSynthesisVoice): boolean {
  return /natural|neural|online|wavenet|studio/i.test(v.name);
}

/**
 * Carrega a lista de vozes.
 *
 * `getVoices()` costuma vir VAZIO na primeira chamada: o navegador popula a lista de
 * forma assíncrona e avisa pelo evento `voiceschanged`. Alguns Chrome só populam após
 * a primeira interação, por isso há também um repique curto por segurança.
 */
function useVozes() {
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const carregar = () => setVozes(synth.getVoices());
    carregar();
    synth.addEventListener("voiceschanged", carregar);
    const repique = window.setTimeout(carregar, 600);

    return () => {
      synth.removeEventListener("voiceschanged", carregar);
      window.clearTimeout(repique);
    };
  }, []);

  return vozes;
}

function detectarNavegador(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Mozilla Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "desconhecido";
}

export default function TesteVozes() {
  const vozes = useVozes();
  const [soPortugues, setSoPortugues] = useState(true);
  const [fraseId, setFraseId] = useState(FRASES[0].id);
  const [textoLivre, setTextoLivre] = useState("");
  const [velocidade, setVelocidade] = useState(1);
  const [tom, setTom] = useState(1);
  const [falando, setFalando] = useState<string | null>(null);

  // O Chrome coleta o utterance pelo GC no meio da fala se ninguém segurar a referência,
  // o que corta o áudio na metade. Manter em ref resolve.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Segundo bug do Chrome: a fala morre sozinha por volta dos 15s. O contorno conhecido é
  // um pause()/resume() periódico. Sem isso, a frase de teste longa cortaria no meio e
  // pareceria defeito da VOZ, quando é defeito do NAVEGADOR — justamente o que este
  // diagnóstico não pode confundir.
  const keepAliveRef = useRef<number | null>(null);

  const suportado = typeof window !== "undefined" && "speechSynthesis" in window;
  const navegador = useMemo(detectarNavegador, []);

  useEffect(() => {
    document.title = "Assistente · Teste de Vozes";
    // Não deixa áudio tocando nem timer rodando ao sair da página.
    return () => {
      if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const frase = FRASES.find((f) => f.id === fraseId) ?? FRASES[0];
  const textoAtual = textoLivre.trim() || frase.texto;

  const emPortugues = useMemo(
    () => vozes.filter((v) => v.lang.toLowerCase().startsWith("pt")),
    [vozes],
  );
  const listadas = soPortugues ? emPortugues : vozes;
  const naturais = useMemo(() => emPortugues.filter(pareceNatural), [emPortugues]);

  const pararKeepAlive = () => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  };

  const parar = () => {
    pararKeepAlive();
    window.speechSynthesis.cancel();
    setFalando(null);
  };

  const falar = (voz: SpeechSynthesisVoice) => {
    if (!suportado) return;
    pararKeepAlive();
    window.speechSynthesis.cancel(); // interrompe a fala anterior antes de começar outra

    const u = new SpeechSynthesisUtterance(textoAtual);
    u.voice = voz;
    u.lang = voz.lang;
    u.rate = velocidade;
    u.pitch = tom;

    const encerrar = () => {
      pararKeepAlive();
      setFalando(null);
    };
    u.onend = encerrar;
    u.onerror = (e) => {
      encerrar();
      // Trocar de voz chama cancel(), e cancel() dispara onerror com "interrupted"/
      // "canceled". Isso é o fluxo NORMAL desta página — só avisa em falha de verdade.
      if (e.error === "interrupted" || e.error === "canceled") return;
      toast.error(`Não foi possível falar com a voz "${voz.name}".`);
    };

    utteranceRef.current = u;
    setFalando(voz.voiceURI);

    // O Chrome também engasga quando `speak()` vem colado no `cancel()`; um tique de
    // atraso é o suficiente para a fila do sintetizador esvaziar.
    window.setTimeout(() => {
      window.speechSynthesis.speak(u);
      keepAliveRef.current = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          pararKeepAlive();
          return;
        }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10_000);
    }, 60);
  };

  if (!suportado) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">
                Este navegador não tem síntese de voz.
              </p>
              <p className="mt-1 text-muted-foreground">
                Detectado: {navegador}. Abra o Hub no Microsoft Edge ou no Google Chrome
                para rodar o teste.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* ---- Diagnóstico do ambiente ------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">Vozes disponíveis nesta máquina</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metrica rotulo="Navegador" valor={navegador} />
            <Metrica rotulo="Vozes no total" valor={String(vozes.length)} />
            <Metrica rotulo="Em português" valor={String(emPortugues.length)} />
            <Metrica
              rotulo="Naturais (pt)"
              valor={String(naturais.length)}
              destaque={naturais.length > 0}
            />
          </div>

          {emPortugues.length === 0 && vozes.length > 0 && (
            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">
                  Nenhuma voz em português instalada.
                </p>
                <p className="mt-1 text-muted-foreground">
                  No Windows 11: Configurações → Hora e Idioma → Fala → Adicionar vozes →
                  Português (Brasil). Depois recarregue esta página.
                </p>
              </div>
            </div>
          )}

          {naturais.length === 0 && emPortugues.length > 0 && (
            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">
                  Só vozes antigas foram encontradas.
                </p>
                <p className="mt-1 text-muted-foreground">
                  As vozes neurais (Francisca, Antônio, Thalita) soam muito melhor e são
                  gratuitas. Instale em Configurações → Hora e Idioma → Fala, e teste
                  também no Microsoft Edge, que costuma expor vozes naturais adicionais.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- O que será falado ------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <span className="font-semibold">O que falar</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FRASES.map((f) => (
              <Button
                key={f.id}
                variant={f.id === fraseId && !textoLivre.trim() ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFraseId(f.id);
                  setTextoLivre("");
                }}
              >
                {f.rotulo}
              </Button>
            ))}
          </div>

          {frase.nota && !textoLivre.trim() && (
            <p className="text-[13px] text-muted-foreground">{frase.nota}</p>
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px] text-muted-foreground">
              Ou escreva sua própria frase
            </Label>
            <Textarea
              value={textoLivre}
              onChange={(e) => setTextoLivre(e.target.value)}
              placeholder={frase.texto}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controle
              rotulo="Velocidade"
              valor={velocidade}
              onChange={setVelocidade}
              min={0.5}
              max={1.6}
            />
            <Controle rotulo="Tom" valor={tom} onChange={setTom} min={0.5} max={1.5} />
          </div>
        </CardContent>
      </Card>

      {/* ---- Lista de vozes --------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">
              Ouvir {listadas.length} {listadas.length === 1 ? "voz" : "vozes"}
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="so-pt"
                  checked={soPortugues}
                  onCheckedChange={setSoPortugues}
                />
                <Label htmlFor="so-pt" className="text-[13px] text-muted-foreground">
                  Só português
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={parar} disabled={!falando}>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Parar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {listadas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Carregando vozes… Se continuar vazio, recarregue a página.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {listadas.map((v) => (
                <div
                  key={v.voiceURI}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {v.name}
                      </span>
                      {pareceNatural(v) && <Badge variant="default">Natural</Badge>}
                      <Badge variant="secondary">
                        {v.localService ? "Local" : "Servidor"}
                      </Badge>
                    </div>
                    <span className="text-[12px] text-muted-foreground">{v.lang}</span>
                  </div>
                  <Button
                    size="sm"
                    variant={falando === v.voiceURI ? "default" : "outline"}
                    onClick={() => falar(v)}
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    {falando === v.voiceURI ? "Falando…" : "Ouvir"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-[12.5px] text-muted-foreground">
        Página de diagnóstico. Nenhuma chamada de API, nenhum custo — a voz vem do
        próprio navegador. Vozes marcadas como <strong>Servidor</strong> são
        processadas pelo fabricante do navegador; as <strong>Local</strong> rodam
        inteiramente nesta máquina.
      </p>
    </div>
  );
}

function Metrica({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[12px] text-muted-foreground">{rotulo}</div>
      <div
        className={`mt-0.5 truncate text-sm font-semibold ${
          destaque ? "text-primary" : "text-foreground"
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

function Controle({
  rotulo,
  valor,
  onChange,
  min,
  max,
}: {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[13px] text-muted-foreground">{rotulo}</Label>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {valor.toFixed(2).replace(".", ",")}
        </span>
      </div>
      <Slider
        value={[valor]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={0.05}
      />
    </div>
  );
}
