/* ---------------------------------------------------------------------------
 * EMITIR AGORA — a corrente inteira, num clique, até o número da nota.
 *
 * O PEDIDO QUE ORIGINOU ISTO (Henrique, 11/09/2026): "a partir do momento que eu
 * falar que eu quero emitir aquela nota, você tem que fazer tudo para que aquela
 * nota seja emitida. Antes de chegar para mim um erro, você tem que me garantir
 * que já atentou a tudo. Senão não é automação."
 *
 * O QUE ESTAVA ERRADO ANTES. Emitir era um passo só, e todos os pré-requisitos
 * eram descobertos por FALHA, um por vez, cada um mandando a pessoa resolver
 * noutro lugar: "Cliente sem cadastro no Omie" (e o botão de cadastrar não
 * existia para cobrança pendente), "o lote N ainda está em processamento",
 * "teto do dia atingido", "a emissão está desligada". Quatro paredes diferentes,
 * nenhuma delas o fim do trabalho — todas o começo de outro.
 *
 * A REGRA DESTE ARQUIVO, e ela vale linha a linha: só sobe para a pessoa o que
 * sobrar de três filtros — (1) o Hub tentou e não conseguiu, (2) falta uma
 * informação que só ela tem, (3) seguir seria arriscar errar de um jeito que não
 * se desfaz. Tudo o mais é espera, retentativa ou trabalho, e espera não é
 * pergunta. Quando algo ASSIM MESMO chega até ela, chega dizendo o que já foi
 * tentado — senão "não deu" se lê como "ninguém tentou".
 *
 * POR QUE A ORQUESTRAÇÃO MORA NO NAVEGADOR e não numa Edge Function: a corrente
 * inteira não cabe nos 150s do worker. Só o cadastro custa até 40s (Receita +
 * CEP + IncluirCliente), a emissão de uma cobrança ~40-90s, e a nota nasce 2-3
 * MINUTOS depois do lote — o Omie fatura assíncrono. Uma função que esperasse
 * tudo morreria no meio, com a OS criada e sem nota, que é o pior desfecho
 * possível. Aqui cada degrau é uma chamada curta, e quem espera é a tela.
 *
 * O QUE NÃO DÁ PARA VENCER, e está dito na cara do usuário: o número da nota não
 * nasce no clique. `FaturarLoteOS` volta na hora, o lote fecha em ~2 min, o RPS
 * nasce '001' e vira '004' (autorizado, com número) ~1 min depois. O que esta
 * tela faz é ficar olhando por você.
 * ------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Check, TriangleAlert, Hourglass, Zap, FileText, UserPlus, Send, Info, X,
} from "lucide-react";
import {
  BLOQUEIOS_CADASTRO, formatarDoc, precisaEsperarOLote, esperaAntesDeRepetir,
  type LinhaNota,
} from "@/lib/notasFiscais";

const sb = supabase as any;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

const brl = (n: number) =>
  `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------------------------------------------------------------------------
 * OS QUATRO DEGRAUS. São fixos e sempre visíveis, inclusive os que ainda não
 * aconteceram: uma barra que só mostra o passo atual não deixa ninguém entender
 * onde parou quando para — e "parou no passo 3 de 4" é uma informação diferente
 * de "falhou".
 * ------------------------------------------------------------------------- */
export type PassoId = "cadastro" | "emissao" | "nota" | "espelho";
type Estado = "espera" | "correndo" | "ok" | "atencao" | "falhou";

const PASSOS: Array<{ id: PassoId; titulo: string; icone: typeof UserPlus }> = [
  { id: "cadastro", titulo: "Cadastro do tomador no Omie", icone: UserPlus },
  { id: "emissao", titulo: "Ordem de serviço e faturamento", icone: Send },
  { id: "nota", titulo: "NFS-e autorizada pela prefeitura", icone: FileText },
  { id: "espelho", titulo: "Número gravado no Hub", icone: Check },
];

interface Passo { estado: Estado; detalhe: string | null }
type Painel = Record<PassoId, Passo>;

const PAINEL_ZERO: Painel = {
  cadastro: { estado: "espera", detalhe: null },
  emissao: { estado: "espera", detalhe: null },
  nota: { estado: "espera", detalhe: null },
  espelho: { estado: "espera", detalhe: null },
};

