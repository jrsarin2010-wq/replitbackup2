import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/lib/theme";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGetSettings, useGetAudioCredits, useGetConversationQuota } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Target,
  MessageSquare,
  BarChart3,
  Wallet,
  Settings,
  Menu,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  Bell,
  ChevronRight,
  CreditCard,
  LogOut,
  Volume2,
  AlertTriangle,
  Stethoscope,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  TrendingUp,
  PhoneCall,
  FlaskConical,
  X,
  Lock,
  LifeBuoy,
} from "lucide-react";
import OdontoFlowLogo from "@/components/odonto-flow-logo";
import { clearAuthToken, getTenantPlan } from "@/lib/api-config";
import { useSimulator } from "@/contexts/simulator-context";
import { getPlanFeatures, isBasicPlan } from "@/lib/plan-features";

interface NavItemDef {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  comingSoon?: boolean;
}

const navSections: { label: string; items: NavItemDef[] }[] = [
  {
    label: "Principal",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/patients", label: "Pacientes", icon: Users },
      { path: "/appointments", label: "Agenda", icon: CalendarDays },
      { path: "/professionals", label: "Profissionais", icon: Stethoscope },
      { path: "/leads", label: "Leads", icon: Target },
      { path: "/recovery", label: "Recuperação", icon: RefreshCw },
    ],
  },
  {
    label: "Comunicação",
    items: [
      { path: "/conversations", label: "Conversas", icon: MessageSquare },
      { path: "/calls", label: "Ligações IA", icon: PhoneCall, comingSoon: true },
    ],
  },
  {
    label: "Gestão",
    items: [
      { path: "/resultados", label: "Resultados", icon: TrendingUp },
      { path: "/reports", label: "Relatórios", icon: BarChart3 },
      { path: "/financeiro", label: "Financeiro", icon: Wallet },
      { path: "/subscription", label: "Assinatura", icon: CreditCard },
      { path: "/admin/simulador", label: "Simulador de Planos", icon: FlaskConical },
      { path: "/settings", label: "Configurações", icon: Settings },
      { path: "/support", label: "Suporte", icon: LifeBuoy },
    ],
  },
];

const allNavItems = navSections.flatMap((s) => s.items);

function NavItem({
  item,
  isActive,
  isLocked,
  onNavigate,
}: {
  item: NavItemDef;
  isActive: boolean;
  isLocked?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (isLocked && !item.comingSoon) {
    return (
      <Link href="/subscription">
        <button
          onClick={onNavigate}
          title={`${item.label} — disponível no Plano Pro ou superior`}
          className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300 text-sidebar-foreground/30 hover:text-sidebar-foreground/50 hover:bg-white/[0.03] cursor-pointer"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300 bg-white/[0.03]">
            <Icon className="w-4 h-4 opacity-35" />
          </div>
          <span className="truncate flex-1 text-left opacity-50">{item.label}</span>
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 flex-shrink-0">
            <Lock className="w-2.5 h-2.5 text-violet-400/70" />
            <span className="text-[8px] font-bold text-violet-400/70 uppercase tracking-wide">Pro</span>
          </span>
        </button>
      </Link>
    );
  }

  return (
    <Link href={item.path}>
      <button
        onClick={onNavigate}
        className={`sidebar-nav-glow ${isActive ? "active" : ""} group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300 ${
          isActive
            ? "bg-gradient-to-r from-sidebar-primary/20 to-sidebar-primary/5 text-white"
            : "text-sidebar-foreground/45 hover:text-sidebar-foreground/80 hover:bg-white/[0.04]"
        }`}
      >
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300 ${
            isActive
              ? "bg-gradient-to-br from-sidebar-primary to-emerald-600 shadow-md shadow-sidebar-primary/30"
              : "bg-white/[0.04] group-hover:bg-white/[0.08] group-hover:scale-105"
          }`}
        >
          <Icon
            className={`w-4 h-4 transition-colors duration-300 ${isActive ? "text-white" : ""}`}
          />
        </div>
        <span className="truncate flex-1 text-left">{item.label}</span>
        {item.comingSoon ? (
          <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 text-white animate-pulse shadow-sm shadow-orange-500/40">
            Em Breve
          </span>
        ) : isActive ? (
          <ChevronRight className="w-3.5 h-3.5 text-sidebar-primary/60" />
        ) : null}
      </button>
    </Link>
  );
}

function ClinicBadge() {
  const { data: settings } = useGetSettings();
  const clinicName =
    (settings as { clinicName?: string | null } | undefined)?.clinicName ||
    "Minha Clínica";
  const initials = clinicName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
  const { activePlan, isSimulating } = useSimulator();
  const plan = activePlan;
  const isPlanBasic = isBasicPlan(plan);
  const planLabel = isSimulating
    ? isBasicPlan(plan) ? "Básico (Sim.)" : plan === "essencial" ? "Essencial (Sim.)" : "Pro (Sim.)"
    : isBasicPlan(plan) ? "Básico" : "Premium";
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.01] border border-white/[0.06] sidebar-shine">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sidebar-primary/25 to-sidebar-primary/8 flex items-center justify-center ring-1 ring-sidebar-primary/15 flex-shrink-0">
        <span className="text-[11px] font-bold text-sidebar-primary tracking-wide">
          {initials}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-sidebar-foreground/80 truncate">
          {clinicName}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse-soft ${isPlanBasic ? "bg-amber-400" : "bg-emerald-400"}`} />
          <p className="text-[10px] text-sidebar-foreground/35 font-medium tracking-wide">
            {planLabel}
          </p>
        </div>
      </div>
    </div>
  );
}


