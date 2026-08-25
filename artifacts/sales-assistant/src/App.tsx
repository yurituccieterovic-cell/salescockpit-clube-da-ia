import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/auth";
import { EasterEggs } from "@/lib/easter-eggs";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LeadsList from "@/pages/leads/index";
import LeadDetail from "@/pages/leads/detail";
import NewLead from "@/pages/leads/new";
import EmailsList from "@/pages/emails/index";
import EmailDetail from "@/pages/emails/detail";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import BuyCreditsPage from "@/pages/buy-credits";
import CreditsSuccessPage from "@/pages/credits-success";
import HomePage from "@/pages/home";
import MostraPage from "@/pages/mostra";
import GaleriaPage from "@/pages/galeria";
import SonhosPage from "@/pages/sonhos";
import CadastroPage from "@/pages/cadastro";
import ClubePage from "@/pages/clube/index";
import ClubeChat from "@/pages/clube/chat";
import ClubeRegister from "@/pages/clube/register";
import OraculoPage from "@/pages/oraculo";
import ArvoreCodePage from "@/pages/arvore-code";
import ArvoreWorkspacePage from "@/pages/arvore-workspace";
import SkinsPage from "@/pages/skins";
import CustosPage from "@/pages/custos";
import MapaPage from "@/pages/mapa";
import EpretPage from "@/pages/epret";
import PapPage from "@/pages/pap";
import AssembleiaPage from "@/pages/assembleia/index";
import AssembleiaSession from "@/pages/assembleia/session";
import AssembleiaHistorico from "@/pages/assembleia/historico";
import AgoraSession from "@/pages/agora/session";
import AgoraHistorico from "@/pages/agora/historico";
import JornalPage from "@/pages/jornal/index";
import VozesPage from "@/pages/vozes/index";
import EticaPage from "@/pages/etica/index";
import ContaSenhaPage from "@/pages/conta-senha";
import EcoIndex, { EcoPagina } from "@/pages/eco-publica";
import EcossistemaPage from "@/pages/ecossistema";
import PlaygroundPage from "@/pages/playground";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, allowAppUser = false }: { component: React.ComponentType; allowAppUser?: boolean }) {
  const { authenticated, appUser, loading } = useAuth();
  const [, navigate] = useLocation();
  const ok = authenticated || (allowAppUser && !!appUser);

  useEffect(() => {
    if (!loading && !ok) {
      navigate(allowAppUser ? "/buy-credits" : "/login");
    }
  }, [loading, ok, allowAppUser, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(205 72% 88%)" }}>
        <div className="w-8 h-8 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!ok) return null;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/buy-credits" component={BuyCreditsPage} />
      <Route path="/credits-success" component={CreditsSuccessPage} />
      <Route path="/" component={HomePage} />
      <Route path="/mostra" component={() => <ProtectedRoute component={MostraPage} />} />
      <Route path="/eco" component={EcoIndex} />
      <Route path="/eco/:slug" component={EcoPagina} />
      <Route path="/galeria" component={GaleriaPage} />
      <Route path="/sonhos" component={SonhosPage} />
      <Route path="/cadastro" component={CadastroPage} />
      <Route path="/app" component={() => <ProtectedRoute component={Dashboard} allowAppUser />} />
      <Route path="/leads" component={() => <ProtectedRoute component={LeadsList} />} />
      <Route path="/leads/new" component={() => <ProtectedRoute component={NewLead} />} />
      <Route path="/leads/:id" component={() => <ProtectedRoute component={LeadDetail} />} />
      <Route path="/emails" component={() => <ProtectedRoute component={EmailsList} />} />
      <Route path="/emails/:id" component={() => <ProtectedRoute component={EmailDetail} />} />
      <Route path="/clube" component={() => <ProtectedRoute component={ClubePage} />} />
      <Route path="/clube/register" component={() => <ProtectedRoute component={ClubeRegister} />} />
      <Route path="/clube/:id" component={() => <ProtectedRoute component={ClubeChat} />} />
      <Route path="/oraculo" component={() => <ProtectedRoute component={OraculoPage} />} />
      <Route path="/ecossistema" component={() => <ProtectedRoute component={EcossistemaPage} />} />
      <Route path="/playground" component={() => <ProtectedRoute component={PlaygroundPage} />} />
      <Route path="/arvore-code" component={() => <ProtectedRoute component={ArvoreCodePage} />} />
      <Route path="/arvore-workspace" component={() => <ProtectedRoute component={ArvoreWorkspacePage} />} />
      <Route path="/skins" component={() => <ProtectedRoute component={SkinsPage} />} />
      <Route path="/custos" component={() => <ProtectedRoute component={CustosPage} />} />
      <Route path="/mapa" component={() => <ProtectedRoute component={MapaPage} />} />
      <Route path="/epret" component={() => <ProtectedRoute component={EpretPage} />} />
      <Route path="/pap" component={() => <ProtectedRoute component={PapPage} />} />
      <Route path="/assembleia" component={() => <ProtectedRoute component={AssembleiaPage} />} />
      <Route path="/assembleia/historico" component={() => <ProtectedRoute component={AssembleiaHistorico} />} />
      <Route path="/assembleia/:id" component={() => <ProtectedRoute component={AssembleiaSession} />} />
      <Route path="/agora/historico" component={() => <ProtectedRoute component={AgoraHistorico} />} />
      <Route path="/agora/:id" component={() => <ProtectedRoute component={AgoraSession} />} />
      <Route path="/jornal" component={() => <ProtectedRoute component={JornalPage} />} />
      <Route path="/vozes" component={() => <ProtectedRoute component={VozesPage} />} />
      <Route path="/etica" component={() => <ProtectedRoute component={EticaPage} />} />
      <Route path="/conta/senha" component={() => <ProtectedRoute component={ContaSenhaPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <EasterEggs />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