/** O que sobrou para uma pessoa decidir — e por quê. */
export interface ParaVoce {
  id_asaas: string | null;
  nome: string;
  titulo: string;
  /** O que fazer. Instrução, nunca rótulo. */
  oQueFazer: string;
  /** O que a máquina já tentou antes de desistir. */
  tentado: string[];
}

/* Quanto tempo esperar a prefeitura antes de desistir de OLHAR (a nota continua
 * a caminho de qualquer jeito — desistir aqui é desistir de assistir, não de
 * emitir). Medido: o lote fecha em ~2min e o RPS vira '004' ~1min depois. */
const ESPERA_NOTA_MS = 5 * 60_000;
const INTERVALO_NOTA_MS = 20_000;

export function EmitirAgora({
  aberto, ids, linhas, observacao, avulsa, onFechar, onTerminou,
}: {
  aberto: boolean;
  ids: string[];
  linhas: LinhaNota[];
  observacao?: string | null;
  avulsa?: boolean;
  onFechar: () => void;
  onTerminou: () => void | Promise<void>;
}) {
  const [painel, setPainel] = useState<Painel>(PAINEL_ZERO);
  const [rodando, setRodando] = useState(false);
  const [terminou, setTerminou] = useState(false);
  const [paraVoce, setParaVoce] = useState<ParaVoce[]>([]);
  const [notas, setNotas] = useState<Array<{ id_asaas: string; nome: string; numero: string | null }>>([]);
  const [freios, setFreios] = useState<string[]>([]);
  /* O laço lê isto para saber se ainda está na tela. `useRef` e não `useState`
     porque um laço com `await` lá dentro enxerga o valor da renderização em que
     começou — state congelado é o erro clássico deste tipo de motor. */
  const vivo = useRef(true);

  const nomeDe = useCallback(
    (id: string) => linhas.find((l) => l.id_asaas === id)?.cliente_asaas ?? id,
    [linhas],
  );

  const marcar = (id: PassoId, estado: Estado, detalhe: string | null = null) =>
    setPainel((p) => ({ ...p, [id]: { estado, detalhe } }));

  /* ------------------------------------------------------------------------
   * PASSO 1 — o cadastro do tomador.
   *
   * Roda SEMPRE, mesmo quando todos já têm cadastro: a resposta "já tinham"
   * custa uma consulta local e vale mais do que a economia, porque é ela que
   * transforma "Cliente sem cadastro no Omie" (erro no fim) em "conferido"
   * (degrau no começo).
   * --------------------------------------------------------------------- */
  const garantirCadastros = async (): Promise<{ ok: boolean; pendencias: ParaVoce[] }> => {
    marcar("cadastro", "correndo", "Conferindo no Omie e criando o que faltar…");
    const { data, error } = await sb.functions.invoke("omie-clientes-criar", {
      body: { action: "garantir", ids },
    });
    if (error || data?.erro) {
      marcar("cadastro", "falhou", error?.message ?? data?.erro);
      return {
        ok: false,
        pendencias: [{
          id_asaas: null, nome: "—",
          titulo: "Não deu para conferir o cadastro no Omie",
          oQueFazer: "É falha de conexão com o Omie ou com o Hub, não de dado. Tente de novo em um minuto — " +
            "nada foi escrito em lugar nenhum.",
          tentado: ["chamada ao Omie"],
        }],
      };
    }

    const res: any[] = data?.resultados ?? [];
    const criados = res.filter((r) => r.situacao === "criado");
    const jaTinham = res.filter((r) => r.situacao === "ja_tinha" || r.situacao === "ja_existia");
    const travados = res.filter((r) => r.situacao === "bloqueado" || r.situacao === "falhou");

    /* O QUE SOBE PARA A PESSOA, e só isto: cadastro que a máquina não consegue
       montar. Cada motivo vira instrução — `BLOQUEIOS_CADASTRO` já traduz os
       códigos —, e junto vai o que foi tentado, porque um CEP que não existe nos
       Correios só se conserta com a informação que a pessoa tem. */
    const pendencias: ParaVoce[] = travados.map((r) => ({
      id_asaas: null,
      nome: `${r.nome ?? "cliente sem nome"} · ${formatarDoc(r.doc)}`,
      titulo: r.situacao === "bloqueado"
        ? "O cadastro deste tomador não pode ser montado sozinho"
        : "O Omie recusou o cadastro",
      oQueFazer: BLOQUEIOS_CADASTRO[r.motivo ?? ""] ?? r.motivo ?? "Sem motivo informado.",
      tentado: r.tentado ?? ["Receita Federal (CNPJ)", "Correios (CEP)", "cadastro do Asaas"],
    }));

    const partes = [
      jaTinham.length ? `${jaTinham.length} já tinha${jaTinham.length > 1 ? "m" : ""}` : "",
      criados.length ? `${criados.length} criado${criados.length > 1 ? "s" : ""} agora` : "",
      travados.length ? `${travados.length} sem caminho automático` : "",
    ].filter(Boolean).join(" · ");

    marcar("cadastro", travados.length ? "atencao" : "ok", partes || "Nada a fazer.");
    // Segue mesmo com pendência: as OUTRAS cobranças do lote não têm culpa.
    return { ok: Number(data?.prontos ?? 0) > 0, pendencias };
  };

  /* ------------------------------------------------------------------------
   * PASSO 2 — a emissão.
   *
   * "LOTE EM VOO" NÃO É ERRO, É FILA DO OMIE. Ele fatura um lote por vez; com o
   * anterior `RUNNING`, a função recusa a leva e NÃO cria nada. Tratar isso como
   * falha foi o que fazia a emissão em massa desistir no segundo bloco. Aqui a
   * resposta certa é a mesma: esperar e repetir a MESMA leva.
   * --------------------------------------------------------------------- */
  const emitir = async (): Promise<{ ok: boolean; oss: Array<{ id_asaas: string; n_cod_os: number }>; pendencias: ParaVoce[] }> => {
    marcar("emissao", "correndo", "Criando a OS no Omie e disparando o lote…");
    for (let tentativa = 1; tentativa <= 6 && vivo.current; tentativa++) {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        body: {
          action: "emitir", ids, avulsa: avulsa === true,
          observacao: observacao?.trim() || null,
          /* O CLIQUE É A AUTORIZAÇÃO (decisão do Henrique, 11/09/2026): a chave
             geral e o teto do dia são freios de VAZÃO, feitos para a máquina que
             decide 54 vezes por dia. Uma pessoa pedindo uma nota não é esse
             risco. O que foi furado volta em `freios_furados` e aparece na tela
             — furar em silêncio seria o outro extremo do mesmo erro. */
          forcar: true,
        },
      });

      if (error) {
        marcar("emissao", "falhou", error.message);
        return { ok: false, oss: [], pendencias: [{
          id_asaas: null, nome: "—", titulo: "A emissão não respondeu",
          oQueFazer: "Falha de rede ou a função caiu. Nada foi faturado. Tente de novo — " +
            "se a OS tiver sido criada, a próxima tentativa a reencontra pelo carimbo, sem duplicar.",
          tentado: [`${tentativa} tentativa(s)`],
        }] };
      }

      if (Array.isArray(data?.freios_furados) && data.freios_furados.length) setFreios(data.freios_furados);

      // O Omie ainda está faturando o lote anterior: espera e repete a MESMA leva.
      if (precisaEsperarOLote(data)) {
        const espera = esperaAntesDeRepetir(tentativa);
        marcar("emissao", "correndo",
          `O Omie está faturando um lote anterior — esperando ${Math.round(espera / 1000)}s e tentando de novo ` +
          `(${tentativa}ª vez). Nada foi perdido.`);
        await dorme(espera);
        continue;
      }

      const resultados: any[] = data?.resultados ?? [];
      const despachadas = resultados.filter((r) => r.em_processamento);
      const jaTinham = resultados.filter((r) => r.ja_emitida);
      const barradas = resultados.filter((r) => r.bloqueado);
      const falhas = resultados.filter((r) => !r.ok && !r.em_processamento && !r.bloqueado && !r.ja_emitida);

      const pendencias: ParaVoce[] = [
        ...barradas.map((b) => ({
          id_asaas: b.id_asaas, nome: nomeDe(b.id_asaas),
          titulo: "Barrada na conferência com o Asaas",
          oQueFazer: `${b.erro ?? "Sem motivo."} Nada foi mandado ao Omie. Isto não se resolve repetindo: ` +
            "o dinheiro voltou ou a cobrança mudou de estado.",
          tentado: ["leitura ao vivo da cobrança no Asaas, no instante da emissão"],
        })),
        ...falhas.map((f) => ({
          id_asaas: f.id_asaas, nome: nomeDe(f.id_asaas),
          titulo: "O Omie recusou",
          oQueFazer: f.erro ?? "Sem motivo informado.",
          tentado: ["cadastro conferido/criado", "OS criada", "faturamento"],
        })),
      ];

      if (data?.pulada && !despachadas.length) {
        marcar("emissao", "falhou", data.pulada);
        return { ok: false, oss: [], pendencias: [{
          id_asaas: null, nome: "—", titulo: "A rodada não andou",
          oQueFazer: String(data.pulada),
          tentado: ["emissão com os freios furados"],
        }] };
      }

      const partes = [
        despachadas.length ? `${despachadas.length} despachada${despachadas.length > 1 ? "s" : ""}` : "",
        jaTinham.length ? `${jaTinham.length} já tinha${jaTinham.length > 1 ? "m" : ""} nota` : "",
        barradas.length ? `${barradas.length} barrada${barradas.length > 1 ? "s" : ""}` : "",
        falhas.length ? `${falhas.length} recusada${falhas.length > 1 ? "s" : ""} pelo Omie` : "",
      ].filter(Boolean).join(" · ");

      marcar("emissao", despachadas.length ? (pendencias.length ? "atencao" : "ok") : "falhou",
        `${partes || "Nada a emitir."}${data?.lote ? ` · lote ${data.lote}` : ""}`);

      return {
        ok: despachadas.length > 0,
        oss: despachadas
          .filter((d) => Number(d.n_cod_os) > 0)
          .map((d) => ({ id_asaas: d.id_asaas, n_cod_os: Number(d.n_cod_os) })),
        pendencias,
      };
    }

    marcar("emissao", "falhou", "O Omie seguiu ocupado com outro lote em todas as tentativas.");
    return { ok: false, oss: [], pendencias: [{
      id_asaas: null, nome: "—", titulo: "O Omie ficou ocupado o tempo todo",
      oQueFazer: "Um lote anterior seguiu em processamento por mais de 3 minutos. Nada foi perdido e nada foi " +
        "criado em duplicidade — mande de novo daqui a pouco.",
      tentado: ["6 tentativas, com espera crescente entre elas"],
    }] };
  };

  /* ------------------------------------------------------------------------
   * PASSO 3 — a nota. Aqui só se espera, e esperar não é perguntar.
   *
   * `{action:"etapas", os}` faz UM `StatusOS` — não o `ListarOS` inteiro —,
   * então não disputa a trava do Omie com o espelho e custa uma chamada por
   * volta. É a leitura mais barata que responde "a prefeitura autorizou?".
   * --------------------------------------------------------------------- */
  const esperarNota = async (oss: Array<{ id_asaas: string; n_cod_os: number }>) => {
    if (!oss.length) { marcar("nota", "espera", "Nenhuma OS para acompanhar."); return []; }
    marcar("nota", "correndo", "O lote foi para a prefeitura. A nota costuma nascer em 2 a 3 minutos…");

    const achadas = new Map<string, string>();
    const ate = Date.now() + ESPERA_NOTA_MS;

    while (vivo.current && Date.now() < ate && achadas.size < oss.length) {
      await dorme(INTERVALO_NOTA_MS);
      for (const os of oss) {
        if (!vivo.current || achadas.has(os.id_asaas)) continue;
        try {
          const { data } = await sb.functions.invoke("omie-nfse-sync", {
            body: { action: "etapas", os: os.n_cod_os },
          });
          const numero = data?.nfse?.nfse_numero ?? null;
          const status = String(data?.nfse?.nfse_status ?? "");
          if (numero && status === "004") achadas.set(os.id_asaas, String(numero));
          /* '003' é RECUSA DA PREFEITURA, e é definitiva para esta OS: a OS
             consta faturada e não existe nota. Parar de esperar aqui é o certo —
             o tempo não resolve, e insistir esconderia o problema por 5 min. */
          else if (status === "003") achadas.set(os.id_asaas, "");
        } catch { /* uma volta perdida não é desfecho; a próxima tenta de novo */ }
      }
      const quantas = [...achadas.values()].filter(Boolean).length;
      if (achadas.size < oss.length) {
        marcar("nota", "correndo",
          `${quantas} de ${oss.length} já autorizada${quantas === 1 ? "" : "s"} — ` +
          `faltam ${Math.max(0, Math.round((ate - Date.now()) / 1000))}s de espera.`);
      }
    }

    const saidas = oss.map((o) => ({
      id_asaas: o.id_asaas, nome: nomeDe(o.id_asaas), numero: achadas.get(o.id_asaas) || null,
    }));
    setNotas(saidas);

    const comNumero = saidas.filter((s) => s.numero);
    const recusadas = oss.filter((o) => achadas.get(o.id_asaas) === "");
    if (recusadas.length) {
      marcar("nota", "atencao", `${comNumero.length} autorizada(s) · ${recusadas.length} recusada(s) pela prefeitura.`);
    } else if (comNumero.length === oss.length) {
      marcar("nota", "ok", comNumero.map((c) => `nota ${c.numero}`).join(" · "));
    } else {
      /* NÃO É FALHA, é a prefeitura demorando mais do que 5 min. A nota continua
         a caminho e o espelho das :05 a encontra sozinho — dizer "falhou" aqui
         mandaria alguém emitir de novo o que já está na rua. */
      marcar("nota", "atencao",
        `${comNumero.length} de ${oss.length} autorizada(s) até agora. O resto continua a caminho — ` +
        "a prefeitura está demorando mais que o normal, e o Hub pega o número sozinho na próxima sincronização.");
    }
    return saidas;
  };

  /* PASSO 4 — gravar o número aqui dentro, para a tela do mês parar de dizer
     "No forno". É o mesmo trabalho do botão "Atualizar do Omie", feito por
     você. */
  const gravarEspelho = async () => {
    marcar("espelho", "correndo", "Gravando o número no Hub…");
    try {
      const { data, error } = await sb.functions.invoke("omie-nfse-sync", {
        body: { action: "espelhar", anexar: false },
      });
      if (error || data?.erro) throw new Error(error?.message ?? data?.erro);
      marcar("espelho", "ok", `${data?.com_nota ?? 0} OS com nota autorizada no espelho.`);
    } catch (e: any) {
      /* Falhar aqui não perde nada: a nota existe no Omie e o cron do espelho
         roda de 10 em 10 minutos. É o único passo cujo fracasso não é assunto de
         ninguém. */
      marcar("espelho", "atencao", "Não deu para sincronizar agora — o cron do espelho grava o número em até 10 min.");
    }
  };

  const correr = useCallback(async () => {
    setRodando(true); setTerminou(false); setParaVoce([]); setNotas([]); setFreios([]);
    setPainel(PAINEL_ZERO);
    vivo.current = true;
    const pendencias: ParaVoce[] = [];
    try {
      const cad = await garantirCadastros();
      pendencias.push(...cad.pendencias);
      if (!cad.ok) {
        marcar("emissao", "espera", "Não há tomador pronto para emitir.");
        return;
      }
      if (!vivo.current) return;

      const emi = await emitir();
      pendencias.push(...emi.pendencias);
      if (!emi.ok) return;
      if (!vivo.current) return;

      await esperarNota(emi.oss);
      if (!vivo.current) return;
      await gravarEspelho();
    } finally {
      setParaVoce(pendencias);
      setRodando(false);
      setTerminou(true);
      await onTerminou();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), observacao, avulsa]);

  useEffect(() => {
    if (!aberto) return;
    vivo.current = true;
    void correr();
    return () => { vivo.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const selecionadas = linhas.filter((l) => ids.includes(l.id_asaas));
  const total = selecionadas.reduce((s, l) => s + Number(l.valor || 0), 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o && !rodando) onFechar(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" />
            Emitindo {ids.length === 1 ? "a nota" : `${ids.length} notas`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {ids.length === 1
              ? `${selecionadas[0]?.cliente_asaas ?? ids[0]} · ${brl(total)}`
              : `${ids.length} cobranças · ${brl(total)}`}
            {" — o Hub cuida de tudo: cadastro do tomador, ordem de serviço, faturamento e o número da nota."}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-1">
          {PASSOS.map((p, i) => {
            const e = painel[p.id];
            const Icone = p.icone;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-md border p-2.5 text-xs",
                  e.estado === "correndo" && "border-primary/40 bg-primary/5",
                  e.estado === "ok" && "border-emerald-500/30 bg-emerald-500/5",
                  e.estado === "atencao" && "border-amber-500/40 bg-amber-500/5",
                  e.estado === "falhou" && "border-destructive/40 bg-destructive/5",
                  e.estado === "espera" && "border-border opacity-60",
                )}
              >
                <span className="mt-px shrink-0">
                  {e.estado === "correndo" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    : e.estado === "ok" ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    : e.estado === "atencao" ? <TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    : e.estado === "falhou" ? <X className="h-3.5 w-3.5 text-destructive" />
                    : <Hourglass className="h-3.5 w-3.5 text-muted-foreground" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Icone className="h-3 w-3 shrink-0 text-muted-foreground" />
                    {i + 1}. {p.titulo}
                  </span>
                  {e.detalhe && (
                    <span className="mt-0.5 block leading-relaxed text-muted-foreground">{e.detalhe}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        {/* As notas que saíram, com número. É o desfecho que a pessoa veio ver. */}
        {notas.some((n) => n.numero) && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
            {notas.filter((n) => n.numero).map((n) => (
              <div key={n.id_asaas} className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">{n.nome}</span>
                <span className="num shrink-0 font-medium text-emerald-700 dark:text-emerald-400">NFS-e {n.numero}</span>
              </div>
            ))}
          </div>
        )}

        {/* O que foi furado — dito, nunca silencioso. */}
        {freios.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Seu clique venceu {freios.length > 1 ? "estes freios" : "este freio"}:</strong>{" "}
              {freios.join(" ")} A emissão seguiu assim mesmo, e isso fica registrado com o seu nome no
              Registro de emissões.
            </span>
          </div>
        )}

        {/* ================= O QUE SOBROU PARA VOCÊ =================
            Só aparece quando existe. Uma caixa permanente de "pendências"
            vazia treina a pessoa a ignorá-la no dia em que ela tiver algo. */}
        {terminou && paraVoce.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <TriangleAlert className="h-3.5 w-3.5" />
              {paraVoce.length === 1 ? "Uma coisa precisa de você" : `${paraVoce.length} coisas precisam de você`}
            </div>
            {paraVoce.map((p, i) => (
              <div key={i} className="rounded border border-border bg-background p-2 text-[11px] leading-relaxed">
                <div className="font-medium text-foreground">{p.titulo}</div>
                {p.nome !== "—" && <div className="text-muted-foreground">{p.nome}</div>}
                <div className="mt-1 text-muted-foreground">{p.oQueFazer}</div>
                {/* O QUE JÁ FOI TENTADO. Sem isto, "não deu" se lê como "ninguém
                    tentou" — e a pessoa refaz à mão o que a máquina acabou de
                    fazer, para chegar na mesma parede. */}
                {p.tentado.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground/70">
                    Já tentado antes de chegar até você: {p.tentado.join(" · ")}.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {terminou && paraVoce.length === 0 && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            <span>Nada ficou pendente para você.</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          {rodando ? (
            <button
              onClick={() => { vivo.current = false; onFechar(); }}
              className="ghost-btn rounded-md border border-border px-3 py-1.5 text-xs"
              title="Fecha a janela. O que já foi despachado ao Omie continua — a nota nasce de todo jeito e o espelho pega o número sozinho."
            >
              Fechar e deixar rodando
            </button>
          ) : (
            <button
              onClick={onFechar}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Fechar
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
