import { useState } from "react";
import {
  useGetAppointmentsReport, useGetRevenueReport, useGetProceduresReport,
  useGetLeadsReport, useGetRecoveryStats, useGetRecoveryCandidates,
  RecoveryStats, RecoveryCandidate,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  BarChart3, CalendarDays, DollarSign, Target, TrendingUp, UserCheck,
} from "lucide-react";

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

function AppointmentsTab({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { data, isLoading } = useGetAppointmentsReport({ startDate, endDate });
  const report = data as { total?: number; completed?: number; cancelled?: number; noShow?: number; revenue?: number } | undefined;

  if (isLoading) return <Skeleton className="h-[300px]" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold number-display">{report?.total || 0}</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Total de consultas</p>
        </CardContent>
      </Card>
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 number-display">{report?.completed || 0}</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Concluidas</p>
        </CardContent>
      </Card>
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold text-red-600 dark:text-red-400 number-display">{report?.cancelled || 0}</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Canceladas</p>
        </CardContent>
      </Card>
      {(report?.total ?? 0) > 0 && (
        <Card className="col-span-2 md:col-span-4 premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-bold">Taxa de conclusao</p>
              <p className="text-[13px] font-extrabold number-display">{Math.round(((report!.completed || 0) / report!.total!) * 100)}%</p>
            </div>
            <Progress value={((report!.completed || 0) / report!.total!) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RevenueTab({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { data, isLoading } = useGetRevenueReport({ startDate, endDate });
  const report = data as { totalRevenue?: number; averageTicket?: number; topProcedure?: string } | undefined;

  if (isLoading) return <Skeleton className="h-[300px]" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-xl stat-gradient-1 flex items-center justify-center mx-auto mb-3">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-extrabold number-display">R$ {Number(report?.totalRevenue || 0).toLocaleString("pt-BR")}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Receita total</p>
          </CardContent>
        </Card>
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-xl stat-gradient-2 flex items-center justify-center mx-auto mb-3">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-extrabold number-display">R$ {Number(report?.averageTicket || 0).toLocaleString("pt-BR")}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Ticket medio</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProceduresTab({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { data, isLoading } = useGetProceduresReport({ startDate, endDate });
  const items = (data as Array<{ name: string; procedureName?: string; count: number; revenue: number }>) || [];

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const maxCount = Math.max(...items.map((i) => i.count || 0), 1);

  return (
    <div className="space-y-3">
      {items.map((item, idx: number) => (
        <Card key={idx} className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-bold">{item.procedureName || item.name}</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] rounded-md font-semibold">{item.count}x</Badge>
                <Badge variant="outline" className="font-mono text-[10px] rounded-md font-semibold">
                  R$ {Number(item.revenue || 0).toLocaleString("pt-BR")}
                </Badge>
              </div>
            </div>
            <Progress value={(item.count / maxCount) * 100} className="h-1.5" />
          </CardContent>
        </Card>
      ))}
      {items.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhum dado de procedimento no periodo
        </div>
      )}
    </div>
  );
}

function LeadsTab({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { data, isLoading } = useGetLeadsReport({ startDate, endDate });
  const report = data as { total?: number; converted?: number; hot?: number; warm?: number; cold?: number; conversionRate?: number; byTemperature?: { hot?: number; warm?: number; cold?: number } } | undefined;

  if (isLoading) return <Skeleton className="h-[300px]" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold number-display">{report?.total || 0}</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Total de leads</p>
        </CardContent>
      </Card>
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 number-display">{report?.converted || 0}</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Convertidos</p>
        </CardContent>
      </Card>
      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardContent className="p-4 text-center">
          <p className="text-2xl font-extrabold text-primary number-display">{Math.round(report?.conversionRate || 0)}%</p>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Taxa de conversao</p>
        </CardContent>
      </Card>
      {report?.byTemperature && (
        <Card className="col-span-2 md:col-span-4 premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <p className="text-[13px] font-bold mb-3">Por temperatura</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-extrabold text-red-500 dark:text-red-400 number-display">{report.byTemperature.hot || 0}</p>
                <p className="text-[11px] text-muted-foreground/60 font-medium">Quente</p>
              </div>
              <div>
                <p className="text-lg font-extrabold text-orange-500 dark:text-orange-400 number-display">{report.byTemperature.warm || 0}</p>
                <p className="text-[11px] text-muted-foreground/60 font-medium">Morno</p>
              </div>
              <div>
                <p className="text-lg font-extrabold text-blue-500 dark:text-blue-400 number-display">{report.byTemperature.cold || 0}</p>
                <p className="text-[11px] text-muted-foreground/60 font-medium">Frio</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function statusLabel(status: RecoveryCandidate["status"]): { label: string; className: string } {
  switch (status) {
    case "reagendou":
      return { label: "Reagendou", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
    case "respondeu":
      return { label: "Respondeu", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
    case "mensagem_enviada":
      return { label: "Mensagem enviada", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
    default:
      return { label: "Pendente", className: "bg-muted/60 text-muted-foreground border-border/40" };
  }
}

function RecoveredTab() {
  const { data: statsData, isLoading: statsLoading } = useGetRecoveryStats({ period: "30d" });
  const { data: candidatesData, isLoading: candidatesLoading } = useGetRecoveryCandidates();

  const stats = statsData as RecoveryStats | undefined;
  const candidates = (candidatesData as RecoveryCandidate[] | undefined) || [];

  const conversionRate = stats && stats.totalSent > 0
    ? Math.round((stats.totalConverted / stats.totalSent) * 100)
    : 0;

  const buckets = stats?.inactivityBuckets ?? { "30-60d": 0, "60-90d": 0, "+90d": 0 };
  const totalBucket = (buckets["30-60d"] || 0) + (buckets["60-90d"] || 0) + (buckets["+90d"] || 0);

  if (statsLoading || candidatesLoading) return <Skeleton className="h-[400px]" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-extrabold number-display">{stats?.totalCandidates || 0}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Candidatos</p>
          </CardContent>
        </Card>
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-extrabold text-primary number-display">{stats?.totalSent || 0}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Enviados</p>
          </CardContent>
        </Card>
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 number-display">{stats?.totalResponded || 0}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Responderam</p>
          </CardContent>
        </Card>
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 number-display">{stats?.totalConverted || 0}</p>
            <p className="text-[11px] text-muted-foreground/60 font-medium mt-1">Reagendaram</p>
          </CardContent>
        </Card>
      </div>

      {(stats?.totalSent ?? 0) > 0 && (
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-bold">Taxa de conversao</p>
              <p className="text-[13px] font-extrabold text-emerald-600 dark:text-emerald-400 number-display">{conversionRate}%</p>
            </div>
            <Progress value={conversionRate} className="h-2" />
          </CardContent>
        </Card>
      )}

      {totalBucket > 0 && (
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-[13px] font-bold">Inatividade por periodo</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {(["30-60d", "60-90d", "+90d"] as const).map((bucket) => {
              const count = buckets[bucket] || 0;
              const pct = totalBucket > 0 ? (count / totalBucket) * 100 : 0;
              return (
                <div key={bucket}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-muted-foreground">{bucket}</span>
                    <span className="text-[12px] font-bold number-display">{count}</span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {(stats?.weeklyTrend ?? []).length > 0 && (
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-[13px] font-bold">Tendencia semanal</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {(stats!.weeklyTrend).map((week, idx) => (
              <div key={idx} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                <span className="text-[11px] text-muted-foreground font-medium">{week.week}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">{week.sent} enviados</span>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400">{week.responded} responderam</span>
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{week.converted} reagendaram</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="premium-card-glow rounded-xl overflow-hidden">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-[13px] font-bold">Lista de candidatos ({candidates.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {candidates.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Nenhum candidato de recuperacao encontrado
            </div>
          ) : (
            candidates.map((c) => {
              const st = statusLabel(c.status);
              return (
                <div key={`${c.entityType}-${c.id}`} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground/60">{c.daysInactive === 9999 ? "Sem visita" : `${c.daysInactive}d inativo`}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-[10px] rounded-md font-semibold border ${c.entityType === "patient" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" : "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"}`}>
                      {c.entityType === "patient" ? "Paciente" : "Lead"}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] rounded-md font-semibold border ${st.className}`}>
                      {st.label}
                    </Badge>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  const defaults = getDefaultDates();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Relatorios</h1>
          <p className="text-[12px] text-muted-foreground/60 font-medium mt-1">Analise detalhada do desempenho</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">De:</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-36 h-8 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Ate:</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-36 h-8 text-xs" />
          </div>
        </div>
      </div>

      <Tabs defaultValue="appointments">
        <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="appointments" className="flex-1 min-w-[100px] text-xs gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Consultas
          </TabsTrigger>
          <TabsTrigger value="revenue" className="flex-1 min-w-[100px] text-xs gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Receita
          </TabsTrigger>
          <TabsTrigger value="procedures" className="flex-1 min-w-[100px] text-xs gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Procedimentos
          </TabsTrigger>
          <TabsTrigger value="recovered" className="flex-1 min-w-[100px] text-xs gap-1.5">
            <UserCheck className="w-3.5 h-3.5" /> Recuperados
          </TabsTrigger>
          <TabsTrigger value="leads" className="flex-1 min-w-[100px] text-xs gap-1.5">
            <Target className="w-3.5 h-3.5" /> Leads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appointments" className="mt-6">
          <AppointmentsTab startDate={startDate} endDate={endDate} />
        </TabsContent>
        <TabsContent value="revenue" className="mt-6">
          <RevenueTab startDate={startDate} endDate={endDate} />
        </TabsContent>
        <TabsContent value="procedures" className="mt-6">
          <ProceduresTab startDate={startDate} endDate={endDate} />
        </TabsContent>
        <TabsContent value="recovered" className="mt-6">
          <RecoveredTab />
        </TabsContent>
        <TabsContent value="leads" className="mt-6">
          <LeadsTab startDate={startDate} endDate={endDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
