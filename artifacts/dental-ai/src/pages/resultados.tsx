import { useState, useMemo } from "react";
import { useGetMonthlyTrend, type MonthlyTrendItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Users,
  DollarSign,
  Target,
  CalendarCheck,
  Sparkles,
} from "lucide-react";

const SUBSCRIPTION_MONTHLY = 197;

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatMonth(yyyymm: string) {
  const [year, month] = yyyymm.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  gradient: string;
  loading?: boolean;
}

function KpiCard({ icon, label, value, gradient, loading }: KpiCardProps) {
  return (
    <Card className="rounded-2xl overflow-hidden border-0 shadow-lg">
      <div className={`h-1 w-full ${gradient}`} />
      <CardContent className="p-5">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="flex items-start gap-3">
            <div className={`p-2.5 rounded-xl ${gradient} bg-opacity-10 shrink-0`}>
              <div className="text-white">{icon}</div>
            </div>
            <div>
              <p className="text-2xl font-extrabold number-display leading-none">{value}</p>
              <p className="text-xs text-muted-foreground/70 font-medium mt-1">{label}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricHint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/50 font-bold">{label}</p>
      <p className="text-sm font-extrabold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

const CustomTooltipRevenue = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.name === "Receita (R$)" ? "#10b981" : "#6366f1" }}>
          {p.name}: {p.name === "Receita (R$)" ? formatCurrency(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

const CustomTooltipBar = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: "#f59e0b" }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

export default function ResultadosPage() {
  const [period, setPeriod] = useState<3 | 6 | 12>(12);
  const { data, isLoading } = useGetMonthlyTrend({ months: period });

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map((item: MonthlyTrendItem) => ({
      ...item,
      label: formatMonth(item.month),
    }));
  }, [data]);

  const totals = useMemo(() => {
    if (!data?.data?.length) return { appointments: 0, revenue: 0, recovered: 0, leads: 0 };
    return data.data.reduce(
      (acc: { appointments: number; revenue: number; recovered: number; leads: number }, item: MonthlyTrendItem) => ({
        appointments: acc.appointments + item.appointments,
        revenue: acc.revenue + item.revenue,
        recovered: acc.recovered + item.recoveredPatients,
        leads: acc.leads + item.leadsConverted,
      }),
      { appointments: 0, revenue: 0, recovered: 0, leads: 0 },
    );
  }, [data]);

  const currentMonth = data?.data?.[data.data.length - 1];
  const roiRecovered = currentMonth?.recoveredPatients ?? 0;
  const currentMonthLabel = currentMonth ? formatMonth(currentMonth.month) : "mês atual";
  const avgTicket = useMemo(() => {
    if (!data?.data?.length) return 0;
    const totalAppts = data.data.reduce((s: number, d: MonthlyTrendItem) => s + d.appointments, 0);
    const totalRevenue = data.data.reduce((s: number, d: MonthlyTrendItem) => s + d.revenue, 0);
    return totalAppts > 0 ? totalRevenue / totalAppts : 0;
  }, [data]);
  const roiEstimatedRevenue = roiRecovered * avgTicket;
  const roiMultiple = SUBSCRIPTION_MONTHLY > 0 && roiEstimatedRevenue > 0
    ? (roiEstimatedRevenue / SUBSCRIPTION_MONTHLY).toFixed(1)
    : "0";
  const growthFromFirstMonth =
    data?.data?.length && data.data[0].appointments > 0 && currentMonth
      ? (((currentMonth.appointments - data.data[0].appointments) / data.data[0].appointments) * 100).toFixed(0)
      : null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Resultados
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Veja o impacto real do seu software mês a mês
          </p>
        </div>
        <div className="flex gap-2">
          {([3, 6, 12] as const).map((m) => (
            <Button
              key={m}
              variant={period === m ? "default" : "outline"}
              size="sm"
              className="rounded-xl"
              onClick={() => setPeriod(m)}
            >
              {m} meses
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Pacientes Recuperados pela IA"
          value={isLoading ? "—" : String(totals.recovered)}
          gradient="bg-gradient-to-r from-amber-500 to-orange-500"
          loading={isLoading}
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Receita Gerada no Período"
          value={isLoading ? "—" : formatCurrency(totals.revenue)}
          gradient="bg-gradient-to-r from-emerald-500 to-teal-500"
          loading={isLoading}
        />
        <KpiCard
          icon={<Target className="h-4 w-4" />}
          label="Leads Convertidos"
          value={isLoading ? "—" : String(totals.leads)}
          gradient="bg-gradient-to-r from-violet-500 to-purple-600"
          loading={isLoading}
        />
        <KpiCard
          icon={<CalendarCheck className="h-4 w-4" />}
          label="Consultas Realizadas"
          value={isLoading ? "—" : String(totals.appointments)}
          gradient="bg-gradient-to-r from-sky-500 to-blue-600"
          loading={isLoading}
        />
      </div>
      <p className="text-[10px] text-muted-foreground/40 italic leading-relaxed">
        ⓘ Os valores de pacientes recuperados pela IA são estimativas baseadas nos dados registrados. Resultados podem variar conforme o uso da plataforma.
      </p>

      <Card className="rounded-2xl border-0 shadow-lg overflow-hidden bg-gradient-to-r from-primary/5 via-background to-emerald-500/5">
        <CardContent className="p-5">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <MetricHint label="Receita do período" value={formatCurrency(totals.revenue)} />
              <MetricHint label="Recuperados no período" value={`${totals.recovered} pacientes`} />
              <MetricHint label="Consultas no período" value={`${totals.appointments} consultas`} />
              <MetricHint
                label="Evolução"
                value={growthFromFirstMonth ? `+${growthFromFirstMonth}% vs. primeiro mês` : "Sem base histórica"}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-0 shadow-lg overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Evolução Mensal</CardTitle>
            <p className="text-xs text-muted-foreground">Consultas realizadas e receita nos últimos {period} meses</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorAppts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltipRevenue />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="appointments"
                    name="Consultas"
                    stroke="#6366f1"
                    fill="url(#colorAppts)"
                    strokeWidth={2}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="revenue"
                    name="Receita (R$)"
                    stroke="#10b981"
                    fill="url(#colorRevenue)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-lg overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Pacientes Recuperados pela IA</CardTitle>
            <p className="text-xs text-muted-foreground">Pacientes e leads reconvertidos mensalmente</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltipBar />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="recoveredPatients"
                    name="Recuperados"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-0 shadow-lg overflow-hidden bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
        <CardContent className="p-6">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shrink-0">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-extrabold text-emerald-900 dark:text-emerald-100">
                  Retorno do Investimento (ROI) — Mês Atual
                </h3>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                  {roiRecovered > 0 && roiEstimatedRevenue > 0
                    ? `Em ${currentMonthLabel}, a IA recuperou ${roiRecovered} paciente${roiRecovered !== 1 ? "s" : ""}, gerando uma receita estimada de ${formatCurrency(roiEstimatedRevenue)}.`
                    : "Ainda sem pacientes recuperados este mês. Continue usando a recuperação automática!"}
                </p>
              </div>
              <div className="flex gap-6 shrink-0 text-center">
                <div>
                  <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 number-display">
                    {roiMultiple}x
                  </p>
                  <p className="text-xs text-muted-foreground">ROI estimado</p>
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 number-display">
                    {formatCurrency(SUBSCRIPTION_MONTHLY)}
                  </p>
                  <p className="text-xs text-muted-foreground">Assinatura/mês</p>
                </div>
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/40 italic mt-4 leading-relaxed">
            ⓘ O ROI é uma estimativa baseada na receita média por consulta e nos pacientes recuperados registrados. Resultados reais podem variar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
