import { useGetDashboard, useGetDashboardActivity, useGetSettings, useGetRecoveryStats, RecoveryStats, DentalSettings, useGetWhatsappStatus, useGetConversationQuota } from "@workspace/api-client-react";
import { useSimulator } from "@/contexts/simulator-context";
import { isBasicPlan } from "@/lib/plan-features";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioCountdownWidget } from "@/components/audio-countdown-widget";
import { UnconfirmedAlertCard } from "@/components/unconfirmed-alert-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import {
  CalendarDays,
  Users,
  Target,
  DollarSign,
  Clock,
  Flame,
  Thermometer,
  Snowflake,
  Activity,
  ArrowUpRight,
  Sparkles,
  Zap,
  Brain,
  ShieldCheck,
  HelpCircle,
  TrendingUp,
  MessageSquare,
  CheckCircle2,
  XCircle,
  UserX,
  UserCheck,
  Cake,
  AlertCircle,
  PartyPopper,
  CalendarX,
  WifiOff,
  ArrowRight,
  LockKeyhole,
} from "lucide-react";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  gradient,
  iconBg,
  iconColor,
  index,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  gradient: string;
  iconBg: string;
  iconColor: string;
  index: number;
}) {
  return (
    <div
      className={`premium-card-glow rounded-2xl p-5 md:p-6 ${gradient} group cursor-default border`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg} transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg`}>
          <Icon className={`w-5 h-5 ${iconColor} transition-transform duration-500 group-hover:scale-110`} />
        </div>
        {subtitle && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/10">
            <ArrowUpRight className="w-2.5 h-2.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{subtitle}</span>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-[28px] md:text-[34px] font-extrabold tracking-tighter number-display leading-none">{value}</p>
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.12em]">{title}</p>
      </div>
    </div>
  );
}

function UpcomingAppointments({ appointments, onStatusChange }: { appointments: Array<{ id: number; patientName?: string; startsAt: string; status: string; procedureName?: string }>; onStatusChange?: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState<Record<number, boolean>>({});

  async function markStatus(id: number, status: "completed" | "no_show") {
    setPending((p) => ({ ...p, [id]: true }));
    try {
      const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${basePath}/api/dental/appointments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar");
      toast({ title: status === "completed" ? "Consulta marcada como realizada" : "Falta registrada" });
      onStatusChange?.();
    } catch {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  if (!appointments?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
          <CalendarDays className="w-7 h-7 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground/60">Nenhuma consulta hoje</p>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-2">
      {appointments.map((apt, i) => {
        const isPast = new Date(apt.startsAt) < now;
        const isDone = apt.status === "completed" || apt.status === "no_show";
        const isLoading = pending[apt.id];

        return (
          <div
            key={apt.id || i}
            className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/60 transition-all duration-300 group border border-transparent hover:border-border/50"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:shadow-sm ${
              apt.status === "completed" ? "bg-emerald-500/10" : apt.status === "no_show" ? "bg-red-500/10" : "premium-icon-box"
            }`}>
              {apt.status === "completed" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : apt.status === "no_show" ? (
                <XCircle className="w-4 h-4 text-red-500" />
              ) : (
                <Clock className="w-4 h-4 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold truncate">{apt.patientName}</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-medium">{apt.procedureName}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isPast && !isDone ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => markStatus(apt.id, "completed")}
                    disabled={isLoading}
                    className="flex items-center gap-1 h-7 px-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold transition-all duration-200 disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Realizado
                  </button>
                  <button
                    onClick={() => markStatus(apt.id, "no_show")}
                    disabled={isLoading}
                    className="flex items-center gap-1 h-7 px-2 rounded-lg bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 text-red-600 dark:text-red-400 text-[11px] font-semibold transition-all duration-200 disabled:opacity-40"
                  >
                    <XCircle className="w-3 h-3" />
                    Falta
                  </button>
                </div>
              ) : (
                <div className="text-right">
                  <p className="text-[14px] font-bold tabular-nums tracking-tight">
                    {new Date(apt.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <Badge variant="outline" className={`text-[9px] h-[18px] mt-1 rounded-md font-bold px-1.5 ${
                    apt.status === "completed" ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" :
                    apt.status === "no_show" ? "border-red-500/30 text-red-600 dark:text-red-400" : ""
                  }`}>
                    {apt.status === "scheduled" ? "Agendado" : apt.status === "confirmed" ? "Confirmado" : apt.status === "completed" ? "Realizado" : apt.status === "no_show" ? "Falta" : apt.status}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadTemperature({ leads }: { leads: { hot: number; warm: number; cold: number } }) {
  const items = [
    { label: "Quentes", value: leads?.hot || 0, icon: Flame, gradient: "from-red-500/12 via-orange-500/6 to-transparent", color: "text-red-500", border: "border-red-500/15", iconBg: "bg-red-500/12 shadow-red-500/10" },
    { label: "Mornos", value: leads?.warm || 0, icon: Thermometer, gradient: "from-amber-500/12 via-yellow-500/6 to-transparent", color: "text-amber-500", border: "border-amber-500/15", iconBg: "bg-amber-500/12 shadow-amber-500/10" },
    { label: "Frios", value: leads?.cold || 0, icon: Snowflake, gradient: "from-blue-500/12 via-cyan-500/6 to-transparent", color: "text-blue-500", border: "border-blue-500/15", iconBg: "bg-blue-500/12 shadow-blue-500/10" },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={`relative flex flex-col items-center p-4 rounded-xl bg-gradient-to-br ${item.gradient} border ${item.border} transition-all duration-300 hover:scale-[1.04] hover:shadow-lg group overflow-hidden`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.iconBg} mb-2.5 transition-all duration-300 group-hover:scale-110 group-hover:shadow-md shadow-sm`}>
            <item.icon className={`w-4.5 h-4.5 ${item.color}`} />
          </div>
          <p className="text-[26px] font-extrabold tracking-tighter number-display leading-none">{item.value}</p>
          <p className="text-[10px] font-bold text-muted-foreground/60 mt-1 uppercase tracking-wider">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

interface AiLearningStats {
  memories: number;
  objections: number;
  knowledge: number;
  analyticsEntries: number;
  topStrategies: Array<{ strategy: string; conversionRate: number; totalUses: number }>;
  topObjections: Array<{ category: string; objection: string; counterArgument: string; successRate: number; frequency: number }>;
  topFaqs: Array<{ question: string; answer: string; category: string; frequency: number }>;
  maturity: { level: string; percent: number; totalDataPoints: number };
}

function AiIntelligenceSection({ stats }: { stats: AiLearningStats }) {
  const pct = stats.maturity.percent;

  const maturityColor =
    pct >= 80 ? "text-emerald-500" :
    pct >= 60 ? "text-cyan-500" :
    pct >= 35 ? "text-blue-500" :
    pct >= 10 ? "text-amber-500" : "text-muted-foreground";

  const maturityBarColor =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 60 ? "bg-cyan-500" :
    pct >= 35 ? "bg-blue-500" :
    pct >= 10 ? "bg-amber-500" : "bg-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-extrabold ${maturityColor}`}>{stats.maturity.level}</span>
        <span className="text-[11px] font-bold text-muted-foreground/60">{pct}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
        <div className={`h-full rounded-full ${maturityBarColor} transition-all duration-700`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      <div className="grid grid-cols-4 gap-2 pt-1">
        {[
          { label: "Memorias", value: stats.memories, color: "text-blue-500" },
          { label: "Objecoes", value: stats.objections, color: "text-amber-500" },
          { label: "FAQs", value: stats.knowledge, color: "text-emerald-500" },
          { label: "Estrategias", value: stats.analyticsEntries, color: "text-violet-500" },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <p className={`text-[15px] font-extrabold tracking-tight ${item.color}`}>{item.value}</p>
            <p className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-wider">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentActivity({ activities }: { activities: Array<{ id: number; type: string; description: string; createdAt: string }> }) {
  if (!activities?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
          <Activity className="w-7 h-7 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground/60">Nenhuma atividade recente</p>
      </div>
    );
  }

  const typeConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
    ai_reply: { label: "IA", color: "text-primary", bg: "bg-primary/10", icon: Zap },
    lead_converted: { label: "Convertido", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", icon: ArrowUpRight },
    lead_auto_created: { label: "Novo lead", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", icon: Target },
    remarketing_sent: { label: "Remarketing", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10", icon: Activity },
    lead_temperature_change: { label: "Temp.", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", icon: Thermometer },
    ai_strategy: { label: "Estrategia", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", icon: Sparkles },
    birthday_greeting_sent: { label: "Aniversario", color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-500/10", icon: Cake },
  };

  return (
    <div className="space-y-0.5">
      {activities.slice(0, 8).map((act) => {
        const config = typeConfig[act.type] || { label: act.type, color: "text-muted-foreground", bg: "bg-muted", icon: Activity };
        const IconComp = config.icon;
        return (
          <div key={act.id} className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-muted/40 transition-all duration-200 group">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg} transition-transform duration-300 group-hover:scale-110`}>
              <IconComp className={`w-3.5 h-3.5 ${config.color}`} />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-[11px] font-medium truncate leading-snug text-foreground/80">{act.description}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color}`}>{config.label}</span>
                <span className="text-[9px] text-muted-foreground/40">&#183;</span>
                <span className="text-[9px] text-muted-foreground/50 font-medium tabular-nums">
                  {new Date(act.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getGreeting(): { text: string; icon: string } {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return { text: "Bom dia", icon: "☀️" };
  if (hour >= 12 && hour < 18) return { text: "Boa tarde", icon: "🌤️" };
  return { text: "Boa noite", icon: "🌙" };
}

interface NoticeItem {
  id: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  text: string;
}

function buildNotices(data: {
  appointmentsToday: number;
  leads: { hot: number; warm: number; cold: number };
  birthdayGreetingsThisMonth: number;
  upcomingToday: Array<{ status: string }>;
}): NoticeItem[] {
  const notices: NoticeItem[] = [];

  const pendingConfirmation = (data.upcomingToday || []).filter(
    (a) => a.status === "scheduled"
  ).length;

  if (data.birthdayGreetingsThisMonth > 0) {
    notices.push({
      id: "birthdays",
      icon: PartyPopper,
      color: "text-pink-500",
      bg: "bg-pink-500/10",
      border: "border-pink-500/20",
      text: `${data.birthdayGreetingsThisMonth} aniversariante${data.birthdayGreetingsThisMonth > 1 ? "s" : ""} a parabenizar este mês`,
    });
  }

  if (pendingConfirmation > 0) {
    notices.push({
      id: "pending",
      icon: AlertCircle,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      text: `${pendingConfirmation} consulta${pendingConfirmation > 1 ? "s" : ""} aguardando confirmação`,
    });
  }

  if (data.leads?.hot > 0) {
    notices.push({
      id: "hot-leads",
      icon: Flame,
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      text: `${data.leads.hot} lead${data.leads.hot > 1 ? "s" : ""} quente${data.leads.hot > 1 ? "s" : ""} precisando de contato`,
    });
  }

  if (data.appointmentsToday === 0) {
    notices.push({
      id: "free-day",
      icon: CalendarX,
      color: "text-muted-foreground/60",
      bg: "bg-muted/40",
      border: "border-border/30",
      text: "Agenda livre hoje — nenhuma consulta marcada",
    });
  }

  return notices.slice(0, 4);
}

function NoticePanel({ data }: {
  data: {
    appointmentsToday: number;
    leads: { hot: number; warm: number; cold: number };
    birthdayGreetingsThisMonth: number;
    upcomingToday: Array<{ status: string }>;
  } | undefined;
}) {
  if (!data) return null;
  const notices = buildNotices({
    appointmentsToday: data.appointmentsToday ?? 0,
    leads: data.leads ?? { hot: 0, warm: 0, cold: 0 },
    birthdayGreetingsThisMonth: data.birthdayGreetingsThisMonth ?? 0,
    upcomingToday: data.upcomingToday ?? [],
  });

  return (
    <div className="flex-shrink-0 w-full md:w-auto md:min-w-[220px] md:max-w-[300px]">
      <div className="rounded-2xl border border-border/30 bg-muted/20 backdrop-blur-sm p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-primary/70" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
            Avisos do dia
          </span>
        </div>

        {notices.length === 0 ? (
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 flex-shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <span className="text-[12px] font-medium text-muted-foreground/70">Tudo certo por hoje</span>
          </div>
        ) : (
          notices.map((notice) => {
            const Icon = notice.icon;
            return (
              <div
                key={notice.id}
                className={`flex items-center gap-2.5 px-2 py-2 rounded-xl border ${notice.border} ${notice.bg}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${notice.bg} flex-shrink-0`}>
                  <Icon className={`w-3.5 h-3.5 ${notice.color}`} />
                </div>
                <span className={`text-[11px] font-semibold leading-snug ${notice.color}`}>
                  {notice.text}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConversationQuotaDashboardWidget({
  used, limit, remaining, percentUsed, isExhausted, onRecharge,
}: {
  used: number; limit: number; remaining: number; percentUsed: number;
  isExhausted: boolean; onRecharge: () => void;
}) {
  const isWarning = percentUsed >= 80 && !isExhausted;
  const barColor = isExhausted ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground">Conversas de IA</p>
            <p className="text-[10px] text-muted-foreground/60">Cota mensal</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[22px] font-extrabold tracking-tighter number-display leading-none ${isExhausted ? "text-red-500" : isWarning ? "text-amber-500" : ""}`}>
            {remaining}
          </p>
          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mt-0.5">
            restantes
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.max(2, Math.min(100, percentUsed))}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground/50">{percentUsed}% utilizadas</p>
          <p className="text-[10px] text-muted-foreground/50 tabular-nums">{used} de {limit}</p>
        </div>
      </div>
      {(isWarning || isExhausted) && (
        <button
          onClick={onRecharge}
          className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isExhausted ? "text-red-500 hover:text-red-600" : "text-amber-500 hover:text-amber-600"}`}
        >
          {isExhausted ? "Recarregar agora →" : "Comprar mais conversas →"}
        </button>
      )}
    </div>
  );
}

function WhatsappDisconnectBanner() {
  const [, navigate] = useLocation();
  const { data: whatsappStatus } = useGetWhatsappStatus({
    query: { refetchInterval: 120_000 },
  });
  if (whatsappStatus?.connected !== false) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
        <WifiOff className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold leading-snug">WhatsApp desconectado — a IA não está respondendo</p>
        <p className="text-[11px] font-medium opacity-75 mt-0.5">Reconecte para retomar o atendimento automático</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="flex-shrink-0 border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/60 text-[12px] h-8 px-3 gap-1.5"
        onClick={() => navigate("/settings?tab=whatsapp")}
      >
        Reconectar
        <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export default function DashboardPage() {
  const { data: dashboard, isLoading, isError } = useGetDashboard();
  const { data: activities } = useGetDashboardActivity({ limit: 10 });
  const { data: settings, isLoading: settingsLoading } = useGetSettings();
  const { data: recoveryStats } = useGetRecoveryStats<RecoveryStats>({ period: "30d" });
  const { data: convQuotaRaw } = useGetConversationQuota();
  const [, navigate] = useLocation();
  const { activePlan } = useSimulator();
  const isBasic = isBasicPlan(activePlan);
  const clinicName = (settings as DentalSettings | undefined)?.clinicName || "Minha Clínica";
  const greeting = getGreeting();

  const { data: aiStats } = useQuery<AiLearningStats>({
    queryKey: ["ai-learning-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dental/ai-learning/stats");
      if (!res.ok) throw new Error("Failed to fetch AI learning stats");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const qc = useQueryClient();

  if (isLoading) {
    return (
      <div className="p-5 md:p-8 space-y-6">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[320px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-5 md:p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
          <HelpCircle className="w-8 h-8 text-red-500/70" />
        </div>
        <h2 className="text-lg font-bold mb-2">Nao foi possivel carregar o dashboard</h2>
        <p className="text-sm text-muted-foreground max-w-xs">Tente recarregar a pagina. Se o problema persistir, entre em contato com o suporte.</p>
      </div>
    );
  }

  const data = dashboard as unknown as {
    appointmentsToday: number; appointmentsThisWeek: number; appointmentsThisMonth: number;
    totalPatients: number; leads: { hot: number; warm: number; cold: number };
    revenueThisMonth: number; noShowThisMonth: number; rescheduledThisMonth: number;
    birthdayGreetingsThisMonth: number; expensesThisMonth: number;
    upcomingToday: Array<{ id: number; patientName?: string; startsAt: string; status: string; procedureName?: string }>;
  };

  const convQuota = convQuotaRaw as {
    monthlyConversationsUsed?: number;
    monthlyLimit?: number;
    monthlyRemaining?: number;
    percentUsed?: number;
    isExhausted?: boolean;
  } | undefined;
  const convPercentUsed = convQuota?.percentUsed ?? 0;
  const convIsExhausted = convQuota?.isExhausted ?? false;
  const convIsWarning = convPercentUsed >= 80 && !convIsExhausted;
  const convUsed = convQuota?.monthlyConversationsUsed ?? 0;
  const convLimit = convQuota?.monthlyLimit ?? 0;
  const convRemaining = convQuota?.monthlyRemaining ?? 0;

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      <WhatsappDisconnectBanner />
      <UnconfirmedAlertCard />
      {(convIsWarning || convIsExhausted) && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border animate-in slide-in-from-top-2 duration-300 ${
          convIsExhausted
            ? "bg-red-500/10 border-red-500/30"
            : "bg-amber-500/10 border-amber-500/30"
        }`}>
          <AlertCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${convIsExhausted ? "text-red-500" : "text-amber-500"}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${convIsExhausted ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {convIsExhausted
                ? "Conversas de IA esgotadas — atendimento automático pausado"
                : `Você usou ${convPercentUsed}% das conversas de IA este mês (${convUsed} de ${convLimit})`}
            </p>
            <p className={`text-xs mt-0.5 ${convIsExhausted ? "text-red-500/80" : "text-amber-500/80"}`}>
              {convIsExhausted
                ? "Novos pacientes estão recebendo a mensagem de encaminhamento para atendimento humano."
                : `Restam ${convRemaining} conversas. Recarregue para não interromper o atendimento automático.`}
            </p>
          </div>
          <button
            onClick={() => navigate("/subscription")}
            className={`text-xs font-bold underline underline-offset-2 flex-shrink-0 transition-colors ${
              convIsExhausted ? "text-red-500 hover:text-red-600" : "text-amber-500 hover:text-amber-600"
            }`}
          >
            Recarregar →
          </button>
        </div>
      )}
      <div className="animate-in fade-in slide-in-from-top-2 duration-500">
        <div className="flex flex-col md:flex-row md:items-start gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/15 text-[10px] font-bold uppercase tracking-widest text-primary/70">
                <Sparkles className="w-3 h-3" />
                Dashboard
              </span>
            </div>
            {settingsLoading ? (
              <Skeleton className="h-9 w-64 rounded-xl mb-1.5" />
            ) : (
              <h1 className="text-3xl md:text-[38px] font-extrabold tracking-tight gradient-text-warm leading-tight truncate">
                {clinicName}
              </h1>
            )}
            <p className="text-[13px] text-muted-foreground/60 font-medium mt-1 flex items-center gap-1.5">
              <span className="text-base leading-none">{greeting.icon}</span>
              <span>{greeting.text}, bem-vindo ao seu painel</span>
            </p>
          </div>
          <NoticePanel data={data} />
        </div>
        <div className="h-px w-full bg-gradient-to-r from-primary/20 via-primary/8 to-transparent rounded-full" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title="Consultas Hoje"
          value={data?.appointmentsToday || 0}
          subtitle={`${data?.appointmentsThisWeek || 0} esta semana`}
          icon={CalendarDays}
          gradient="stat-gradient-1"
          iconBg="bg-primary/10 ring-1 ring-primary/10"
          iconColor="text-primary"
          index={0}
        />
        <StatCard
          title="Total Pacientes"
          value={data?.totalPatients || 0}
          icon={Users}
          gradient="stat-gradient-2"
          iconBg="bg-blue-500/10 ring-1 ring-blue-500/10"
          iconColor="text-blue-600 dark:text-blue-400"
          index={1}
        />
        <StatCard
          title="Leads Ativos"
          value={(data?.leads?.hot || 0) + (data?.leads?.warm || 0) + (data?.leads?.cold || 0)}
          subtitle={`${data?.leads?.hot || 0} quentes`}
          icon={Target}
          gradient="stat-gradient-3"
          iconBg="bg-orange-500/10 ring-1 ring-orange-500/10"
          iconColor="text-orange-600 dark:text-orange-400"
          index={2}
        />
        <StatCard
          title="Receita Mensal"
          value={`R$ ${(data?.revenueThisMonth || 0).toLocaleString("pt-BR")}`}
          subtitle={`Despesas: R$ ${(data?.expensesThisMonth || 0).toLocaleString("pt-BR")} | Saldo: R$ ${((data?.revenueThisMonth || 0) - (data?.expensesThisMonth || 0)).toLocaleString("pt-BR")}`}
          icon={DollarSign}
          gradient="stat-gradient-4"
          iconBg="bg-emerald-500/10 ring-1 ring-emerald-500/10"
          iconColor="text-emerald-600 dark:text-emerald-400"
          index={3}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="premium-card-glow rounded-2xl p-5 md:p-6 stat-gradient-1 group cursor-default border border-red-500/15 bg-gradient-to-br from-red-500/5 to-transparent">
          <div className="flex items-start justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-red-500/10 ring-1 ring-red-500/15">
              <UserX className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/10">
              <ArrowUpRight className="w-2.5 h-2.5 text-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{data?.rescheduledThisMonth ?? 0} reagendadas</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[28px] md:text-[34px] font-extrabold tracking-tighter number-display leading-none">{data?.noShowThisMonth ?? 0}</p>
            <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.12em]">Faltas este mes</p>
          </div>
        </div>
        <div className="premium-card-glow rounded-2xl p-5 md:p-6 stat-gradient-1 group cursor-default border border-border/30 bg-gradient-to-br from-primary/5 to-transparent">
          <div className="flex items-start justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary/10 ring-1 ring-primary/10">
              <CalendarDays className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[28px] md:text-[34px] font-extrabold tracking-tighter number-display leading-none">{data?.appointmentsThisMonth ?? 0}</p>
            <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.12em]">Consultas este mes</p>
          </div>
        </div>
        <div className="premium-card-glow rounded-2xl p-5 md:p-6 stat-gradient-1 group cursor-default border border-emerald-500/15 bg-gradient-to-br from-emerald-500/5 to-transparent">
          <div className="flex items-start justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/10 ring-1 ring-emerald-500/15">
              <UserCheck className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/10">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{recoveryStats?.totalSent ?? 0} enviadas</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[28px] md:text-[34px] font-extrabold tracking-tighter number-display leading-none">{recoveryStats?.totalConverted ?? 0}</p>
            <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.12em]">Recuperados este mes</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30">
          <CardContent className="px-5 py-5">
            <AudioCountdownWidget />
          </CardContent>
        </Card>
        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30">
          <CardContent className="px-5 py-5">
            <ConversationQuotaDashboardWidget
              used={convUsed}
              limit={convLimit}
              remaining={convRemaining}
              percentUsed={convPercentUsed}
              isExhausted={convIsExhausted}
              onRecharge={() => navigate("/subscription")}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30 relative">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500/12 to-orange-500/6 flex items-center justify-center">
                  <Target className="w-3.5 h-3.5 text-red-500" />
                </div>
                <CardTitle className="text-[13px] font-bold tracking-tight">Funil de Leads</CardTitle>
              </div>
              <Badge className="premium-badge text-[9px] rounded-md h-5 px-2 border-0">
                {(data?.leads?.hot || 0) + (data?.leads?.warm || 0) + (data?.leads?.cold || 0)} total
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <LeadTemperature leads={data?.leads || { hot: 0, warm: 0, cold: 0 }} />
          </CardContent>
          {isBasic && (
            <Link
              href="/subscription"
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 cursor-pointer group transition-all duration-200 bg-background/80 backdrop-blur-[2px] hover:bg-background/85 rounded-2xl no-underline"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                <LockKeyhole className="w-[18px] h-[18px] text-amber-400" />
              </div>
              <p className="text-[12px] font-bold text-foreground/80">CRM de Leads</p>
              <p className="text-[10px] text-muted-foreground text-center px-6">Disponível nos planos Essencial e Pro</p>
              <span className="text-[10px] font-semibold text-amber-400 flex items-center gap-1 mt-0.5">
                Fazer upgrade <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          )}
        </Card>

        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/12 to-emerald-500/6 flex items-center justify-center">
                  <CalendarDays className="w-3.5 h-3.5 text-primary" />
                </div>
                <CardTitle className="text-[13px] font-bold tracking-tight">Consultas de Hoje</CardTitle>
              </div>
              <Badge className="premium-badge text-[9px] rounded-md h-5 px-2 border-0">
                {data?.appointmentsToday || 0} consultas
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <UpcomingAppointments appointments={data?.upcomingToday || []} onStatusChange={() => qc.invalidateQueries({ queryKey: ["/api/dental/dashboard"] })} />
          </CardContent>
        </Card>

        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/12 to-purple-500/6 flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <CardTitle className="text-[13px] font-bold tracking-tight">Atividade Recente</CardTitle>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/8 border border-primary/10">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-soft" />
                <span className="text-[9px] font-bold text-primary uppercase tracking-wider">Ao vivo</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <RecentActivity activities={(activities as Array<{ id: number; type: string; description: string; createdAt: string }>) || []} />
          </CardContent>
        </Card>
      </div>

      {aiStats && (
        <Card className="premium-card-shine rounded-2xl overflow-hidden border border-border/30">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/15 to-purple-500/8 flex items-center justify-center">
                  <Brain className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <CardTitle className="text-[13px] font-bold tracking-tight">Inteligencia da IA</CardTitle>
              </div>
              <Badge className="premium-badge text-[9px] rounded-md h-5 px-2 border-0">
                Auto-aprendizado
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <AiIntelligenceSection stats={aiStats} />
            <p className="text-[10px] text-muted-foreground/35 mt-4 italic leading-relaxed">
              ⓘ Os índices de maturidade e taxas de sucesso são estimativas baseadas nos dados coletados. A IA é uma ferramenta de apoio e pode cometer erros.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
