import { NavLink, Navigate, useLocation } from "react-router-dom";
import { Plane, Radar as RadarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Radar from "./Radar";
import Passagens from "./Passagens";

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

export default function RadarDeCompras({ aba }: { aba: "produtos" | "passagens" }) {
  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Radar de compras</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
          Diga o que precisa comprar e quanto vale a pena pagar. O Hub acompanha o preço e avisa quando dá para comprar.
        </p>
      </div>

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
    </div>
  );
}

/** O endereço antigo (favoritos, sino, links em mensagens) continua chegando — com o `?solicitacao=` junto. */
export function RedirecionaPassagens() {
  const { search } = useLocation();
  return <Navigate to={`/facilities/radar/passagens${search}`} replace />;
}
