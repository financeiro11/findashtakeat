import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import DashboardLegacy from "./pages/DashboardLegacy";
import Caixa from "./pages/Caixa";
import Briefing from "./pages/Briefing";
import Login from "./pages/Login";
import Usuarios from "./pages/Usuarios";
import AutomacoesCatalogo from "./pages/AutomacoesCatalogo";
import AutomacoesProporcionais from "./pages/AutomacoesProporcionais";
import RecargasCelulares from "./pages/RecargasCelulares";
import RecargasViagens from "./pages/RecargasViagens";
import Projetos from "./pages/Projetos";
import Balanco from "./pages/Balanco";
import Balancete from "./pages/Balancete";
import DRE from "./pages/DRE";
import DFC from "./pages/DFC";
import BPAnual from "./pages/BPAnual";
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
import Playbook from "./pages/playbook/PlaybookHub";
import Captable from "./pages/Captable";
import Parceiros from "./pages/Parceiros";
import Orcamento from "./pages/Orcamento";
import Investimentos from "./pages/Investimentos";
import Asaas from "./pages/Asaas";
import Auditoria from "./pages/Auditoria";
import Reembolsos from "./pages/operacional/Reembolsos";
import Estornos from "./pages/operacional/Estornos";
import FacilitiesDashboard from "./pages/facilities/FacilitiesDashboard";
import FacilitiesSolicitacoes from "./pages/facilities/Solicitacoes";
import FacilitiesCotacoes from "./pages/facilities/Cotacoes";
import FacilitiesFornecedores from "./pages/facilities/Fornecedores";
import FacilitiesHistorico from "./pages/facilities/Historico";
import FacilitiesContratos from "./pages/facilities/Contratos";
import NotFound from "./pages/NotFound.tsx";
import LinkPublico from "./pages/LinkPublico";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/l/:token" element={<LinkPublico />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard-legacy" element={<DashboardLegacy />} />
              <Route path="/briefing" element={<Briefing />} />
              <Route path="/caixa" element={<Caixa />} />
              <Route path="/design-system" element={<DesignSystem />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/automacoes/proporcionais" element={<AutomacoesProporcionais />} />
              <Route path="/recargas/celulares" element={<RecargasCelulares />} />
              <Route path="/recargas/viagens" element={<RecargasViagens />} />
              <Route path="/automacoes/catalogo" element={<AutomacoesCatalogo />} />
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
              <Route path="/playbook" element={<Playbook />} />
              <Route path="/captable" element={<Captable />} />
              <Route path="/demonstracoes/dre" element={<DRE />} />
              <Route path="/demonstracoes/dfc" element={<DFC />} />
              <Route path="/demonstracoes/balancete" element={<Balancete />} />
              <Route path="/demonstracoes/balanco" element={<Balanco />} />
              <Route path="/analise/cenarios" element={<AnalisePreditiva />} />
              <Route path="/analise/bp" element={<BPAnual />} />
              <Route path="/analise/historico" element={<HistoricoMultianual />} />
              <Route path="/analise/conhecimento" element={<BaseConhecimento />} />
              <Route path="/operacional/parceiros" element={<Parceiros />} />
              <Route path="/orcamento" element={<Orcamento />} />
              <Route path="/investimentos" element={<Investimentos />} />
              <Route path="/asaas" element={<Asaas />} />
              <Route path="/governanca/auditoria" element={<Auditoria />} />
              <Route path="/operacional/reembolsos" element={<Reembolsos />} />
              <Route path="/operacional/estornos" element={<Estornos />} />
              <Route path="/facilities" element={<FacilitiesDashboard />} />
              <Route path="/facilities/solicitacoes" element={<FacilitiesSolicitacoes />} />
              <Route path="/facilities/cotacoes" element={<FacilitiesCotacoes />} />
              <Route path="/facilities/fornecedores" element={<FacilitiesFornecedores />} />
              <Route path="/facilities/historico" element={<FacilitiesHistorico />} />
              <Route path="/facilities/contratos" element={<FacilitiesContratos />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
