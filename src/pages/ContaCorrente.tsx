import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import ContaCorrenteBancaria, { FONTES_CC, type FonteCCKey } from "@/components/ContaCorrenteBancaria";

/* Página de extrato de conta corrente, aberta pelo seletor do Caixa.
   A rota é /caixa/conta-corrente/:banco — o menu Sicoob/Asaas troca de banco
   navegando entre as rotas (cada banco é uma "página" própria). */
export default function ContaCorrente() {
  const { banco } = useParams<{ banco: string }>();
  const navigate = useNavigate();

  // Banco inválido na URL → cai no primeiro (Sicoob).
  const fonte = FONTES_CC.find((f) => f.key === banco);
  if (!fonte) return <Navigate to={`/caixa/conta-corrente/${FONTES_CC[0].key}`} replace />;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Menu de seleção no topo da página */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/caixa")}
            className="ghost-btn flex items-center gap-1 px-2 text-[12px]"
            title="Voltar ao Caixa"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Caixa
          </button>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            <h1 className="text-[18px] font-semibold tracking-tight text-foreground">Extrato · Conta Corrente</h1>
          </div>
        </div>

        {/* Abas Sicoob / Asaas — cada uma navega para a sua página */}
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {FONTES_CC.map((f) => (
            <button
              key={f.key}
              onClick={() => navigate(`/caixa/conta-corrente/${f.key}`)}
              className={cn(
                "rounded px-4 py-1.5 text-[12.5px] font-medium transition",
                fonte.key === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.nome}
            </button>
          ))}
        </div>
      </div>

      <ContaCorrenteBancaria banco={fonte.key as FonteCCKey} />
    </div>
  );
}