function getLockedPaths(plan: string | null): Set<string> {
  const features = getPlanFeatures(plan);
  const locked = new Set<string>();
  if (!features.leads) locked.add("/leads");
  if (!features.patientRecovery) locked.add("/recovery");
  if (!features.reports) locked.add("/reports");
  if (!features.financeiro) locked.add("/financeiro");
  if (!features.vapiCalls) locked.add("/calls");
  if (!features.resultados) locked.add("/resultados");
  return locked;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { activePlan } = useSimulator();
  const lockedPaths = getLockedPaths(activePlan);

  return (
    <div className="flex flex-col h-full sidebar-gradient">
      <div className="px-5 pt-5 pb-4">
        <OdontoFlowLogo
          size="lg"
          textClassName="text-white"
          subtextClassName="text-sidebar-primary/60"
        />
      </div>

      <ScrollArea className="flex-1 px-3 py-1">
        {navSections.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? "mt-5" : ""}>
            <div className="px-3 mb-2 flex items-center gap-2">
              <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-sidebar-foreground/20">
                {section.label}
              </p>
              <div className="flex-1 h-px bg-gradient-to-r from-sidebar-border/30 to-transparent" />
            </div>
            <nav className="space-y-0.5">
              {section.items.map((item) => {
                const fullPath = base + item.path;
                const isActive =
                  item.path === "/"
                    ? location === base || location === base + "/"
                    : location.startsWith(fullPath);
                const isLocked = lockedPaths.has(item.path);
                return (
                  <NavItem
                    key={item.path}
                    item={item}
                    isActive={isActive}
                    isLocked={isLocked}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </nav>
          </div>
        ))}
      </ScrollArea>

      <div className="pb-5">
        <div className="px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-sidebar-border/40 to-transparent mb-4" />
        <ClinicBadge />
        <Link href="/lgpd">
          <button
            onClick={onNavigate}
            className="mt-3 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[11px] font-normal text-sidebar-foreground/25 hover:text-sidebar-foreground/45 hover:bg-white/[0.03] transition-all duration-200"
          >
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Meus Dados</span>
          </button>
        </Link>
        <button
          onClick={() => { clearAuthToken(); window.location.reload(); }}
          className="mt-1 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[12px] font-medium text-sidebar-foreground/35 hover:text-red-400 hover:bg-red-500/[0.08] transition-all duration-200"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span>Sair da conta</span>
        </button>
        </div>
      </div>
    </div>
  );
}

function CollapsedSidebar() {
  const [location] = useLocation();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="flex flex-col h-full sidebar-gradient items-center">
      <div className="pt-6 pb-4">
        <OdontoFlowLogo size="lg" showText={false} />
      </div>
      <div className="w-8 h-px bg-gradient-to-r from-transparent via-sidebar-border/50 to-transparent mb-3" />
      <nav className="flex-1 flex flex-col items-center gap-1 px-2">
        {allNavItems.map((item) => {
          const fullPath = base + item.path;
          const isActive =
            item.path === "/"
              ? location === base || location === base + "/"
              : location.startsWith(fullPath);
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <button
                title={item.comingSoon ? `${item.label} — Em Breve` : item.label}
                className={`group relative w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 ${
                  isActive
                    ? "text-white"
                    : "text-sidebar-foreground/35 hover:text-sidebar-foreground/70 hover:bg-white/[0.04]"
                }`}
              >
                {isActive && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-sidebar-primary to-emerald-600 shadow-md shadow-sidebar-primary/25" />
                )}
                <Icon className="w-[17px] h-[17px] relative z-10" />
                {item.comingSoon && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 shadow-sm shadow-orange-500/60 animate-pulse z-20" />
                )}
              </button>
            </Link>
          );
        })}
      </nav>
      <div className="pb-5 flex flex-col items-center gap-2">
        <div className="w-8 h-px bg-gradient-to-r from-transparent via-sidebar-border/50 to-transparent" />
        <Link href="/lgpd">
          <button
            title="Meus Dados"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-sidebar-foreground/20 hover:text-sidebar-foreground/40 hover:bg-white/[0.03] transition-all duration-200"
          >
            <ShieldCheck className="w-[15px] h-[15px]" />
          </button>
        </Link>
        <button
          onClick={() => { clearAuthToken(); window.location.reload(); }}
          title="Sair da conta"
          className="w-10 h-10 flex items-center justify-center rounded-xl text-sidebar-foreground/25 hover:text-red-400 hover:bg-red-500/[0.08] transition-all duration-200"
        >
          <LogOut className="w-[17px] h-[17px]" />
        </button>
      </div>
    </div>
  );
}


