import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  MessageSquare,
  Megaphone,
  Cake,
  RefreshCw,
  CalendarCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Info,
  Ban,
  TrendingUp,
  PauseCircle,
} from "lucide-react";

const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface RiskMetrics {
  dailyLimit: number;
  totals: {
    today: number;
    last7Days: number;
    last30Days: number;
  };
  byType: {
    remarketing: { today: number; last7Days: number; last30Days: number };
    followup: { today: number; last7Days: number; last30Days: number };
    birthday: { today: number; last7Days: number; last30Days: number };
    recovery: { today: number; last7Days: number; last30Days: number };
  };
}

interface PauseStatus {
  automationsPaused: boolean;
  remarketingPaused: boolean;
  followupPaused: boolean;
  birthdayPaused: boolean;
  recoveryPaused: boolean;
}

function useRiskMetrics() {
  return useQuery<RiskMetrics>({
    queryKey: ["risk-control-metrics"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/dental/risk-control/metrics`);
      if (!res.ok) throw new Error("Erro ao buscar métricas");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

function usePauseStatus() {
  return useQuery<PauseStatus>({
    queryKey: ["risk-control-pause-status"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/dental/risk-control/pause-status`);
      if (!res.ok) throw new Error("Erro ao buscar status de pausa");
      return res.json();
    },
  });
}

function useUpdatePauseStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (body: Partial<PauseStatus>) => {
      const res = await fetch(`${basePath}/api/dental/risk-control/pause-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Erro ao atualizar pausa");
      return res.json() as Promise<PauseStatus>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["risk-control-pause-status"], data);
    },
    onError: () => {
      toast({ title: "Erro ao atualizar configuração", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["risk-control-pause-status"] });
    },
  });
}

function VolumeLevel({ today, limit }: { today: number; limit: number }) {
  const pct = Math.min((today / limit) * 100, 100);
  const isAlert = pct >= 80;
  const isCritical = pct >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground font-medium">Volume hoje</span>
        <span
          className={`font-bold ${
            isCritical
              ? "text-red-500"
              : isAlert
              ? "text-amber-500"
              : "text-emerald-500"
          }`}
        >
          {today}/{limit}
        </span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isCritical
              ? "bg-red-500"
              : isAlert
              ? "bg-amber-500"
              : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        {isCritical ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[11px] font-semibold text-red-500">
              Limite diário atingido — risco de banimento
            </span>
          </>
        ) : isAlert ? (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-semibold text-amber-500">
              Volume alto — considere pausar temporariamente
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-medium text-muted-foreground">
              Volume normal
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  today,
  last7,
  last30,
  icon: Icon,
  iconBg,
  iconColor,
}: {
  label: string;
  today: number;
  last7: number;
  last30: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/30">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}
      >
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground/80 mb-2">{label}</p>
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-[20px] font-extrabold leading-none tracking-tight">{today}</p>
            <p className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider mt-0.5">hoje</p>
          </div>
          <div className="text-center">
            <p className="text-[20px] font-extrabold leading-none tracking-tight text-muted-foreground">{last7}</p>
            <p className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider mt-0.5">7 dias</p>
          </div>
          <div className="text-center">
            <p className="text-[20px] font-extrabold leading-none tracking-tight text-muted-foreground">{last30}</p>
            <p className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider mt-0.5">30 dias</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PauseSwitch({
  label,
  description,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border/20 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        disabled={disabled}
        className={checked ? "data-[state=checked]:bg-amber-500" : ""}
      />
    </div>
  );
}

export default function RiskControlPage() {
  const { data: metrics, isLoading: metricsLoading } = useRiskMetrics();
  const { data: pause, isLoading: pauseLoading } = usePauseStatus();
  const updatePause = useUpdatePauseStatus();
  const { toast } = useToast();
  const [optimisticPause, setOptimisticPause] = useState<PauseStatus | null>(null);

  const currentPause = optimisticPause ?? pause;
  const isLoading = metricsLoading || pauseLoading;

  async function toggle(field: keyof PauseStatus, value: boolean) {
    const next = { ...(currentPause ?? {}), [field]: value } as PauseStatus;

    if (field === "automationsPaused" && value) {
      next.remarketingPaused = false;
      next.followupPaused = false;
      next.birthdayPaused = false;
      next.recoveryPaused = false;
    }

    setOptimisticPause(next);

    const patch: Partial<PauseStatus> = { [field]: value };
    if (field === "automationsPaused" && value) {
      Object.assign(patch, {
        remarketingPaused: false,
        followupPaused: false,
        birthdayPaused: false,
        recoveryPaused: false,
      });
    }

    try {
      await updatePause.mutateAsync(patch);
      toast({
        title: value
          ? field === "automationsPaused"
            ? "Todas as automações pausadas"
            : "Automação pausada"
          : field === "automationsPaused"
          ? "Automações reativadas"
          : "Automação reativada",
      });
    } finally {
      setOptimisticPause(null);
    }
  }

  const globalPaused = currentPause?.automationsPaused ?? false;
  const todayTotal = metrics?.totals.today ?? 0;
  const dailyLimit = metrics?.dailyLimit ?? 80;

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-500" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Controle de Risco</h1>
          </div>
          <p className="text-[13px] text-muted-foreground/70 ml-11">
            Monitore o volume de mensagens automáticas e pause automações para proteger seu número.
          </p>
        </div>
        {globalPaused && (
          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25 font-bold text-[11px] flex-shrink-0">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Automações pausadas
          </Badge>
        )}
      </div>

      {/* Educational banner — always visible */}
      <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-[13px] font-bold text-blue-600 dark:text-blue-400">Por que essa página existe?</p>
        </div>
        <div className="px-4 pb-4">
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
            O OdontoFlow envia mensagens automáticas pelo WhatsApp em seu nome — lembretes, follow-ups,
            aniversários e campanhas de reativação. Isso é ótimo para o seu consultório, mas o
            <strong className="text-foreground"> WhatsApp (Meta) monitora o volume de mensagens</strong> enviadas
            por cada número. Se detectar muitas mensagens em pouco tempo, pode bloquear ou banir
            o seu número permanentemente, sem aviso prévio.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex gap-2.5 p-3 rounded-xl bg-red-500/8 border border-red-500/15">
              <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Ban className="w-3.5 h-3.5 text-red-500" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mb-0.5">Risco de banimento</p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Muitos envios seguidos podem fazer o WhatsApp bloquear seu número por dias ou para sempre.
                </p>
              </div>
            </div>

            <div className="flex gap-2.5 p-3 rounded-xl bg-amber-500/8 border border-amber-500/15">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mb-0.5">Monitore o volume</p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Acompanhe quantas mensagens foram enviadas hoje e nos últimos dias. Fique atento ao medidor.
                </p>
              </div>
            </div>

            <div className="flex gap-2.5 p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/15">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <PauseCircle className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-0.5">Pause quando precisar</p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Se o medidor ficar vermelho, pause as automações por algumas horas ou até o dia seguinte.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[120px] rounded-2xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[100px] rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <Card className="rounded-2xl border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-bold flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Visão Geral
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Hoje", value: metrics?.totals.today ?? 0 },
                  { label: "Últimos 7 dias", value: metrics?.totals.last7Days ?? 0 },
                  { label: "Últimos 30 dias", value: metrics?.totals.last30Days ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="text-center p-4 rounded-xl bg-muted/30 border border-border/20">
                    <p className="text-[28px] font-extrabold tracking-tight leading-none">{item.value}</p>
                    <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider mt-1.5">{item.label}</p>
                  </div>
                ))}
              </div>

              <VolumeLevel today={todayTotal} limit={dailyLimit} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-bold flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                Detalhamento por tipo
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MetricCard
                label="Remarketing de Leads"
                today={metrics?.byType.remarketing.today ?? 0}
                last7={metrics?.byType.remarketing.last7Days ?? 0}
                last30={metrics?.byType.remarketing.last30Days ?? 0}
                icon={Megaphone}
                iconBg="bg-purple-500/10"
                iconColor="text-purple-500"
              />
              <MetricCard
                label="Follow-up de Consulta"
                today={metrics?.byType.followup.today ?? 0}
                last7={metrics?.byType.followup.last7Days ?? 0}
                last30={metrics?.byType.followup.last30Days ?? 0}
                icon={CalendarCheck}
                iconBg="bg-blue-500/10"
                iconColor="text-blue-500"
              />
              <MetricCard
                label="Aniversário"
                today={metrics?.byType.birthday.today ?? 0}
                last7={metrics?.byType.birthday.last7Days ?? 0}
                last30={metrics?.byType.birthday.last30Days ?? 0}
                icon={Cake}
                iconBg="bg-pink-500/10"
                iconColor="text-pink-500"
              />
              <MetricCard
                label="Recuperação de Pacientes"
                today={metrics?.byType.recovery.today ?? 0}
                last7={metrics?.byType.recovery.last7Days ?? 0}
                last30={metrics?.byType.recovery.last30Days ?? 0}
                icon={RefreshCw}
                iconBg="bg-emerald-500/10"
                iconColor="text-emerald-500"
              />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-bold flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Controles de Pausa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <div className="mb-4 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-amber-600 dark:text-amber-400">Como funcionam as pausas</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                      Pausar uma automação impede novos envios a partir deste momento. Mensagens já agendadas aguardam até que você reative. Use o switch global para pausar tudo de uma vez.
                    </p>
                  </div>
                </div>
              </div>

              <PauseSwitch
                label="Pausar todas as automações"
                description="Bloqueia imediatamente todos os envios automáticos (remarketing, follow-up, aniversário e recuperação)"
                checked={globalPaused}
                onToggle={(val) => toggle("automationsPaused", val)}
                disabled={updatePause.isPending}
              />

              <div className={`pl-4 border-l-2 border-border/30 ml-2 transition-opacity duration-200 ${globalPaused ? "opacity-40 pointer-events-none" : ""}`}>
                <PauseSwitch
                  label="Remarketing de Leads"
                  description="Para o envio de mensagens de remarketing para leads frios, mornos e quentes"
                  checked={currentPause?.remarketingPaused ?? false}
                  onToggle={(val) => toggle("remarketingPaused", val)}
                  disabled={globalPaused || updatePause.isPending}
                />
                <PauseSwitch
                  label="Follow-up de Consulta"
                  description="Para os lembretes de consulta e mensagens pós-atendimento"
                  checked={currentPause?.followupPaused ?? false}
                  onToggle={(val) => toggle("followupPaused", val)}
                  disabled={globalPaused || updatePause.isPending}
                />
                <PauseSwitch
                  label="Mensagens de Aniversário"
                  description="Para o envio de felicitações automáticas no aniversário dos pacientes"
                  checked={currentPause?.birthdayPaused ?? false}
                  onToggle={(val) => toggle("birthdayPaused", val)}
                  disabled={globalPaused || updatePause.isPending}
                />
                <PauseSwitch
                  label="Recuperação de Pacientes"
                  description="Para as mensagens de reativação de pacientes inativos e no-shows"
                  checked={currentPause?.recoveryPaused ?? false}
                  onToggle={(val) => toggle("recoveryPaused", val)}
                  disabled={globalPaused || updatePause.isPending}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
