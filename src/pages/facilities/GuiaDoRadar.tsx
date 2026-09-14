import { AlertTriangle, Eye, ListOrdered } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GUIA, type Verbete } from "../../../supabase/functions/_shared/assistente/guia";

/*
 * O PASSO A PASSO DENTRO DA TELA — e ele NÃO é uma cópia.
 *
 * O texto sai dos verbetes do guia do Hub (`_shared/assistente/guia.ts`), o mesmo
 * que o Assistente usa para responder "como eu faço". Um manual escrito à parte
 * divergiria do Assistente na primeira edição, e a pessoa leria uma instrução na
 * gaveta e ouviria outra na bolinha. Para mudar o que aparece aqui, edite o verbete.
 */
const ROTA_DA_ABA = {
  produtos: "/facilities/radar",
  passagens: "/facilities/radar/passagens",
} as const;

export type AbaDoRadar = keyof typeof ROTA_DA_ABA;

const verbete = (aba: AbaDoRadar): Verbete | undefined => GUIA.find((v) => v.rota === ROTA_DA_ABA[aba]);

/** 'Nome do botão' no guia vira o botão desenhado: é o que a pessoa procura na tela. */
function ComBotoes({ texto }: { texto: string }) {
  const partes = texto.split(/'([^']+)'/g);
  return (
    <>
      {partes.map((p, i) => (i % 2 === 1
        ? (
          <span
            key={i}
            className="mx-0.5 inline-block rounded border border-border bg-background px-1.5 py-px text-[12.5px] font-medium leading-snug text-foreground shadow-sm"
          >
            {p}
          </span>
        )
        : <span key={i}>{p}</span>))}
    </>
  );
}

function Conteudo({ v }: { v: Verbete | undefined }) {
  if (!v) {
    return <p className="text-[13px] text-muted-foreground">O passo a passo desta aba ainda não foi escrito.</p>;
  }
  return (
    <div className="space-y-7 pb-10">
      <p className="text-[13.5px] leading-relaxed text-muted-foreground"><ComBotoes texto={v.oQueE} /></p>

      {!!v.passos?.length && (
        <div>
          <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ListOrdered className="h-3.5 w-3.5" /> Passo a passo
          </h3>
          <ol className="mt-3 space-y-3.5">
            {v.passos.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="text-[13.5px] leading-relaxed text-foreground"><ComBotoes texto={p} /></span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!!v.comoLer?.length && (
        <div>
          <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3.5 w-3.5" /> Como ler a tela
          </h3>
          <ul className="mt-3 space-y-2.5">
            {v.comoLer.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <span><ComBotoes texto={t} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!v.cuidados?.length && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Cuidados e quando algo parece errado
          </h3>
          <ul className="mt-3 space-y-2.5">
            {v.cuidados.map((t, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-amber-950 dark:text-amber-100">
                <ComBotoes texto={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GuiaDoRadar({ open, onOpenChange, aba }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** A aba em que a pessoa está — a gaveta abre nela. */
  aba: AbaDoRadar;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="text-left">
          <SheetTitle>Como usar o Radar de compras</SheetTitle>
          <SheetDescription>O passo a passo fica sempre aqui, no botão “Como usar”.</SheetDescription>
        </SheetHeader>
        {/* `key` para reabrir na aba certa: sem ele, a gaveta lembraria a última aba lida. */}
        <Tabs key={`${aba}-${open}`} defaultValue={aba} className="mt-5">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="produtos">Produtos e equipamentos</TabsTrigger>
            <TabsTrigger value="passagens">Passagens aéreas</TabsTrigger>
          </TabsList>
          <TabsContent value="produtos" className="mt-5"><Conteudo v={verbete("produtos")} /></TabsContent>
          <TabsContent value="passagens" className="mt-5"><Conteudo v={verbete("passagens")} /></TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
