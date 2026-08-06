// Entrada de voz — reconhecimento de fala gratuito do navegador.
//
// Usa a Web Speech API (`SpeechRecognition`), que não custa nada e já vem no Chrome e no
// Edge. Duas coisas que ela NÃO é, e que valem estar escritas:
//
//   • não é local: no Chrome o áudio é enviado aos servidores do Google para transcrever.
//     "Gratuito" não quer dizer "privado" — os dados do Hub já transitam pelo Gemini, que
//     é do mesmo Google, mas quem for ampliar isso precisa saber;
//   • não existe no Firefox. `suportaMicrofone()` cobre esse caso e a UI cai para texto.
//
// O modo é push-to-talk: aperta, fala, solta. Conversa contínua (interromper no meio) é
// outro produto e exige serviço pago — a decisão foi validar o uso real primeiro.

import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoMic = "parado" | "ouvindo";

// A API não é padronizada: Chrome/Edge expõem com prefixo webkit.
type Reconhecedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

function construtor(): (new () => Reconhecedor) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Reconhecedor;
    webkitSpeechRecognition?: new () => Reconhecedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function suportaMicrofone(): boolean {
  return construtor() !== null;
}

/**
 * Push-to-talk com transcrição parcial.
 *
 * `texto` acumula o que já foi reconhecido em definitivo; `parcial` é o palpite corrente,
 * que muda enquanto a pessoa fala. Mostrar o parcial é o que faz o microfone parecer vivo
 * em vez de travado.
 */
export function useMicrofone(onFinalizar?: (texto: string) => void) {
  const [estado, setEstado] = useState<EstadoMic>("parado");
  const [texto, setTexto] = useState("");
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const recRef = useRef<Reconhecedor | null>(null);
  const acumuladoRef = useRef("");
  // Guarda o callback em ref: assim trocar a função a cada render não recria o reconhecedor.
  const onFinalizarRef = useRef(onFinalizar);
  useEffect(() => { onFinalizarRef.current = onFinalizar; }, [onFinalizar]);

  useEffect(() => {
    const Ctor = construtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;      // não corta na primeira pausa da frase
    rec.interimResults = true;  // devolve o palpite enquanto fala

    rec.onresult = (e) => {
      let novoFinal = "";
      let novoParcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alternativa = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) novoFinal += alternativa;
        else novoParcial += alternativa;
      }
      if (novoFinal) {
        acumuladoRef.current = (acumuladoRef.current + " " + novoFinal).trim();
        setTexto(acumuladoRef.current);
      }
      setParcial(novoParcial);
    };

    rec.onerror = (e) => {
      // "aborted" e "no-speech" são fluxo normal (parar sem falar), não falha.
      if (e.error === "aborted" || e.error === "no-speech") return;
      setErro(
        e.error === "not-allowed"
          ? "Permissão de microfone negada. Libere o acesso na barra de endereço."
          : `Não consegui ouvir (${e.error ?? "erro desconhecido"}).`,
      );
      setEstado("parado");
    };

    rec.onend = () => {
      setEstado("parado");
      setParcial("");
      const finalizado = acumuladoRef.current.trim();
      if (finalizado) onFinalizarRef.current?.(finalizado);
    };

    recRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try { rec.abort(); } catch { /* já parado */ }
    };
  }, []);

  const iniciar = useCallback(() => {
    const rec = recRef.current;
    if (!rec || estado === "ouvindo") return;
    setErro(null);
    setTexto("");
    setParcial("");
    acumuladoRef.current = "";
    try {
      rec.start();
      setEstado("ouvindo");
    } catch {
      setErro("Não consegui abrir o microfone.");
    }
  }, [estado]);

  const parar = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* já parado */ }
    setEstado("parado");
  }, []);

  const alternar = useCallback(() => {
    if (estado === "ouvindo") parar();
    else iniciar();
  }, [estado, iniciar, parar]);

  return { estado, texto, parcial, erro, iniciar, parar, alternar, suportado: suportaMicrofone() };
}
