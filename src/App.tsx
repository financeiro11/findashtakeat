import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import RedefinirSenha from "@/components/RedefinirSenha";
import Dashboard from "./pages/Dashboard";
import DashboardLegacy from "./pages/DashboardLegacy";
import Caixa from "./pages/Caixa";
import ContaCorrente from "./pages/ContaCorrente";
import Briefing from "./pages/Briefing";
import NovidadesHub from "./pages/NovidadesHub";
import Login from "./pages/Login";
import Usuarios from "./pages/Usuarios";
import Parametrizacao from "./pages/configuracoes/Parametrizacao";
import Integracoes from "./pages/configuracoes/Integracoes";
import AutomacoesProporcionais from "./pages/AutomacoesProporcionais";
import RecargasCelulares from "./pages/RecargasCelulares";
import RecargasViagens from "./pages/RecargasViagens";
import Projetos from "./pages/Projetos";
import Balanco from "./pages/Balanco";
import Balancete from "./pages/Balancete";
import DRE from "./pages/DRE";
import DFC from "./pages/DFC";
import RevisaoMes from "./pages/RevisaoMes";
import Reportes from "./pages/Reportes";
import BPAnual from "./pages/BPAnual";
import BP from "./pages/BP";
import HistoricoVersoes from "./pages/bp/HistoricoVersoes";
import BaseConhecimento from "./pages/BaseConhecimento";
import AnalisePreditiva from "./pages/AnalisePreditiva";
import DesignSystem from "./pages/DesignSystem";
import HistoricoMultianual from "./pages/HistoricoMultianual";
import EditaisLayout from "./pages/editais/EditaisLayout";
import EditaisDashboard from "./pages/editais/Dashboard";
import EditaisRadar from "./pages/editais/Radar";
import EditaisPipeline from "./pages/editais/Pipeline";
import EditaisCalendario from "./pages/editais/Calendario";
import EditaisHistorico from "./pages/editais/Historico";
import EditaisConfiguracoes from "./pages/editais/Configuracoes";
import EditaisMonitor from "./pages/editais/Monitor";
import EditaisTriagem from "./pages/editais/Triagem";
import ProjetosAprovadosLayout, {
  ExecutivoTab, ProjetosTab, IATab, AlertasTab, PrestacaoTab, ConfigTab,
} from "./pages/editais/ProjetosAprovados";
import Tarefas from "./pages/Tarefas";
import TimeFinanceiro from "./pages/TimeFinanceiro";
import Playbook from "./pages/playbook/PlaybookHub";
import Captable from "./pages/Captable";
import Parceiros from "./pages/Parceiros";
import Orcamento from "./pages/Orcamento";
import Investimentos from "./pages/Investimentos";
import Flip from "./pages/investimentos/Flip";
import Asaas from "./pages/Asaas";
import Assinaturas from "./pages/Assinaturas";
import Auditoria from "./pages/Auditoria";
import Cartao from "./pages/Cartao";
import CartaoOmie from "./pages/operacional/CartaoOmie";
import PainelCAC from "./pages/governanca/PainelCAC";
import Rescisoes from "./pages/governanca/Rescisoes";
import NotasERP from "./pages/governanca/NotasERP";
import Vigilancia from "./pages/governanca/Vigilancia";
import PainelAutomacoes from "./pages/PainelAutomacoes";
import MonitoramentoLayout from "./pages/monitoramento/MonitoramentoLayout";
import Thetys from "./pages/monitoramento/Thetys";
import Reembolsos from "./pages/operacional/Reembolsos";
import ColaboradoresRH from "./pages/operacional/ColaboradoresRH";
import Estornos from "./pages/operacional/Estornos";
import NotasFiscais from "./pages/operacional/NotasFiscais";
import Variavel from "./pages/operacional/Variavel";
import FacilitiesDashboard from "./pages/facilities/FacilitiesDashboard";
import FacilitiesSolicitacoes from "./pages/facilities/Solicitacoes";
import FacilitiesCotacoes from "./pages/facilities/Cotacoes";
import FacilitiesRadar from "./pages/facilities/Radar";
import FacilitiesPassagens from "./pages/facilities/Passagens";
import FacilitiesFornecedores from "./pages/facilities/Fornecedores";
import FacilitiesHistorico from "./pages/facilities/Historico";
import FacilitiesContratos from "./pages/facilities/Contratos";
import AssistenteMemoria from "./pages/assistente/Memoria";
import TesteVozes from "./pages/assistente/TesteVozes";
import NotFound from "./pages/NotFound.tsx";
import LinkPublico from "./pages/LinkPublico";
import NotaPublica from "./pages/NotaPublica";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileLayout from "@/components/mobile/MobileLayout";
import { DesktopOnly } from "@/components/mobile/DesktopOnly";
import MobileInicio from "./pages/mobile/Inicio";
import MobileTarefas from "./pages/mobile/Tarefas";
import MobileExtratos from "./pages/mobile/Extratos";
import MobileNotas from "./pages/mobile/Notas";
import MobileNota from "./pages/mobile/Nota";
import MobileChat from "./pages/mobile/Chat";
import MobilePerfil from "./pages/mobile/Perfil";

