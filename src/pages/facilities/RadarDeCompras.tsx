import { useState } from "react";
import { NavLink, Navigate, useLocation } from "react-router-dom";
import { BookOpen, Plane, Radar as RadarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Radar from "./Radar";
import Passagens from "./Passagens";
import { GuiaDoRadar } from "./GuiaDoRadar";

/*
 * O RADAR DE COMPRAS É UM LUGAR SÓ, com duas abas. Passagens nasceu como tela
 * própria (03/09/2026) e continua com motor próprio — o casamento de passagem é
 * por rota e data, não por título de anúncio, e `avaliar()` não serve para ela.
 * O que junta as duas é a PERGUNTA de quem usa: "quero comprar isto, quanto vale
 * pagar, me avise quando der". Duas entradas no menu faziam o Facilities procurar
 * a passagem num lugar e o notebook no outro.
 */
const ABAS = [
  { chave: "produtos", url: "/facilities/radar", rotulo: "Produtos e equipamentos", Icon: RadarIcon },
  { chave: "passagens", url: "/facilities/radar/passagens", rotulo: "Passagens aéreas", Icon: Plane },
] as const;

/** Guardado por navegador: a faixa de boas-vindas some quando a pessoa diz que já entendeu. */
const CHAVE_CONVITE = "radarDeCompras.guiaDispensado";

export default function RadarDeCompras({ aba }: { aba: "produtos" | "passagens" }) {
  const [guiaAberto, setGuiaAberto] = useState(false);
  /* AS PRIMEIRAS VEZES. A faixa convida a abrir o passo a passo até a pessoa
     dispensar; o botão "Como usar" continua no cabeçalho para sempre. Abrir a
     gaveta não dispensa a faixa sozinho — ler uma vez não é ter aprendido. */
  const [convite, setConvite] = useState(() => {
    try { return localStorage.getItem(CHAVE_CONVITE) !== "1"; } catch { return true; }
  });

  function dispensarConvite() {
    try { localStorage.setItem(CHAVE_CONVITE, "1"); } catch { /* sem armazenamento: some só nesta visita */ }
    setConvite(false);
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Radar de compras</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
            Diga o que precisa comprar e quanto vale a pena pagar. O Hub acompanha o preço e avisa quando dá para comprar.
          </p>
        </div>
        <Button variant="outline" onClick={() => setGuiaAberto(true)}>
          <BookOpen className="mr-2 h-4 w-4" /> Como usar
        </Button>
      </div>

      {convite && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <BookOpen className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-[220px] flex-1 text-[13.5px] text-foreground">
            <span className="font-medium">Primeira vez por aqui?</span>{" "}
            <span className="text-muted-foreground">
              O passo a passo das duas abas — do cadastro ao aviso — fica sempre no botão “Como usar”, no alto da tela.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setGuiaAberto(true)}>Abrir o passo a passo</Button>
            <Button size="sm" variant="ghost" onClick={dispensarConvite}>
              <X className="mr-1 h-3.5 w-3.5" /> Entendi, não mostrar mais
            </Button>
          </div>
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-border">
        {ABAS.map((a) => (
          <NavLink
            key={a.chave}
            to={a.url}
            end
            className={({ isActive }) => cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium",
              isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <a.Icon className="h-4 w-4" /> {a.rotulo}
          </NavLink>
        ))}
      </nav>

      {aba === "passagens" ? <Passagens /> : <Radar />}

      <GuiaDoRadar open={guiaAberto} onOpenChange={setGuiaAberto} aba={aba} />
    </div>
  );
}

/** O endereço antigo (favoritos, sino, links em mensagens) continua chegando — com o `?solicitacao=` junto. */
export function RedirecionaPassagens() {
  const { search } = useLocation();
  return <Navigate to={`/facilities/radar/passagens${search}`} replace />;
}