function ConversationCounter() {
  const { data } = useGetConversationQuota();
  const quota = data as {
    monthlyConversationsUsed?: number;
    monthlyLimit?: number;
    monthlyRemaining?: number;
    percentUsed?: number;
    isExhausted?: boolean;
  } | undefined;

  if (!quota) return null;

  const used = quota.monthlyConversationsUsed ?? 0;
  const limit = quota.monthlyLimit ?? 400;
  const remaining = quota.monthlyRemaining ?? Math.max(0, limit - used);
  const isExhausted = quota.isExhausted ?? false;
  const percentUsed = quota.percentUsed ?? Math.min(100, Math.round((used / limit) * 100));
  const isLow = percentUsed >= 80 && !isExhausted;

  const tooltipLabel = isExhausted
    ? "Conversas de IA esgotadas — recarregue"
    : `${used} de ${limit} conversas de IA usadas este mês`;

  return (
    <Link href="/subscription">
      <button
        title={tooltipLabel}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
          isExhausted
            ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
            : isLow
              ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              : "bg-muted/60 text-muted-foreground hover:bg-muted"
        }`}
      >
        {isExhausted ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : (
          <MessageSquare className="w-3.5 h-3.5" />
        )}
        <span>{used}/{limit} conversas</span>
      </button>
    </Link>
  );
}

function CreditCounter() {
  const { data, isLoading } = useGetAudioCredits();
  const credits = data as {
    balance?: number;
    monthlyCharsUsed?: number;
    monthlyQuota?: number;
    monthlyCharsRemaining?: number;
    rechargeBalance?: number;
    totalAvailable?: number;
  } | undefined;

  if (isLoading) return null;

  const monthlyQuota = credits?.monthlyQuota ?? 20_000;
  const monthlyUsed = credits?.monthlyCharsUsed ?? 0;
  const monthlyRemaining = credits?.monthlyCharsRemaining ?? Math.max(0, monthlyQuota - monthlyUsed);
  const rechargeBalance = credits?.rechargeBalance ?? credits?.balance ?? 0;
  const totalAvailable = credits?.totalAvailable ?? (monthlyRemaining + rechargeBalance);

  const monthlyUsedMin = Math.round(monthlyUsed / 1000);
  const monthlyTotalMin = Math.round(monthlyQuota / 1000);

  const isAllEmpty = totalAvailable <= 0;
  const isMonthlyEmpty = monthlyRemaining <= 0;
  const isLow = !isAllEmpty && monthlyRemaining <= 2000 && rechargeBalance <= 0;

  const tooltipLabel = isAllEmpty
    ? "Seus minutos acabaram — recarregue"
    : `${monthlyUsedMin} de ${monthlyTotalMin} min usados este mês${rechargeBalance > 0 ? ` (+${Math.round(rechargeBalance / 1000)} min extras)` : ""}`;

  return (
    <Link href="/subscription">
      <button
        title={tooltipLabel}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
          isAllEmpty
            ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
            : isLow || isMonthlyEmpty
              ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              : "bg-muted/60 text-muted-foreground hover:bg-muted"
        }`}
      >
        {isAllEmpty ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : (
          <Volume2 className="w-3.5 h-3.5" />
        )}
        <span>{monthlyUsedMin}/{monthlyTotalMin}min</span>
      </button>
    </Link>
  );
}

