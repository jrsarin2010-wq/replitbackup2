import "@/lib/api-config";
import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import AppLayout from "@/components/layout/app-layout";
import DashboardPage from "@/pages/dashboard";
import PatientsPage from "@/pages/patients";
import AppointmentsPage from "@/pages/appointments";
import LeadsPage from "@/pages/leads";
import ConversationsPage from "@/pages/conversations";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import FinanceiroPage from "@/pages/financeiro";
import AdminPage from "@/pages/admin";
import SubscriptionPage from "@/pages/subscription";
import ProfessionalsPage from "@/pages/professionals";
import OnboardingPage from "@/pages/onboarding";
import LandingPage from "@/pages/landing";
import LgpdPage from "@/pages/lgpd";
import RecoveryPage from "@/pages/recovery";
import ResultadosPage from "@/pages/resultados";
import SimulatorPage from "@/pages/simulator";
import AiLearningPage from "@/pages/ai-learning";
import RiskControlPage from "@/pages/risk-control";
import SupportPage from "@/pages/support";
import NotFound from "@/pages/not-found";
import SupportChat from "@/components/support-chat";
import SetupWizard from "@/components/setup-wizard";
import TosAcceptanceModal from "@/components/tos-acceptance-modal";
import { isWizardDone } from "@/lib/wizard-state";
import { hasTenantId, clearAuthToken, AUTH_TOKEN_KEY } from "@/lib/api-config";
import { toast } from "@/hooks/use-toast";
import { SimulatorProvider } from "@/contexts/simulator-context";
import PlanGate from "@/components/plan-gate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function GatedLeads() {
  return <PlanGate feature="leads" featureLabel="CRM de Leads" requiredPlan="Essencial"><LeadsPage /></PlanGate>;
}
function GatedRecovery() {
  return <PlanGate feature="remarketing" featureLabel="Recuperação de Pacientes" requiredPlan="Pro"><RecoveryPage /></PlanGate>;
}
function GatedReports() {
  return <PlanGate feature="reports" featureLabel="Relatórios" requiredPlan="Pro"><ReportsPage /></PlanGate>;
}
function GatedFinanceiro() {
  return <PlanGate feature="financeiro" featureLabel="Financeiro" requiredPlan="Pro"><FinanceiroPage /></PlanGate>;
}
function GatedCalls() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center gap-4">
      <div className="w-16 h-16 rounded-full bg-violet-500/10 flex items-center justify-center mb-2">
        <span className="text-3xl">📞</span>
      </div>
      <h2 className="text-2xl font-extrabold gradient-text">Ligação IA com Voz Natural</h2>
      <p className="text-muted-foreground max-w-md">
        Esta funcionalidade está em desenvolvimento e chegará em breve como um módulo separado.
        Você será notificado assim que estiver disponível.
      </p>
      <span className="px-4 py-1.5 rounded-full bg-violet-500/10 text-violet-400 text-sm font-semibold border border-violet-500/20">
        Em breve
      </span>
    </div>
  );
}
function GatedRiskControl() {
  return <PlanGate feature="riskControl" featureLabel="Controle de Risco" requiredPlan="Essencial"><RiskControlPage /></PlanGate>;
}

function Router({ onboardingDone }: { onboardingDone: boolean }) {
  if (!onboardingDone) return null;
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/patients" component={PatientsPage} />
        <Route path="/appointments" component={AppointmentsPage} />
        <Route path="/leads" component={GatedLeads} />
        <Route path="/conversations" component={ConversationsPage} />
        <Route path="/reports" component={GatedReports} />
        <Route path="/financeiro" component={GatedFinanceiro} />
        <Route path="/subscription" component={SubscriptionPage} />
        <Route path="/professionals" component={ProfessionalsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/lgpd" component={LgpdPage} />
        <Route path="/recovery" component={GatedRecovery} />
        <Route path="/resultados" component={ResultadosPage} />
        <Route path="/calls" component={GatedCalls} />
        <Route path="/risk-control" component={GatedRiskControl} />
        <Route path="/support" component={SupportPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

type AppView = "landing" | "onboarding" | "setup" | "app";

function App() {
  const [view, setView] = useState<AppView>(() => {
    if (hasTenantId()) return "app";
    const params = new URLSearchParams(window.location.search);
    if (params.get("token")) return "onboarding";
    return "landing";
  });

  useEffect(() => {
    let handling = false;
    function onStorage(e: StorageEvent) {
      const tokenGone = e.key === null && !localStorage.getItem(AUTH_TOKEN_KEY);
      if ((!tokenGone && (e.key !== AUTH_TOKEN_KEY || e.oldValue === e.newValue)) || handling) return;
      handling = true;
      toast({
        title: "Sessão alterada em outra aba",
        description: "Sua sessão foi alterada em outra janela. Redirecionando para o login...",
        variant: "destructive",
        duration: 3000,
      });
      clearAuthToken();
      setTimeout(() => window.location.reload(), 2800);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const [initialOnboardingView, setInitialOnboardingView] = useState<
    "login" | "register" | "welcome"
  >("welcome");

  function handleOnboardingComplete() {
    setView("app");
    queryClient.clear();
  }

  function handleSetupNeeded() {
    if (isWizardDone()) {
      handleOnboardingComplete();
    } else {
      setView("setup");
    }
  }

  function handleSetupComplete() {
    handleOnboardingComplete();
  }

  function goToOnboarding(startView: "login" | "register") {
    setInitialOnboardingView(startView);
    setView("onboarding");
  }

  function goToOnboardingFree() {
    sessionStorage.setItem("pendingPlan", "trial");
    goToOnboarding("register");
  }

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <SimulatorProvider>
              <Switch>
                <Route path="/admin/panel" component={AdminPage} />
                <Route path="/admin/simulador">
                  <SimulatorPage />
                </Route>
                <Route path="/admin/aprendizado" component={AiLearningPage} />
                <Route>
                  {view === "landing" && (
                    <LandingPage
                      onLogin={() => goToOnboarding("login")}
                      onRegister={() => goToOnboarding("register")}
                      onRegisterFree={goToOnboardingFree}
                    />
                  )}
                  {view === "onboarding" && (
                    <OnboardingPage
                      onComplete={handleOnboardingComplete}
                      onSetupNeeded={handleSetupNeeded}
                      initialView={initialOnboardingView}
                      onBack={() => setView("landing")}
                    />
                  )}
                  {view === "setup" && (
                    <SetupWizard onComplete={handleSetupComplete} />
                  )}
                  {view === "app" && (
                    <>
                      <Router onboardingDone={true} />
                      <SupportChat />
                      <TosAcceptanceModal enabled={true} />
                    </>
                  )}
                </Route>
              </Switch>
            </SimulatorProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
