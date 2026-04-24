import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import {
  UserCheck,
  UserX,
  Send,
  MessageSquare,
  CalendarCheck,
  Users,
  Info,
  RefreshCw,
  Target,
  TrendingUp,
  Clock,
  Zap,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface RecoveryCandidate {
  id: number;
  entityType: "patient" | "lead";
  name: string;
  phone: string;
  lastContact: string | null;
  daysInactive: number;
  status: "pendente" | "mensagem_enviada" | "respondeu" | "reagendou";
  lastRecoveryAt: string | null;
}

interface RecoveryStats {
  totalCandidates: number;
  totalSent: number;
  totalResponded: number;
  totalConverted: number;
  weeklyTrend: Array<{ week: string; sent: number; responded: number; converted: number }>;
  inactivityBuckets: { "30-60d": number; "60-90d": number; "+90d": number };
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  pendente: { label: "Pendente", color: "text-muted-foreground", bg: "bg-muted/60" },
  mensagem_enviada: { label: "Mensagem Enviada", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
  respondeu: { label: "Respondeu", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  reagendou: { label: "Reagendou", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
};

function ExplanationBlock() {
  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-emerald-500/3 to-transparent p-5 md:p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Info className="w-5 h-5 text-primary" />
        </div>
        <div className="space-y-3">
          <h2 className="text-base font-bold text-foreground">O que é Recuperação?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A <strong className="text-foreground">Recuperação</strong> reativa vínculos com pessoas que <em>já conhecem sua clínica</em> mas deixaram de aparecer.
            É diferente do Remarketing, que trabalha com leads que nunca viraram pacientes.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <Target className="w-3.5 h-3.5 text-purple-500" />
                </div>
                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Remarketing</span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Leads que <strong>nunca viraram pacientes</strong>. Objetivo: converter pela primeira vez.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Recuperação</span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Pacientes <strong>que sumiram</strong> + leads <strong>que não compareceram</strong>. Objetivo: reativar o vínculo.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, color, bg }: { title: string; value: number; icon: React.ElementType; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${bg} border-border/30 premium-card-glow`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color.replace("text-", "bg-").replace("-500", "-500/15").replace("-600", "-500/15")}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-[30px] font-extrabold tracking-tighter number-display leading-none">{value}</p>
      <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-[0.1em] mt-1.5">{title}</p>
    </div>
  );
}

function FunnelChart({ stats }: { stats: RecoveryStats }) {
  const max = Math.max(stats.totalCandidates, 1);
  const steps = [
    { label: "Candidatos", value: stats.totalCandidates, color: "bg-primary/70", width: (stats.totalCandidates / max) * 100 },
    { label: "Contatos Enviados", value: stats.totalSent, color: "bg-blue-500/70", width: (stats.totalSent / max) * 100 },
    { label: "Responderam", value: stats.totalResponded, color: "bg-amber-500/70", width: (stats.totalResponded / max) * 100 },
    { label: "Reagendaram", value: stats.totalConverted, color: "bg-emerald-500/70", width: (stats.totalConverted / max) * 100 },
  ];

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-3">
          <div className="w-[130px] text-right">
            <p className="text-[12px] font-semibold text-muted-foreground/70">{step.label}</p>
          </div>
          <div className="flex-1 h-7 bg-muted/40 rounded-lg overflow-hidden">
            <div
              className={`h-full ${step.color} rounded-lg transition-all duration-700 flex items-center justify-end pr-2`}
              style={{ width: `${Math.max(step.width, step.value > 0 ? 5 : 0)}%` }}
            >
              {step.value > 0 && <span className="text-[11px] font-bold text-white">{step.value}</span>}
            </div>
          </div>
          {i < steps.length - 1 && step.value > 0 && steps[i + 1].value > 0 && (
            <div className="text-[10px] text-muted-foreground/50 w-12 text-center">
              {Math.round((steps[i + 1].value / step.value) * 100)}%
            </div>
          )}
          {(i >= steps.length - 1 || step.value === 0 || steps[i + 1].value === 0) && (
            <div className="w-12" />
          )}
        </div>
      ))}
    </div>
  );
}

function InactivityChart({ buckets }: { buckets: { "30-60d": number; "60-90d": number; "+90d": number } }) {
  const max = Math.max(buckets["30-60d"], buckets["60-90d"], buckets["+90d"], 1);
  const items = [
    { label: "30–60 dias", value: buckets["30-60d"], color: "bg-amber-500/70" },
    { label: "60–90 dias", value: buckets["60-90d"], color: "bg-orange-500/70" },
    { label: "+90 dias", value: buckets["+90d"], color: "bg-red-500/70" },
  ];

  return (
    <div className="space-y-3 pt-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-16 text-right">
            <p className="text-[11px] font-semibold text-muted-foreground/70">{item.label}</p>
          </div>
          <div className="flex-1 h-6 bg-muted/40 rounded-lg overflow-hidden">
            <div
              className={`h-full ${item.color} rounded-lg transition-all duration-700 flex items-center justify-end pr-2`}
              style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 5 : 0)}%` }}
            >
              {item.value > 0 && <span className="text-[11px] font-bold text-white">{item.value}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WeeklyTrendChart({ trend }: { trend: Array<{ week: string; sent: number; responded: number; converted: number }> }) {
  if (!trend.length) {
    return <div className="text-center py-6 text-sm text-muted-foreground/60">Nenhum dado ainda</div>;
  }

  const maxVal = Math.max(...trend.flatMap((t) => [t.sent, t.responded, t.converted]), 1);

  return (
    <div className="space-y-2">
      {trend.slice(-6).map((t) => {
        const date = new Date(t.week + "T00:00:00");
        const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        return (
          <div key={t.week} className="flex items-center gap-2">
            <div className="w-12 text-[10px] font-medium text-muted-foreground/60 text-right">{label}</div>
            <div className="flex-1 flex gap-1 h-5">
              <div className="flex-1 bg-muted/40 rounded overflow-hidden">
                <div className="h-full bg-blue-500/60 rounded" style={{ width: `${(t.sent / maxVal) * 100}%` }} />
              </div>
              <div className="flex-1 bg-muted/40 rounded overflow-hidden">
                <div className="h-full bg-amber-500/60 rounded" style={{ width: `${(t.responded / maxVal) * 100}%` }} />
              </div>
              <div className="flex-1 bg-muted/40 rounded overflow-hidden">
                <div className="h-full bg-emerald-500/60 rounded" style={{ width: `${(t.converted / maxVal) * 100}%` }} />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground/50 w-12">{t.sent}/{t.responded}/{t.converted}</div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 pt-2 justify-center">
        {[{ color: "bg-blue-500/60", label: "Enviados" }, { color: "bg-amber-500/60", label: "Responderam" }, { color: "bg-emerald-500/60", label: "Reagendaram" }].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${l.color}`} />
            <span className="text-[10px] text-muted-foreground/60">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigPanel() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const qc = useQueryClient();
  const { toast } = useToast();

  const s = settings as Record<string, unknown> | undefined;
  const [form, setForm] = useState({
    recoveryEnabled: false,
    recoveryInactivityDays: 60,
    recoveryNoShowDays: 14,
    recoveryAiInstructions: "",
    recoveryHours: "10,15",
    recoveryDays: "1,2,3,4,5,6",
    recoveryMaxPerRun: 10,
  });
  const [initialized, setInitialized] = useState(false);

  if (s && !initialized) {
    setForm({
      recoveryEnabled: Boolean(s.recoveryEnabled),
      recoveryInactivityDays: Number(s.recoveryInactivityDays ?? 60),
      recoveryNoShowDays: Number(s.recoveryNoShowDays ?? 14),
      recoveryAiInstructions: String(s.recoveryAiInstructions ?? ""),
      recoveryHours: String(s.recoveryHours ?? "10,15"),
      recoveryDays: String(s.recoveryDays ?? "1,2,3,4,5,6"),
      recoveryMaxPerRun: Number(s.recoveryMaxPerRun ?? 10),
    });
    setInitialized(true);
  }

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ data: form as Record<string, unknown> });
      toast({ title: "Configurações de recuperação salvas" });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  }

  if (isLoading) return <Skeleton className="h-[300px] rounded-2xl" />;

  const dayLabels: Record<string, string> = { "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui", "5": "Sex", "6": "Sáb" };
  const selectedDays = form.recoveryDays.split(",").filter(Boolean);
  const selectedHours = form.recoveryHours.split(",").filter(Boolean);

  return (
    <Card className="border border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Configurações de Recuperação
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{form.recoveryEnabled ? "Ativo" : "Inativo"}</Label>
            <Switch checked={form.recoveryEnabled} onCheckedChange={(v) => setForm({ ...form, recoveryEnabled: v })} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Dias de inatividade (pacientes)</Label>
            <p className="text-[11px] text-muted-foreground/60">Pacientes sem visita há mais de X dias</p>
            <Input
              type="number"
              min={7}
              max={365}
              value={form.recoveryInactivityDays}
              onChange={(e) => setForm({ ...form, recoveryInactivityDays: Number(e.target.value) })}
              className="max-w-[140px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Dias após no-show (leads)</Label>
            <p className="text-[11px] text-muted-foreground/60">Leads com falta há mais de X dias</p>
            <Input
              type="number"
              min={1}
              max={90}
              value={form.recoveryNoShowDays}
              onChange={(e) => setForm({ ...form, recoveryNoShowDays: Number(e.target.value) })}
              className="max-w-[140px]"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Instruções personalizadas para a IA</Label>
          <p className="text-[11px] text-muted-foreground/60">A IA usará estas instruções ao gerar as mensagens de reativação</p>
          <Textarea
            value={form.recoveryAiInstructions}
            onChange={(e) => setForm({ ...form, recoveryAiInstructions: e.target.value })}
            placeholder="Ex: Mencione sempre o novo equipamento de clareamento que chegou. Use tom acolhedor e não invasivo..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Dias de envio</Label>
          <div className="flex flex-wrap gap-2">
            {["0", "1", "2", "3", "4", "5", "6"].map((day) => {
              const isSelected = selectedDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const newDays = isSelected
                      ? selectedDays.filter((d) => d !== day)
                      : [...selectedDays, day].sort();
                    setForm({ ...form, recoveryDays: newDays.join(",") });
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {dayLabels[day]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Horários de envio</Label>
          <div className="flex flex-wrap gap-2">
            {["8", "9", "10", "11", "14", "15", "16", "17"].map((h) => {
              const isSelected = selectedHours.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    const newHours = isSelected
                      ? selectedHours.filter((x) => x !== h)
                      : [...selectedHours, h].sort((a, b) => Number(a) - Number(b));
                    setForm({ ...form, recoveryHours: newHours.join(",") });
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {h}h
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Máximo de mensagens por execução</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={form.recoveryMaxPerRun}
            onChange={(e) => setForm({ ...form, recoveryMaxPerRun: Number(e.target.value) })}
            className="max-w-[140px]"
          />
        </div>

        <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full sm:w-auto">
          Salvar Configurações
        </Button>
      </CardContent>
    </Card>
  );
}

function CandidatesTable() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<RecoveryCandidate[]>({
    queryKey: ["/api/dental/recovery/candidates"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dental/recovery/candidates`);
      if (!res.ok) throw new Error("Failed to fetch candidates");
      return res.json();
    },
    staleTime: 60_000,
  });

  const manualSendMut = useMutation({
    mutationFn: async ({ entityType, id }: { entityType: string; id: number }) => {
      const res = await fetch(`${BASE}/api/dental/recovery/manual-send/${entityType}/${id}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mensagem de recuperação enviada!" });
      refetch();
    },
    onError: () => {
      toast({ title: "Erro ao enviar mensagem", variant: "destructive" });
    },
  });

  const candidates = data || [];

  if (isLoading) return <Skeleton className="h-[200px] rounded-2xl" />;

  if (!candidates.length) {
    return (
      <div className="rounded-2xl border border-border/30 p-10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
          <UserCheck className="w-6 h-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground/60">Nenhum candidato à recuperação</p>
        <p className="text-[12px] text-muted-foreground/40 mt-1">Todos os seus pacientes estão ativos!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {candidates.slice(0, 30).map((c) => {
        const statusCfg = statusConfig[c.status] || statusConfig.pendente;
        const daysText = c.daysInactive >= 9990 ? "Nunca" : `${c.daysInactive}d`;
        const entityIcon = c.entityType === "patient" ? UserCheck : UserX;
        const EntityIcon = entityIcon;

        return (
          <div key={`${c.entityType}-${c.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-border/30 hover:border-border/60 hover:bg-muted/20 transition-all">
            <div className="w-9 h-9 rounded-xl bg-muted/40 flex items-center justify-center flex-shrink-0">
              <EntityIcon className="w-4 h-4 text-muted-foreground/60" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold truncate">{c.name}</p>
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-semibold border-border/40">
                  {c.entityType === "patient" ? "Paciente" : "Lead"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Clock className="w-3 h-3 text-muted-foreground/40" />
                <span className="text-[11px] text-muted-foreground/60">{daysText} inativo</span>
                {c.lastContact && (
                  <span className="text-[11px] text-muted-foreground/40">
                    · Último: {new Date(c.lastContact).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${statusCfg.bg} ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
              {c.status === "pendente" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => manualSendMut.mutate({ entityType: c.entityType, id: c.id })}
                  disabled={manualSendMut.isPending}
                >
                  <Send className="w-3 h-3" />
                  Enviar
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {candidates.length > 30 && (
        <p className="text-center text-xs text-muted-foreground/50 pt-2">
          Mostrando 30 de {candidates.length} candidatos
        </p>
      )}
    </div>
  );
}

export default function RecoveryPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const { data: stats, isLoading: statsLoading } = useQuery<RecoveryStats>({
    queryKey: ["/api/dental/recovery/stats", period],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dental/recovery/stats?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    staleTime: 60_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Recuperação</h1>
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <RefreshCw className="w-3 h-3 text-emerald-500" />
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground/60 font-medium">
            Reative pacientes inativos e leads que não compareceram
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "90 dias"}
            </button>
          ))}
        </div>
      </div>

      <ExplanationBlock />

      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard title="Candidatos" value={stats.totalCandidates} icon={Users} color="text-primary" bg="bg-primary/5" />
          <MetricCard title="Contatos Enviados" value={stats.totalSent} icon={Send} color="text-blue-600 dark:text-blue-400" bg="bg-blue-500/5" />
          <MetricCard title="Responderam" value={stats.totalResponded} icon={MessageSquare} color="text-amber-600 dark:text-amber-400" bg="bg-amber-500/5" />
          <MetricCard title="Reagendaram" value={stats.totalConverted} icon={CalendarCheck} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-500/5" />
        </div>
      ) : null}

      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1 premium-card-shine rounded-2xl border border-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-[13px] font-bold flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-primary" />
                Funil de Recuperação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelChart stats={stats} />
            </CardContent>
          </Card>

          <Card className="premium-card-shine rounded-2xl border border-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-[13px] font-bold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                Tendência Semanal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WeeklyTrendChart trend={stats.weeklyTrend} />
            </CardContent>
          </Card>

          <Card className="premium-card-shine rounded-2xl border border-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-[13px] font-bold flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                Por Tempo de Inatividade
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InactivityChart buckets={stats.inactivityBuckets} />
            </CardContent>
          </Card>
        </div>
      )}

      <ConfigPanel />

      <Card className="premium-card-shine rounded-2xl border border-border/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
            Candidatos à Recuperação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CandidatesTable />
        </CardContent>
      </Card>
    </div>
  );
}
