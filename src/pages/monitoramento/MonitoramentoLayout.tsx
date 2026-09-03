/* /monitoramento — "está tudo funcionando?", num lugar só.
 *
 * POR QUE NÃO DENTRO DE CONFIGURAÇÕES DE VERDADE. As três abas daqui respondem à
 * mesma pergunta, e é uma pergunta de OLHAR: a agente fez o que devia, os crons
 * dispararam, as credenciais ainda abrem. Configurações — Parametrização,
 * Usuários, Biblioteca — é onde se MUDA coisa. Misturar as duas faz um grupo que
 * responde a duas perguntas diferentes, e aí ninguém sabe o que vai achar ao
 * clicar. No menu esta tela mora sob Configurações, porque é lá que se procura;
 * na navegação ela é uma só, com abas.
 *
 * O QUE DELIBERADAMENTE FICOU DE FORA: Vigilância externa. Ela vigia página de
 * preço de fornecedor e sinal de churn de cliente — informação do MERCADO, não
 * saúde do Hub. O lugar dela é Governança, junto das outras leituras que viram
 * decisão de negócio.
 *
 * SEM PADDING AQUI. Cada aba já põe o seu (`px-5 pt-3.5`), porque o `main` do
 * AppLayout não tem nenhum. Se este layout embrulhasse tudo num `p-6`, as três
 * telas ganhariam margem dobrada — e as duas que vieram de outro endereço não
 * foram tocadas de propósito, para que a mudança seja de lugar, não de conteúdo.
 */

import { NavLink, Outlet } from "react-router-dom";
import { Bot, Plug, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const ABAS = [
  /* O nome dela na tela é TETS, sempre — a rota e o `agentes.id` continuam
     `thetys`, que é identificador e não rótulo. */
  { to: "/monitoramento/thetys", label: "TETS", icon: Bot },
  { to: "/monitoramento/automacoes", label: "Automações", icon: Zap },
  { to: "/monitoramento/integracoes", label: "Integrações", icon: Plug },
];

export default function MonitoramentoLayout() {
  return (
    <div className="flex min-h-[calc(100vh-49px)] flex-col">
      <nav className="sticky top-0 z-10 flex items-center gap-0 overflow-x-auto border-b bg-background/85 px-4 backdrop-blur">
        {ABAS.map((a) => (
          <NavLink
            key={a.to}
            to={a.to}
            className={({ isActive }) =>
              cn(
                "relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                isActive
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )
            }
          >
            <a.icon className="h-3.5 w-3.5" />
            {a.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