function SimulationBanner() {
  const { isSimulating, simulatedPlan, stopSimulation } = useSimulator();
  if (!isSimulating) return null;
  const planNames: Record<string, string> = {
    basic: "Básico",
    essencial: "Essencial",
    pro: "Pro",
  };
  const planName = planNames[simulatedPlan ?? ""] ?? simulatedPlan;
  return (
    <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500 text-amber-950 text-[12px] font-semibold z-40">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 flex-shrink-0" />
        <span>Modo Simulação ativo — Plano {planName}</span>
      </div>
      <button
        onClick={stopSimulation}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/10 hover:bg-amber-950/20 transition-colors text-[11px] font-bold"
      >
        <X className="w-3 h-3" />
        Sair da simulação
      </button>
    </div>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {!isMobile && (
        <aside
          className={`hidden md:flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out ${
            collapsed ? "w-[72px]" : "w-[260px]"
          }`}
        >
          {collapsed ? <CollapsedSidebar /> : <SidebarContent />}
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-card/80 glass border-b border-border/40 flex items-center justify-between px-4 md:px-6 flex-shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            {isMobile ? (
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8 rounded-lg"
                  >
                    <Menu className="w-4.5 h-4.5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="p-0 w-[280px] bg-sidebar border-sidebar-border"
                >
                  <SidebarContent onNavigate={() => setOpen(false)} />
                </SheetContent>
              </Sheet>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCollapsed(!collapsed)}
                className="hidden md:flex h-8 w-8 rounded-lg hover:bg-muted/80"
              >
                {collapsed ? (
                  <PanelLeft className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <PanelLeftClose className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <ConversationCounter />
            <CreditCounter />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-muted/80 relative"
            >
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full ring-2 ring-card" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8 rounded-lg hover:bg-muted/80"
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4 text-muted-foreground" />
              ) : (
                <Sun className="w-4 h-4 text-muted-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { clearAuthToken(); window.location.reload(); }}
              title="Sair da conta"
              className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500"
            >
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
        </header>

        <SimulationBanner />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="page-enter">{children}</div>
        </main>
        <footer className="flex-shrink-0 px-4 py-2 border-t border-border/20 bg-background/50">
          <p className="text-[10px] text-muted-foreground/40 text-center leading-relaxed">
            ⓘ <em>A IA é uma ferramenta de apoio e pode cometer erros. Resultados podem variar conforme cada clínica.</em>
          </p>
        </footer>
      </div>
    </div>
  );
}