const queryClient = new QueryClient();

/**
 * No celular o Hub monta um app próprio (seis abas, ver MobileShell) em vez de espremer
 * o layout de desktop. Mesma URL, mesma sessão, mesmas policies — só a árvore de telas
 * muda. Com `isMobile` falso, o que é montado aqui é exatamente o que sempre foi.
 *
 * Quem decide é a TELA do aparelho, não a janela (ver use-mobile): janela estreita no
 * computador — meia tela, por exemplo — continua sendo o Hub. Para ver o app do celular
 * no computador, `?mobile=1` na URL.
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <PortaoDeRecuperacao>
              <Rotas />
            </PortaoDeRecuperacao>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

/**
 * Quem chegou pelo link de "esqueci a senha" troca a senha ANTES de qualquer
 * outra coisa. Fica acima das rotas — desktop e celular — porque a volta do link
 * cai na raiz, e daria em qualquer tela.
 *
 * Bloquear em vez de sugerir é a decisão: quem clicou no link clicou para trocar
 * a senha. Deixar entrar sem trocar mantém viva a senha velha, que é justamente
 * a que se quer aposentar.
 */
function PortaoDeRecuperacao({ children }: { children: React.ReactNode }) {
  const { recuperacao } = useAuth();
  if (recuperacao) return <RedefinirSenha />;
  return <>{children}</>;
}

