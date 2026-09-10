import { useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { PageHeader } from "@/components/PageHeader";
import { FaixaEsteira } from "@/components/FaixaEsteira";
import { AvisoGrave } from "@/components/AvisoGrave";
import { ProfileMenu } from "@/components/ProfileMenu";
import { AIAssistant } from "@/components/AIAssistant";
import { NovaVersao } from "@/components/NovaVersao";
import { AbrirNoCelular } from "@/components/AbrirNoCelular";
import { useAuth } from "@/hooks/useAuth";
import { SemAcesso } from "@/components/SemAcesso";
import { currentModule, podeVerRota } from "@/lib/modules";
import { destinoAtual, useVoltarAoDestino } from "@/lib/destinoLogin";

// Menu lateral recolhido. Quem guarda é esta camada: o SidebarProvider escreve um
// cookie que ele mesmo nunca lê de volta, então sem isto a escolha se perderia a cada
// recarga — e o menu recolhido é uma preferência de quem está na tela, não da sessão.
const MENU_KEY = "sidebar:recolhido";

export default function AppLayout() {
  const { user, loading, acesso: access } = useAuth();
  const location = useLocation();
  const { pathname } = location;
  const [menuAberto, setMenuAberto] = useState(() => {
    try { return localStorage.getItem(MENU_KEY) !== "1"; } catch { return true; }
  });
  const trocarMenu = (aberto: boolean) => {
    setMenuAberto(aberto);
    try { localStorage.setItem(MENU_KEY, aberto ? "0" : "1"); } catch { /* localStorage indisponível */ }
  };
  useVoltarAoDestino(!!user);
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  // O destino vai junto: quem recebe o link de uma anotação e ainda não entrou tem de
  // cair NELA depois do login, não na home. Sem isto, todo link compartilhado do Hub
  // acaba no Dashboard e a pessoa precisa procurar a tela na mão.
  if (!user) return <Navigate to="/login" replace state={{ destino: destinoAtual(location) }} />;

  // Conta sem perfil definido: nada abre, e a tela diz o que fazer. Fica ANTES do
  // portão porque não há para onde redirecionar — `home` dela também é vedada.
  if (access.semAcesso) return <SemAcesso />;

  /* O PORTÃO. Uma linha, porque a regra mora em lib/modules.ts (PORTAO) e é a
     mesma que filtra o menu — a tela sumir do menu e continuar respondendo pela
     URL é o pior dos dois mundos, porque parece protegida.

     Cuidado ao mexer: `home` de cada perfil PRECISA ser uma rota que ele
     alcança, senão isto vira laço de redirecionamento. O teste
     `modules.test.ts` cobre exatamente isso. */
  if (!podeVerRota(access, pathname)) {
    return <Navigate to={access.home} replace />;
  }

  const isParcerias = access.parceriasOnly;
  const emFacilities = access.facilitiesOnly || currentModule(pathname) === "facilities";

  return (
    <SidebarProvider
      open={menuAberto}
      onOpenChange={trocarMenu}
      style={{ "--sidebar-width": menuAberto ? "212px" : "56px", "--sidebar-width-icon": "56px" } as React.CSSProperties}
    >
      {/* `data-chrome` marca o que é moldura do Hub, e não conteúdo da página.
          Quem imprime (hoje, a Revisão do Mês) esconde tudo isso para o PDF sair
          com o demonstrativo e nada em volta — ver o bloco @media print em
          index.css. Marcar aqui evita que cada página que queira imprimir tenha
          de conhecer a estrutura do layout por fora. */}
      <div className="flex min-h-screen w-full bg-background">
        <div data-chrome="sidebar" className="contents"><AppSidebar /></div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Acima do cabeçalho e fora do `main`: o aviso não rola junto com a
              página nem entra no PDF de quem imprime (ver `data-chrome`). */}
          <div data-chrome="nova-versao" className="contents"><NovaVersao /></div>
          <div data-chrome="header" className="sticky top-0 z-30 flex items-center border-b border-border bg-card/95 backdrop-blur">
            <div className="flex-1"><PageHeader /></div>
            {/* A faixa das automações fica ANTES do menu de perfil e dentro do
                `data-chrome="header"`: ela acompanha a pessoa em toda página
                (é onde a pergunta "está rodando?" aparece) e some do PDF de
                quem imprime, junto com o resto da moldura. */}
            {!isParcerias && <div className="hidden px-1 sm:block"><FaixaEsteira /></div>}
            <div className="px-3"><ProfileMenu /></div>
          </div>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
        {/* O Assistente é CAPACIDADE, editável em Usuários › Perfis de acesso —
            não uma exceção escrita aqui. A bolinha responde sobre o negócio
            inteiro, com o contexto organizacional no prompt: sem esta condição,
            restringir as TELAS de um convidado não valeria nada, bastaria
            perguntar à IA o que a tela não mostra. Quem recusa de verdade é
            `pode_usar_assistente()`, dentro do ai-chat. */}
        {access.assistente && !isParcerias && !emFacilities && (
          <div data-chrome="assistente" className="contents"><AIAssistant /></div>
        )}
        {/* O aviso do que quebrou. Fica AQUI, no layout, para valer em qualquer
            página — quem precisa ser avisado é justamente quem não foi olhar o
            painel. Escondido para `parcerias`, que não opera nada disto. */}
        {!isParcerias && <AvisoGrave />}
        {/* Só aparece quando este Hub montou numa janela de celular — ver AbrirNoCelular. */}
        <AbrirNoCelular />
      </div>
    </SidebarProvider>
  );
}