function Rotas() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/l/:token" element={<LinkPublico />} />
        {/* Anotação compartilhada com quem não tem conta. Fora do MobileLayout junto com
            o /l/: são as duas telas que precisam abrir sem sessão nenhuma. */}
        <Route path="/n/:token" element={<NotaPublica />} />
        <Route element={<MobileLayout />}>
          <Route path="/" element={<MobileInicio />} />
          <Route path="/tarefas" element={<MobileTarefas />} />
          <Route path="/extratos" element={<MobileExtratos />} />
          <Route path="/notas" element={<MobileNotas />} />
          <Route path="/notas/:id" element={<MobileNota />} />
          <Route path="/chat" element={<MobileChat />} />
          <Route path="/perfil" element={<MobilePerfil />} />
          {/* Atalhos: o que virou aba no celular redireciona em vez de dizer "abra no PC".
              Vale para link colado do desktop — /governanca/cartao abre a aba certa. */}
          <Route path="/briefing" element={<Navigate to="/" replace />} />
          <Route path="/briefing/novidades" element={<Navigate to="/" replace />} />
          <Route path="/playbook" element={<Navigate to="/notas" replace />} />
          <Route path="/governanca/cartao" element={<Navigate to="/extratos?fonte=cartao" replace />} />
          <Route path="/caixa/conta-corrente/sicoob" element={<Navigate to="/extratos?fonte=sicoob" replace />} />
          <Route path="/caixa/conta-corrente/asaas" element={<Navigate to="/extratos?fonte=asaas" replace />} />
          {/* Todo o resto do Hub — DRE, auditorias, orçamento, editais, parceiros,
              facilities, recargas, admin — só no computador. */}
          <Route path="*" element={<DesktopOnly />} />
        </Route>
      </Routes>
    );
  }

  return (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/l/:token" element={<LinkPublico />} />
            <Route path="/n/:token" element={<NotaPublica />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard-legacy" element={<DashboardLegacy />} />
              <Route path="/briefing" element={<Briefing />} />
              {/* O que mudou no PRÓPRIO Hub. Mora debaixo do briefing porque é a
                  mesma leitura de manhã — ver pages/NovidadesHub.tsx. */}
              <Route path="/briefing/novidades" element={<NovidadesHub />} />
              <Route path="/caixa" element={<Caixa />} />
              <Route path="/caixa/conta-corrente/:banco" element={<ContaCorrente />} />
              <Route path="/design-system" element={<DesignSystem />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/configuracoes/parametrizacao" element={<Parametrizacao />} />
              <Route path="/automacoes/proporcionais" element={<AutomacoesProporcionais />} />

              {/* "Está tudo funcionando?" — a agente, os crons e as credenciais no
                  mesmo lugar, em abas. A Vigilância externa NÃO entra aqui: ela
                  vigia o mercado, não a saúde do Hub. */}
              <Route path="/monitoramento" element={<MonitoramentoLayout />}>
                <Route index element={<Navigate to="/monitoramento/thetys" replace />} />
                <Route path="thetys" element={<Thetys />} />
                {/* A faixa do topo, aberta: a esteira das notas etapa a etapa e as
                    46 automações com o que responderam. */}
                <Route path="automacoes" element={<PainelAutomacoes />} />
                <Route path="integracoes" element={<Integracoes />} />
              </Route>
              {/* Os dois endereços antigos: favoritos, links colados em tarefa e o
                  destino do AvisoGrave continuam chegando. */}
              <Route path="/automacoes/painel" element={<Navigate to="/monitoramento/automacoes" replace />} />
              <Route path="/configuracoes/integracoes" element={<Navigate to="/monitoramento/integracoes" replace />} />
              <Route path="/recargas/celulares" element={<RecargasCelulares />} />
              <Route path="/recargas/viagens" element={<RecargasViagens />} />
              {/* Catálogo virou a aba "IA & Automação" da Visão do Time — redireciona links antigos. */}
              <Route path="/automacoes/catalogo" element={<Navigate to="/time/visao" replace />} />
              <Route path="/automacoes/projetos" element={<Projetos />} />
              <Route path="/editais" element={<EditaisLayout />}>
                <Route index element={<EditaisDashboard />} />
                <Route path="radar" element={<EditaisRadar />} />
                <Route path="triagem" element={<EditaisTriagem />} />
                <Route path="pipeline" element={<EditaisPipeline />} />
                <Route path="calendario" element={<EditaisCalendario />} />
                <Route path="historico" element={<EditaisHistorico />} />
                <Route path="monitor" element={<EditaisMonitor />} />
                <Route path="projetos-aprovados" element={<ProjetosAprovadosLayout />}>
                  <Route index element={<ExecutivoTab />} />
                  <Route path="projetos" element={<ProjetosTab />} />
                  <Route path="ia" element={<IATab />} />
                  <Route path="alertas" element={<AlertasTab />} />
                  <Route path="prestacao" element={<PrestacaoTab />} />
                  <Route path="config" element={<ConfigTab />} />
                </Route>
                <Route path="configuracoes" element={<EditaisConfiguracoes />} />
              </Route>
              <Route path="/tarefas" element={<Tarefas />} />
              <Route path="/time/visao" element={<TimeFinanceiro />} />
              <Route path="/playbook" element={<Playbook />} />
              {/* Endereço de uma anotação — o MESMO no computador e no celular (lá é
                  MobileNota, aqui é o Workspace com ela aberta). É o link que se
                  compartilha, então não pode existir um por aparelho.
                  `:id?` numa rota só, e não duas: com duas Routes apontando para o mesmo
                  elemento, ir da lista para a nota desmontaria o Hub inteiro e piscaria. */}
              <Route path="/notas/:id?" element={<Playbook />} />
              <Route path="/captable" element={<Captable />} />
              <Route path="/demonstracoes/dre" element={<DRE />} />
              <Route path="/demonstracoes/dfc" element={<DFC />} />
              {/* Apresentações: o que sai do Hub para uma plateia. */}
              <Route path="/apresentacoes/revisao" element={<RevisaoMes />} />
              <Route path="/apresentacoes/reportes" element={<Reportes />} />
              {/* A Revisão morava em Demonstrações. O link antigo continua valendo —
                  está em favorito de gente, em histórico de navegador e no texto de
                  outras telas; quebrar isso para arrumar um menu não vale. */}
              <Route path="/demonstracoes/revisao" element={<Navigate to="/apresentacoes/revisao" replace />} />
              <Route path="/demonstracoes/balancete" element={<Balancete />} />
              <Route path="/demonstracoes/balanco" element={<Balanco />} />
              <Route path="/bp" element={<Navigate to={`/bp/${new Date().getFullYear()}`} replace />} />
              <Route path="/bp/versoes" element={<HistoricoVersoes />} />
              <Route path="/bp/:ano" element={<BP />} />
              <Route path="/analise/cenarios" element={<AnalisePreditiva />} />
              <Route path="/analise/bp" element={<BPAnual />} />
              <Route path="/analise/historico" element={<HistoricoMultianual />} />
              <Route path="/analise/conhecimento" element={<BaseConhecimento />} />
              <Route path="/operacional/parceiros" element={<Parceiros />} />
              <Route path="/orcamento" element={<Orcamento />} />
              <Route path="/investimentos" element={<Investimentos />} />
              {/* O flip é história, não demonstração: mora ao lado dos financials
                  porque é a mesma pergunta ("o que temos lá fora?"), mas numa rota
                  própria — o texto dos quatro cadernos não cabe numa aba. */}
              <Route path="/investimentos/flip" element={<Flip />} />
              <Route path="/asaas" element={<Asaas />} />
              <Route path="/assinaturas" element={<Assinaturas />} />
              <Route path="/governanca/auditoria" element={<Auditoria />} />
              <Route path="/governanca/cartao" element={<Cartao />} />
              <Route path="/governanca/cac" element={<PainelCAC />} />
              <Route path="/governanca/rescisoes" element={<Rescisoes />} />
              {/* A cobertura de notas de fornecedor dentro do Omie. Mora na
                  Governança e não na Auditoria porque a pergunta é do fechamento
                  inteiro ("está tudo no ERP?"), não de um achado. */}
              <Route path="/governanca/notas-erp" element={<NotasERP />} />
              <Route path="/governanca/vigilancia" element={<Vigilancia />} />
              {/* A aba Extratos existe só no celular; no computador cada fonte tem a sua
                  página própria, e a do cartão é a mais parecida com ela. */}
              <Route path="/extratos" element={<Navigate to="/governanca/cartao" replace />} />
              <Route path="/operacional/cartao" element={<CartaoOmie />} />
              <Route path="/operacional/reembolsos" element={<Reembolsos />} />
              <Route path="/operacional/colaboradores" element={<ColaboradoresRH />} />
              <Route path="/operacional/estornos" element={<Estornos />} />
              <Route path="/operacional/notas-fiscais" element={<NotasFiscais />} />
              <Route path="/operacional/variavel" element={<Variavel />} />
              <Route path="/facilities" element={<FacilitiesDashboard />} />
              <Route path="/facilities/solicitacoes" element={<FacilitiesSolicitacoes />} />
              <Route path="/facilities/cotacoes" element={<FacilitiesCotacoes />} />
              <Route path="/facilities/radar" element={<FacilitiesRadar />} />
              <Route path="/facilities/passagens" element={<FacilitiesPassagens />} />
              <Route path="/facilities/fornecedores" element={<FacilitiesFornecedores />} />
              <Route path="/facilities/historico" element={<FacilitiesHistorico />} />
              <Route path="/facilities/contratos" element={<FacilitiesContratos />} />
              {/* O Assistente em si é a bolinha flutuante (AIAssistant), não uma página.
                  Estas rotas são só os anexos dele. */}
              <Route path="/assistente/memoria" element={<AssistenteMemoria />} />
              {/* Diagnóstico do Assistente — fora do menu de propósito (ver TesteVozes.tsx). */}
              <Route path="/assistente/teste-voz" element={<TesteVozes />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
  );
}

export default App;
