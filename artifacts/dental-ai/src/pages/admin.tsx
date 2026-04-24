import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Tooltip as RTooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SimulatorPage from "@/pages/simulator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Alert, AlertDescription,
} from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import {
  Shield, Building2, Users, TrendingUp, TrendingDown, Coins, CreditCard,
  Lock, LogOut, Search, MoreHorizontal, Eye, Zap, Ban, CheckCircle2,
  XCircle, ArrowUpDown, Plus, Calendar, BarChart3, Activity,
  UserPlus, RefreshCw, Crown, Target, Phone, History, Sparkles, Loader2,
  Database, HardDrive, Wifi, WifiOff, AlertTriangle, Server, MessageSquare,
  Lightbulb, ThumbsUp, AlertCircle, Archive, CheckCheck, Filter,
  FileText, UserX, Download, ShieldCheck, Brain, Trash2, Rocket, Undo2, FlaskConical,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";

function adminFetch(path: string, adminKey: string, options?: RequestInit) {
  return fetch(`${BASE}api/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      ...(options?.headers || {}),
    },
  });
}

function audioFetch(path: string, adminKey: string, options?: RequestInit) {
  return fetch(`${BASE}api/dental/audio${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      ...(options?.headers || {}),
    },
  });
}

async function adminLgpdFetch(path: string, tenantId: number, adminKey: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set("x-admin-key", adminKey);
  if (!headers.has("Content-Type") && options?.method && options.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}api/admin/lgpd/${tenantId}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

interface ConsentRecord {
  id: number;
  tenantId: number;
  entityType: string;
  entityId: number;
  consentType: string;
  termsVersion: string;
  ipAddress: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

interface AuditLogEntry {
  id: number;
  tenantId: number;
  action: string;
  entityType: string;
  entityId: number | null;
  field: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
}

function AdminConsentSubTab({ tenantId, adminKey }: { tenantId: number; adminKey: string }) {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadConsents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminLgpdFetch("/consent", tenantId, adminKey);
      setConsents(data);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [tenantId, adminKey, toast]);

  useEffect(() => { loadConsents(); }, [loadConsents]);

  const exportCSV = () => {
    const csvHeaders = ["ID", "Tipo Entidade", "ID Entidade", "Tipo Consentimento", "Versão Termos", "IP", "Data"];
    const rows = consents.map((c) => [
      c.id, c.entityType, c.entityId, c.consentType, c.termsVersion, c.ipAddress || "", new Date(c.grantedAt).toLocaleString("pt-BR"),
    ]);
    const csv = [csvHeaders.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consentimentos_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const consentTypeLabel: Record<string, string> = {
    data_processing: "Tratamento de Dados",
    terms_of_service: "Termos de Uso",
    anonymization: "Anonimização",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Registros de Consentimento
            </CardTitle>
            <CardDescription>Visualize todos os consentimentos registrados</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadConsents}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={consents.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Exportar CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : consents.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum consentimento registrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Consentimento</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consents.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {c.entityType === "patient" ? "Paciente" : "Lead"}
                      </Badge>
                    </TableCell>
                    <TableCell>#{c.entityId}</TableCell>
                    <TableCell>{consentTypeLabel[c.consentType] || c.consentType}</TableCell>
                    <TableCell>{c.termsVersion}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.ipAddress || "-"}</TableCell>
                    <TableCell className="text-sm">{new Date(c.grantedAt).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      {c.revokedAt ? (
                        <Badge variant="destructive">Revogado</Badge>
                      ) : (
                        <Badge className="bg-green-500/10 text-green-600 border-green-200">Ativo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminAuditSubTab({ tenantId, adminKey }: { tenantId: number; adminKey: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const { toast } = useToast();

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (entityFilter !== "all") params.set("entityType", entityFilter);
      const data = await adminLgpdFetch(`/audit-log?${params}`, tenantId, adminKey);
      setLogs(data);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter, tenantId, adminKey, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const actionLabel: Record<string, string> = {
    create: "Criação", read: "Leitura", update: "Atualização", delete: "Exclusão", anonymize: "Anonimização",
  };
  const actionColor: Record<string, string> = {
    create: "bg-blue-500/10 text-blue-600 border-blue-200",
    read: "bg-gray-500/10 text-gray-600 border-gray-200",
    update: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
    delete: "bg-red-500/10 text-red-600 border-red-200",
    anonymize: "bg-purple-500/10 text-purple-600 border-purple-200",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Histórico de Auditoria
            </CardTitle>
            <CardDescription>Log imutável de acessos e modificações de dados</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Ação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas ações</SelectItem>
                <SelectItem value="create">Criação</SelectItem>
                <SelectItem value="read">Leitura</SelectItem>
                <SelectItem value="update">Atualização</SelectItem>
                <SelectItem value="delete">Exclusão</SelectItem>
                <SelectItem value="anonymize">Anonimização</SelectItem>
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Entidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="patient">Paciente</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="conversation">Conversa</SelectItem>
                <SelectItem value="appointment">Consulta</SelectItem>
                <SelectItem value="treatment">Tratamento</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadLogs}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum registro de auditoria encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Data/Hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge className={actionColor[log.action] || ""}>
                        {actionLabel[log.action] || log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{log.entityType}</TableCell>
                    <TableCell>{log.entityId ? `#${log.entityId}` : "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.ipAddress || "-"}</TableCell>
                    <TableCell className="text-sm">{new Date(log.createdAt).toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminAnonymizeSubTab({ tenantId, adminKey }: { tenantId: number; adminKey: string }) {
  const [entityType, setEntityType] = useState("patient");
  const [entityId, setEntityId] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAnonymize = async () => {
    setLoading(true);
    try {
      await adminLgpdFetch(`/anonymize/${entityType}/${entityId}`, tenantId, adminKey, { method: "POST" });
      toast({ title: "Sucesso", description: "Dados anonimizados com sucesso." });
      setShowDialog(false);
      setEntityId("");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5" />
            Anonimização de Dados (Direito ao Esquecimento)
          </CardTitle>
          <CardDescription>
            Substitui dados pessoais identificáveis por dados genéricos, mantendo a integridade referencial.
            Esta ação é irreversível.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="text-sm font-medium mb-1 block">Tipo</label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="patient">Paciente</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">ID do {entityType === "patient" ? "Paciente" : "Lead"}</label>
              <Input
                type="number"
                placeholder="Ex: 123"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              />
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowDialog(true)}
              disabled={!entityId}
            >
              <UserX className="h-4 w-4 mr-2" />
              Anonimizar Dados
            </Button>
          </div>
          <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
              <div className="text-sm text-yellow-800 dark:text-yellow-200">
                <p className="font-medium mb-1">Atenção</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>A anonimização substitui nome, telefone, email, CPF e outros dados pessoais.</li>
                  <li>Registros de consultas e conversas são mantidos, mas com dados de contato anonimizados.</li>
                  <li>Esta ação <strong>não pode ser desfeita</strong>.</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirmar Anonimização
            </DialogTitle>
            <DialogDescription>
              Você está prestes a anonimizar os dados do {entityType === "patient" ? "paciente" : "lead"} #{entityId}.
              Todos os dados pessoais identificáveis serão substituídos por dados genéricos.
              Esta ação é irreversível.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnonymize} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Anonimização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdminLgpdTab({ tenants, adminKey }: { tenants: TenantRow[]; adminKey: string }) {
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [lgpdSubTab, setLgpdSubTab] = useState("consent");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-lg">LGPD — Privacidade & Compliance</h3>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Selecione a Clínica</CardTitle>
          <CardDescription>Escolha uma clínica para gerenciar dados LGPD</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedTenantId ? String(selectedTenantId) : ""}
            onValueChange={(v) => setSelectedTenantId(Number(v))}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Selecione uma clínica..." />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.clinicName || t.name} (#{t.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedTenantId && (
        <Tabs value={lgpdSubTab} onValueChange={setLgpdSubTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="consent" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Consentimentos</span>
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Auditoria</span>
            </TabsTrigger>
            <TabsTrigger value="anonymize" className="flex items-center gap-2">
              <UserX className="h-4 w-4" />
              <span className="hidden sm:inline">Anonimizar</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="consent" className="mt-4">
            <AdminConsentSubTab tenantId={selectedTenantId} adminKey={adminKey} />
          </TabsContent>
          <TabsContent value="audit" className="mt-4">
            <AdminAuditSubTab tenantId={selectedTenantId} adminKey={adminKey} />
          </TabsContent>
          <TabsContent value="anonymize" className="mt-4">
            <AdminAnonymizeSubTab tenantId={selectedTenantId} adminKey={adminKey} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Custos de IA — painel agregado por dia/modelo ───────────────────────────
type AiCostDailyRow = {
  day: string; model: string; calls: number;
  promptTokens: number; completionTokens: number; cachedTokens: number;
  costUsd: number; costBrl: number;
};
type AiCostTotalsRow = {
  model: string; calls: number; promptTokens: number; completionTokens: number;
  cachedTokens: number; costUsd: number; costBrl: number;
};
type AiCostResponse = {
  days: number;
  usdToBrl: number;
  pricing: Record<string, { prompt: number; completion: number; cached: number }>;
  daily: AiCostDailyRow[];
  totals: AiCostTotalsRow[];
  grandTotal: { calls: number; costUsd: number; costBrl: number };
};

const MODEL_COLORS: Record<string, string> = {
  "gpt-5.4": "#8b5cf6",
  "gpt-5.1": "#06b6d4",
  "gpt-5.4-mini": "#0ea5e9",
  "gpt-5.4-nano": "#10b981",
  unknown: "#94a3b8",
};

function AdminAiCostTab({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<AiCostResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const { toast } = useToast();

  useEffect(() => {
    if (!adminKey) return;
    setLoading(true);
    adminFetch(`/audit/ai-cost?days=${days}`, adminKey)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AiCostResponse;
      })
      .then(setData)
      .catch((err) => toast({ title: "Erro ao carregar custos", description: String(err), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [adminKey, days, toast]);

  // Pivot daily rows by model so we can stack on the chart
  const chartData = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of data.daily) {
      const acc = byDay.get(r.day) ?? { day: r.day };
      acc[r.model] = (Number(acc[r.model]) || 0) + r.costBrl;
      byDay.set(r.day, acc);
    }
    return Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }, [data]);

  const models = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.totals.map((t) => t.model)));
  }, [data]);

  const fmtBrl = (v: number) => `R$ ${v.toFixed(2)}`;
  const fmtUsd = (v: number) => `$${v.toFixed(4)}`;
  const fmtNum = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold">Custos de IA por modelo</h3>
          <p className="text-xs text-muted-foreground">
            Baseado em tokens reais consumidos no banco · cotação USD→BRL: {data?.usdToBrl ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="14">Últimos 14 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="60">Últimos 60 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && <Skeleton className="h-64 w-full" />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardDescription>Custo total no período</CardDescription></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtBrl(data.grandTotal.costBrl)}</div>
                <div className="text-xs text-muted-foreground">{fmtUsd(data.grandTotal.costUsd)} USD</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Total de chamadas</CardDescription></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtNum(data.grandTotal.calls)}</div>
                <div className="text-xs text-muted-foreground">no motor de conversa</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Custo médio por conversa</CardDescription></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {data.grandTotal.calls > 0 ? fmtBrl(data.grandTotal.costBrl / data.grandTotal.calls) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">média ponderada</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custo diário (R$) por modelo</CardTitle>
              <CardDescription>Empilhado · cada cor representa um modelo</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Sem dados para o período. Aguarde novas conversas serem processadas.
                </p>
              ) : (
                <div className="w-full h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={(v) => `R$${Number(v).toFixed(2)}`} />
                      <RTooltip formatter={(v: number) => fmtBrl(v)} />
                      <Legend />
                      {models.map((m) => (
                        <Bar key={m} dataKey={m} stackId="a" fill={MODEL_COLORS[m] ?? "#64748b"} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhamento por modelo</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Chamadas</TableHead>
                    <TableHead className="text-right">Tokens entrada</TableHead>
                    <TableHead className="text-right">Tokens cache</TableHead>
                    <TableHead className="text-right">Tokens saída</TableHead>
                    <TableHead className="text-right">Custo (R$)</TableHead>
                    <TableHead className="text-right">Custo (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.totals.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem dados</TableCell></TableRow>
                  ) : (
                    data.totals.map((t) => (
                      <TableRow key={t.model}>
                        <TableCell>
                          <Badge variant="outline" style={{ borderColor: MODEL_COLORS[t.model], color: MODEL_COLORS[t.model] }}>
                            {t.model}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{fmtNum(t.calls)}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.promptTokens)}</TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{fmtNum(t.cachedTokens)}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.completionTokens)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtBrl(t.costBrl)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtUsd(t.costUsd)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <p className="text-[11px] text-muted-foreground mt-3">
                Apenas chamadas do motor principal de conversa entram aqui (resumos, extrações,
                suporte e voz não são auditados). Cache hit é descontado a ~10% do preço de entrada.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

interface AudioCreditSummary {
  tenantId: number;
  tenantName: string;
  balance: number;
}

interface AudioCreditTx {
  id: number;
  tenantId: number;
  amount: number;
  type: string;
  description: string | null;
  createdAt: string;
}

interface DashboardData {
  totalTenants: number;
  activeTenants: number;
  cancelledTenants: number;
  newInPeriod: number;
  cancelledInPeriod: number;
  planCounts: Record<string, number>;
  totalPatients: number;
  totalLeads: number;
  totalRevenue: number;
  creditsAdded: number;
  creditsConsumed: number;
  period: { startDate: string; endDate: string };
}

interface TenantRow {
  id: number;
  name: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  subscribedAt: string | null;
  subscriptionExpiresAt: string | null;
  cancelledAt: string | null;
  whatsappConnected: string;
  createdAt: string;
  clinicName: string;
  clinicPhone: string;
  creditBalance: number;
  monthlyCharsUsed?: number;
  monthlyConversationsUsed?: number;
  monthlyConversationsLimit?: number;
  conversationRechargeBalance?: number;
  patientCount: number;
  leadCount: number;
  maxProfessionals: number;
}

interface TenantDetail extends TenantRow {
  totalAppointments: number;
  completedAppointments: number;
  totalRevenue: number;
  recentTransactions: Array<{
    id: number;
    amount: number;
    type: string;
    description: string | null;
    createdAt: string;
  }>;
}

const planLabels: Record<string, string> = {
  basic: "Básico", trial: "Trial", essencial: "Essencial", pro: "Profissional",
  premium: "Premium", enterprise: "Enterprise",
};
const planColors: Record<string, string> = {
  basic: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  trial: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  essencial: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  pro: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  premium: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR");
}

interface AiStatusPayload {
  samples: number;
  cacheHitRate: number;
  cacheHitPct: number;
  totalPromptTokens: number;
  totalCachedTokens: number;
  reasoningEffort: string;
  windowSize: number;
}

function AiStatusCard({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<AiStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/ai/status", adminKey);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  const reasoningLabel: Record<string, { text: string; cls: string }> = {
    minimal: { text: "Mínimo (mais econômico)", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
    low: { text: "Baixo (econômico)", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
    medium: { text: "Médio (padrão)", cls: "bg-blue-500/10 text-blue-700 border-blue-200" },
    high: { text: "Alto (mais caro)", cls: "bg-amber-500/10 text-amber-700 border-amber-200" },
  };
  const effort = data?.reasoningEffort || "medium";
  const label = reasoningLabel[effort] || reasoningLabel.medium;

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" /> Status da IA Conversacional
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardTitle>
        <CardDescription className="text-xs">
          Métricas das últimas {data?.windowSize ?? 100} chamadas ao gpt-5.1
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Indisponível no momento.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Nível de raciocínio</p>
              <Badge className={`mt-1 ${label.cls}`}>{label.text}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cache de prompt (desconto)</p>
              <p className="text-xl font-bold mt-1">{data.cacheHitPct}%</p>
              <p className="text-xs text-muted-foreground">
                {formatNumber(data.totalCachedTokens)} de {formatNumber(data.totalPromptTokens)} tokens
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Amostras coletadas</p>
              <p className="text-xl font-bold mt-1">{data.samples}</p>
              <p className="text-xs text-muted-foreground">chamadas recentes</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: typeof Building2; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="border-0 shadow-md">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChurnData {
  months: number;
  totalEntries: number;
  totalExits: number;
  netGrowth: number;
  churnRate: number;
  avgDaysToCancel: number;
  activeTenants: number;
  monthly: Array<{ period: string; entries: number; exits: number; net: number }>;
  recentEntries: Array<{ name: string; plan: string; date: string; email: string | null }>;
  recentCancellations: Array<{ name: string; plan: string; joinedAt: string; cancelledAt: string; daysActive: number }>;
}

function ChurnTab({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<ChurnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonths, setSelectedMonths] = useState(6);

  const loadChurn = useCallback(async (months: number) => {
    setLoading(true);
    try {
      const res = await adminFetch(`/churn?months=${months}`, adminKey);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [adminKey]);

  useEffect(() => { loadChurn(selectedMonths); }, [loadChurn, selectedMonths]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
  const formatMonth = (period: string) => {
    const [y, m] = period.split("-");
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${months[parseInt(m) - 1]}/${y.slice(2)}`;
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxBar = Math.max(...data.monthly.map(m => Math.max(m.entries, m.exits)), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Entradas vs Saídas</h3>
        </div>
        <div className="flex items-center gap-2">
          {[3, 6, 12].map(m => (
            <Button
              key={m}
              variant={selectedMonths === m ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedMonths(m)}
              disabled={loading}
            >
              {m}m
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-xs text-muted-foreground">Novas Assinaturas</span>
            </div>
            <p className="text-2xl font-bold">{data.totalEntries}</p>
            <p className="text-xs text-muted-foreground">últimos {data.months} meses</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <Ban className="w-4 h-4 text-red-500" />
              </div>
              <span className="text-xs text-muted-foreground">Cancelamentos</span>
            </div>
            <p className="text-2xl font-bold">{data.totalExits}</p>
            <p className="text-xs text-muted-foreground">últimos {data.months} meses</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${data.netGrowth >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {data.netGrowth >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              </div>
              <span className="text-xs text-muted-foreground">Crescimento Líquido</span>
            </div>
            <p className={`text-2xl font-bold ${data.netGrowth >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {data.netGrowth > 0 ? "+" : ""}{data.netGrowth}
            </p>
            <p className="text-xs text-muted-foreground">{data.activeTenants} ativas atualmente</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${data.churnRate > 10 ? "bg-red-500/10" : "bg-amber-500/10"}`}>
                <Activity className="w-4 h-4 text-amber-500" />
              </div>
              <span className="text-xs text-muted-foreground">Taxa de Churn</span>
            </div>
            <p className={`text-2xl font-bold ${data.churnRate > 10 ? "text-red-600" : ""}`}>{data.churnRate}%</p>
            <p className="text-xs text-muted-foreground">
              {data.avgDaysToCancel > 0 ? `~${data.avgDaysToCancel} dias até cancelar` : "sem cancelamentos recentes"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" /> Comparativo Mensal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.monthly.map(m => (
            <div key={m.period} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium w-16">{formatMonth(m.period)}</span>
                <span className={`text-xs font-medium ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {m.net > 0 ? "+" : ""}{m.net}
                </span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1 flex gap-1 h-5">
                  <div
                    className="bg-emerald-500 rounded-sm h-full transition-all flex items-center justify-center"
                    style={{ width: `${(m.entries / maxBar) * 100}%`, minWidth: m.entries > 0 ? "20px" : "0" }}
                  >
                    {m.entries > 0 && <span className="text-[10px] text-white font-medium">{m.entries}</span>}
                  </div>
                  <div
                    className="bg-red-500 rounded-sm h-full transition-all flex items-center justify-center"
                    style={{ width: `${(m.exits / maxBar) * 100}%`, minWidth: m.exits > 0 ? "20px" : "0" }}
                  >
                    {m.exits > 0 && <span className="text-[10px] text-white font-medium">{m.exits}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 pt-2 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500" /> Entradas</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-500" /> Saídas</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-md border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-500" /> Novas Assinaturas
              <Badge variant="secondary" className="text-xs ml-auto">{data.recentEntries.length}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">Últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentEntries.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Clínica</TableHead>
                    <TableHead className="text-xs">Plano</TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentEntries.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{e.name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{e.plan}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(e.date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma nova assinatura nos últimos 30 dias</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-500" /> Cancelamentos
              <Badge variant="destructive" className="text-xs ml-auto">{data.recentCancellations.length}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">Últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentCancellations.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Clínica</TableHead>
                    <TableHead className="text-xs">Plano</TableHead>
                    <TableHead className="text-xs">Cancelou</TableHead>
                    <TableHead className="text-xs">Dias ativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentCancellations.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{c.name}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{c.plan}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(c.cancelledAt)}</TableCell>
                      <TableCell className="text-xs">{c.daysActive}d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum cancelamento nos últimos 30 dias</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface HealthData {
  status: string;
  uptime: number;
  timestamp: string;
  pool: { total: number; idle: number; waiting: number };
  cache: { settings: number; procedures: number };
  memory: { rss: number; heap: number };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function MonitoringTab() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHealth = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/health`, { signal: controller.signal });
      if (!res.ok) throw new Error("unhealthy");
      const data = await res.json();
      setHealth(data);
      setOffline(false);
      setLastChecked(new Date());
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setOffline(true);
      setHealth(null);
    } finally {
      setLoading(false);
      setCountdown(15);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        if (!mounted) return;
        await fetchHealth();
        if (mounted) schedule();
      }, 15000);
    };
    fetchHealth().then(() => { if (mounted) schedule(); });
    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchHealth]);

  useEffect(() => {
    const timer = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const poolMax = 30;
  const memMax = 512;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Monitoramento do Servidor</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Atualiza em {countdown}s</span>
          <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {offline ? <WifiOff className="w-4 h-4 text-red-500" /> : <Wifi className="w-4 h-4 text-emerald-500" />}
              Status Geral
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Servidor</span>
              {offline ? (
                <Badge variant="destructive" className="text-xs">Offline</Badge>
              ) : (
                <Badge className="text-xs bg-emerald-500 hover:bg-emerald-600">Online</Badge>
              )}
            </div>
            {health && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Uptime</span>
                  <span className="text-sm font-medium">{formatUptime(health.uptime)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Última verificação</span>
                  <span className="text-sm font-medium">{lastChecked?.toLocaleTimeString("pt-BR")}</span>
                </div>
              </>
            )}
            {offline && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription className="text-xs">
                  O servidor não está respondendo. Verifique o deploy.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-500" />
              Banco de Dados (Pool)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {health ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Conexões no pool</span>
                    <span className="font-medium">{health.pool.total} / {poolMax}</span>
                  </div>
                  <Progress value={clamp((health.pool.total / poolMax) * 100)} className="h-2" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Ociosas (livres)</span>
                  <Badge variant="secondary" className="text-xs">{health.pool.idle}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Em espera</span>
                  {health.pool.waiting > 0 ? (
                    <Badge variant="destructive" className="text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {health.pool.waiting}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">{health.pool.waiting}</Badge>
                  )}
                </div>
                {health.pool.waiting > 0 ? (
                  <Alert variant="destructive" className="mt-1">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      Requisições aguardando conexão. Considere aumentar o pool.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Pool estável, sem filas de espera</p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Cache em Memória
            </CardTitle>
            <CardDescription className="text-xs">TTL: 2 minutos — limpeza a cada 5min</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {health ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Settings em cache</span>
                  <span className="text-sm font-medium">{health.cache.settings} {health.cache.settings === 1 ? "tenant" : "tenants"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Procedimentos em cache</span>
                  <span className="text-sm font-medium">{health.cache.procedures} {health.cache.procedures === 1 ? "tenant" : "tenants"}</span>
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  {health.cache.settings + health.cache.procedures > 0
                    ? `${health.cache.settings + health.cache.procedures} entradas ativas — reduzindo carga no banco`
                    : "Nenhuma entrada em cache no momento"}
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-violet-500" />
              Memória do Servidor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {health ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">RSS (Total)</span>
                    <span className="font-medium">{health.memory.rss} MB</span>
                  </div>
                  <Progress value={clamp((health.memory.rss / memMax) * 100)} className="h-2" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Heap (JS)</span>
                    <span className={`font-medium ${health.memory.heap > 400 ? "text-red-500" : ""}`}>
                      {health.memory.heap} MB
                    </span>
                  </div>
                  <Progress
                    value={clamp((health.memory.heap / memMax) * 100)}
                    className={`h-2 ${health.memory.heap > 400 ? "[&>div]:bg-red-500" : ""}`}
                  />
                </div>
                {health.memory.heap > 400 && (
                  <Alert variant="destructive" className="mt-1">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      Heap acima de 400MB. Possível vazamento de memória.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface InsightsData {
  mrr: number;
  premiumPrice: number;
  premiumCount: number;
  totalActiveCount: number;
  cancelledCount: number;
  noWhatsapp: Array<{ id: number; name: string; plan: string; createdAt: string }>;
  avgMrrPerTenant: number;
  receitaAcumulada: number;
  ticketMedio: number;
}

function InsightsTab({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/insights", adminKey);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  const fd = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Informações do Negócio</h3>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">MRR Estimado</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data.mrr)}</p>
            <p className="text-xs text-muted-foreground mt-1">{data.premiumCount} clínica{data.premiumCount !== 1 ? "s" : ""} premium × {formatCurrency(data.premiumPrice)}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${data.noWhatsapp.length > 3 ? "bg-red-500/10" : "bg-blue-500/10"}`}>
                <WifiOff className={`w-4 h-4 ${data.noWhatsapp.length > 3 ? "text-red-500" : "text-blue-500"}`} />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Sem WhatsApp</span>
            </div>
            <p className={`text-2xl font-bold ${data.noWhatsapp.length > 3 ? "text-red-500" : ""}`}>{data.noWhatsapp.length}</p>
            <p className="text-xs text-muted-foreground mt-1">clínicas ativas desconectadas</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Distribuição Atual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ativas (total)</span>
              <span className="font-bold">{data.totalActiveCount}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-violet-600 font-medium">Premium</span>
                <span className="font-bold">{data.premiumCount}</span>
              </div>
              <Progress value={data.totalActiveCount > 0 ? (data.premiumCount / data.totalActiveCount) * 100 : 0} className="h-2 [&>div]:bg-violet-500" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Canceladas</span>
              <span className="font-bold text-red-500">{data.cancelledCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ticket médio</span>
              <span className="font-bold text-emerald-600">{formatCurrency(data.ticketMedio)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Receita acumulada</span>
              <span className="font-bold text-emerald-700">{formatCurrency(data.receitaAcumulada)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-blue-500" /> Sem WhatsApp Conectado
              {data.noWhatsapp.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px]">{data.noWhatsapp.length}</Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">Clínicas ativas sem integração WhatsApp</CardDescription>
          </CardHeader>
          <CardContent>
            {data.noWhatsapp.length > 0 ? (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {data.noWhatsapp.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">Desde {fd(t.createdAt)}</p>
                    </div>
                    <Badge className={`ml-2 shrink-0 text-[10px] ${planColors[t.plan] || planColors.basic}`}>
                      {planLabels[t.plan] || t.plan}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Wifi className="w-8 h-8 text-emerald-500 mb-2" />
                <p className="text-sm text-muted-foreground">Todas as clínicas ativas estão conectadas!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type FeedbackItem = {
  id: number;
  tenant_id: number;
  type: string;
  content: string;
  original_message: string;
  status: string;
  created_at: string;
  clinic_name: string;
};

type FeedbackResponse = {
  items: FeedbackItem[];
  total: number;
  novas: number;
  page: number;
};

type TrendsData = {
  byType: Record<string, number>;
  weeklyTimeSeries: Array<{ week: string; sugestao: number; reclamacao: number; elogio: number; dica: number; outro: number }>;
  topContentByType: Record<string, Array<{ content: string; createdAt: string }>>;
};

const feedbackTypeConfig: Record<string, { label: string; icon: React.ReactNode; className: string; color: string }> = {
  sugestao: { label: "Sugestão", icon: <Lightbulb className="w-3.5 h-3.5" />, className: "bg-blue-100 text-blue-700 border-blue-200", color: "#3b82f6" },
  reclamacao: { label: "Reclamação", icon: <AlertCircle className="w-3.5 h-3.5" />, className: "bg-red-100 text-red-700 border-red-200", color: "#ef4444" },
  elogio: { label: "Elogio", icon: <ThumbsUp className="w-3.5 h-3.5" />, className: "bg-emerald-100 text-emerald-700 border-emerald-200", color: "#10b981" },
  dica: { label: "Dica", icon: <Sparkles className="w-3.5 h-3.5" />, className: "bg-amber-100 text-amber-700 border-amber-200", color: "#f59e0b" },
  outro: { label: "Outro", icon: <MessageSquare className="w-3.5 h-3.5" />, className: "bg-gray-100 text-gray-700 border-gray-200", color: "#6b7280" },
};

const TREND_TYPES = ["sugestao", "reclamacao", "elogio", "dica", "outro"] as const;

function formatWeekLabel(week: string): string {
  const d = new Date(week + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function TrendsSection({ adminKey, refreshKey }: { adminKey: string; refreshKey: number }) {
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminFetch("/feedback/trends", adminKey)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setTrends(data as TrendsData); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [adminKey, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-3 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  if (!trends) return null;

  const total = Object.values(trends.byType).reduce((a, b) => a + b, 0);
  const hasWeekly = trends.weeklyTimeSeries.length > 0;

  const barData = TREND_TYPES.map(type => ({
    name: feedbackTypeConfig[type].label,
    total: trends.byType[type] ?? 0,
    color: feedbackTypeConfig[type].color,
  })).filter(d => d.total > 0);

  return (
    <div className="space-y-4 mb-6 p-4 rounded-xl bg-muted/30 border border-border">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary" />
        <h4 className="font-semibold text-sm">Tendências de Insights</h4>
        <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {TREND_TYPES.map(type => {
          const cfg = feedbackTypeConfig[type];
          const count = trends.byType[type] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={type} className={`rounded-lg border p-3 flex flex-col gap-1 ${cfg.className}`}>
              <div className="flex items-center gap-1.5">
                {cfg.icon}
                <span className="text-xs font-medium">{cfg.label}</span>
              </div>
              <span className="text-2xl font-bold leading-none">{count}</span>
              <span className="text-[11px] opacity-70">{pct}% do total</span>
            </div>
          );
        })}
      </div>

      {barData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Distribuição por tipo</p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={82} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value: number) => [value, "Feedbacks"]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasWeekly && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Volume semanal — últimos 60 dias</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trends.weeklyTimeSeries} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="week" tickFormatter={formatWeekLabel} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                labelFormatter={(label: string) => `Semana de ${formatWeekLabel(label)}`}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {TREND_TYPES.filter(t => trends.weeklyTimeSeries.some(w => (w[t] ?? 0) > 0)).map(type => (
                <Line
                  key={type}
                  type="monotone"
                  dataKey={type}
                  name={feedbackTypeConfig[type].label}
                  stroke={feedbackTypeConfig[type].color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {TREND_TYPES.some(t => (trends.topContentByType[t]?.length ?? 0) > 0) && (
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Temas recentes por categoria</p>
          <div className="space-y-3">
            {TREND_TYPES.filter(type => (trends.topContentByType[type]?.length ?? 0) > 0).map(type => {
              const cfg = feedbackTypeConfig[type];
              const items = trends.topContentByType[type] ?? [];
              return (
                <div key={type}>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold mb-1 ${cfg.className.split(" ")[1]}`}>
                    {cfg.icon}
                    <span>{cfg.label}</span>
                    <span className="font-normal opacity-60 ml-0.5">({items.length} recentes)</span>
                  </div>
                  <div className="space-y-1">
                    {items.map((item, i) => (
                      <div key={i} className="text-xs p-2 rounded-lg bg-background border flex items-start gap-1.5">
                        <span className="opacity-40 shrink-0 mt-0.5">•</span>
                        <span className="text-muted-foreground leading-relaxed">{item.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackTab({ adminKey, onNovasChange }: { adminKey: string; onNovasChange?: (count: number) => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [trendsRefreshKey, setTrendsRefreshKey] = useState(0);

  const load = useCallback(async (filter: string = statusFilter) => {
    setLoading(true);
    try {
      const qs = filter !== "all" ? `?status=${filter}` : "";
      const res = await adminFetch(`/feedback${qs}`, adminKey);
      if (!res.ok) throw new Error("Erro ao carregar feedback");
      const json = await res.json() as FeedbackResponse;
      setData(json);
      onNovasChange?.(json.novas);
    } catch {
      toast({ title: "Erro ao carregar feedback", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [adminKey, statusFilter, toast, onNovasChange]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: number, status: string) => {
    try {
      const res = await adminFetch(`/feedback/${id}/status`, adminKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar");
      setData(prev => {
        if (!prev) return prev;
        const wasNova = prev.items.find(i => i.id === id)?.status === "nova";
        const newNovas = (wasNova && status !== "nova") ? Math.max(0, prev.novas - 1) : prev.novas;
        onNovasChange?.(newNovas);
        const updatedItems = statusFilter !== "all"
          ? prev.items.filter(item => item.id !== id)
          : prev.items.map(item => item.id === id ? { ...item, status } : item);
        return { ...prev, novas: newNovas, items: updatedItems };
      });
      toast({ title: status === "arquivada" ? "Feedback arquivado" : "Marcado como lido" });
    } catch {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    }
  };

  const changeFilter = (f: string) => {
    setStatusFilter(f);
    load(f);
  };

  const handleRefresh = () => {
    load();
    setTrendsRefreshKey(k => k + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Feedback dos Dentistas</h3>
          <p className="text-sm text-muted-foreground">Sugestões, reclamações e elogios capturados automaticamente pelo Tutor IA</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <TrendsSection adminKey={adminKey} refreshKey={trendsRefreshKey} />

      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {[
          { value: "all", label: "Todos" },
          { value: "nova", label: "Novos" },
          { value: "lida", label: "Lidos" },
          { value: "arquivada", label: "Arquivados" },
        ].map(opt => (
          <Button
            key={opt.value}
            size="sm"
            variant={statusFilter === opt.value ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => changeFilter(opt.value)}
          >
            {opt.label}
            {opt.value === "nova" && data && data.novas > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                {data.novas}
              </span>
            )}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      )}

      {!loading && data && data.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">Nenhum feedback registrado ainda</p>
          <p className="text-muted-foreground/70 text-xs mt-1">Os feedbacks aparecem automaticamente quando os dentistas usam o Tutor IA</p>
        </div>
      )}

      {!loading && data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map(item => {
            const cfg = feedbackTypeConfig[item.type] ?? feedbackTypeConfig.outro;
            const isNew = item.status === "nova";
            const isExpanded = expanded === item.id;
            return (
              <Card key={item.id} className={`border transition-all ${isNew ? "border-blue-200 bg-blue-50/30 dark:bg-blue-950/10" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge variant="outline" className={`flex items-center gap-1 text-xs px-2 py-0.5 ${cfg.className}`}>
                          {cfg.icon} {cfg.label}
                        </Badge>
                        {isNew && (
                          <Badge variant="outline" className="text-xs px-2 py-0.5 bg-red-50 text-red-600 border-red-200">Nova</Badge>
                        )}
                        <span className="text-xs text-muted-foreground font-medium">{item.clinic_name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(item.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-sm font-medium leading-snug">{item.content}</p>
                      {item.original_message && (
                        <button
                          className="text-xs text-muted-foreground mt-1.5 hover:text-foreground transition-colors underline underline-offset-2"
                          onClick={() => setExpanded(isExpanded ? null : item.id)}
                        >
                          {isExpanded ? "Ocultar mensagem original" : "Ver mensagem original"}
                        </button>
                      )}
                      {isExpanded && (
                        <p className="text-xs text-muted-foreground mt-2 p-2.5 bg-gray-50 dark:bg-zinc-800/50 rounded-lg border italic">
                          "{item.original_message}"
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {item.status !== "lida" && item.status !== "arquivada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                          onClick={() => updateStatus(item.id, "lida")}
                        >
                          <CheckCheck className="w-3.5 h-3.5 mr-1" /> Lido
                        </Button>
                      )}
                      {item.status !== "arquivada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => updateStatus(item.id, "arquivada")}
                        >
                          <Archive className="w-3.5 h-3.5 mr-1" /> Arquivar
                        </Button>
                      )}
                      {item.status === "arquivada" && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Arquivado</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AiModesAuditTab({ adminKey }: { adminKey: string }) {
  const [days, setDays] = useState(7);
  const [tenantIdFilter, setTenantIdFilter] = useState("");
  const [modeFilter, setModeFilter] = useState<string>("");
  const [obeyedFilter, setObeyedFilter] = useState<string>("");
  const [summary, setSummary] = useState<Array<{ mode: string; total: number; obeyed: number; disobeyed: number; obeyRate: number }>>([]);
  const [rows, setRows] = useState<Array<{ id: number; tenantId: number; conversationId: number | null; contactPhoneMasked: string | null; mode: string; obeyed: boolean; violationTypes: string | null; retryUsed: boolean; fallbackUsed: boolean; modelUsed: string | null; intent: string | null; createdAt: string }>>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (tenantIdFilter) params.set("tenantId", tenantIdFilter);
      const sumRes = await adminFetch(`/audit/ai-modes/summary?${params}`, adminKey);
      if (sumRes.ok) {
        const data = await sumRes.json();
        setSummary(data.summary || []);
      }
      const rowParams = new URLSearchParams({ limit: "100", days: String(days) });
      if (tenantIdFilter) rowParams.set("tenantId", tenantIdFilter);
      if (modeFilter) rowParams.set("mode", modeFilter);
      if (obeyedFilter) rowParams.set("obeyed", obeyedFilter);
      const rowsRes = await adminFetch(`/audit/ai-modes?${rowParams}`, adminKey);
      if (rowsRes.ok) {
        const data = await rowsRes.json();
        setRows(data.rows || []);
      }
    } finally {
      setLoading(false);
    }
  }, [adminKey, days, tenantIdFilter, modeFilter, obeyedFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Auditoria de obediência por modo (últimos {days} dias)
          </CardTitle>
          <CardDescription>Cada resposta da IA é classificada em um dos 4 modos determinísticos. Mostra quantas obedeceram e quantas violaram regras.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Janela (dias)</Label>
              <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))} className="w-24" />
            </div>
            <div>
              <Label className="text-xs">Tenant ID (opcional)</Label>
              <Input value={tenantIdFilter} onChange={(e) => setTenantIdFilter(e.target.value)} placeholder="todos" className="w-32" />
            </div>
            <div>
              <Label className="text-xs">Modo</Label>
              <select className="border rounded h-9 px-2 text-sm" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
                <option value="">todos</option>
                <option value="CONVENIO_TRIAGEM">CONVENIO_TRIAGEM</option>
                <option value="CONVENIO_AGENDAR">CONVENIO_AGENDAR</option>
                <option value="PARTICULAR_SPIN">PARTICULAR_SPIN</option>
                <option value="PACIENTE_AGENDAR">PACIENTE_AGENDAR</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Obediência</Label>
              <select className="border rounded h-9 px-2 text-sm" value={obeyedFilter} onChange={(e) => setObeyedFilter(e.target.value)}>
                <option value="">todas</option>
                <option value="true">obedeceu</option>
                <option value="false">violou</option>
              </select>
            </div>
            <Button size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />Atualizar
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(["CONVENIO_TRIAGEM", "CONVENIO_AGENDAR", "PARTICULAR_SPIN", "PACIENTE_AGENDAR"] as const).map((m) => {
              const s = summary.find((x) => x.mode === m) || { total: 0, obeyed: 0, disobeyed: 0, obeyRate: 1 };
              const pct = s.total > 0 ? Math.round(s.obeyRate * 100) : 100;
              const color = pct >= 95 ? "text-emerald-600" : pct >= 85 ? "text-amber-600" : "text-rose-600";
              return (
                <Card key={m} className="border shadow-none">
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">{m}</div>
                    <div className={`text-2xl font-bold ${color}`}>{pct}%</div>
                    <div className="text-xs text-muted-foreground">{s.obeyed}/{s.total} obedeceram · {s.disobeyed} violaram</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Quando</th>
                  <th className="text-left p-2">Tenant</th>
                  <th className="text-left p-2">Conversa</th>
                  <th className="text-left p-2">Contato</th>
                  <th className="text-left p-2">Modo</th>
                  <th className="text-left p-2">Obed.</th>
                  <th className="text-left p-2">Retry</th>
                  <th className="text-left p-2">Fallback</th>
                  <th className="text-left p-2">Violações</th>
                  <th className="text-left p-2">Modelo</th>
                  <th className="text-left p-2">Intent</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">Sem registros no período/filtro selecionado.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString("pt-BR")}</td>
                    <td className="p-2">{r.tenantId}</td>
                    <td className="p-2">{r.conversationId ?? "-"}</td>
                    <td className="p-2">{r.contactPhoneMasked ?? "-"}</td>
                    <td className="p-2"><Badge variant="outline">{r.mode}</Badge></td>
                    <td className="p-2">{r.obeyed ? <Badge className="bg-emerald-100 text-emerald-800">OK</Badge> : <Badge className="bg-rose-100 text-rose-800">VIOLOU</Badge>}</td>
                    <td className="p-2 text-xs">{r.retryUsed ? <Badge variant="secondary">sim</Badge> : "-"}</td>
                    <td className="p-2 text-xs">{r.fallbackUsed ? <Badge className="bg-amber-100 text-amber-800">sim</Badge> : "-"}</td>
                    <td className="p-2 text-xs">{r.violationTypes || "-"}</td>
                    <td className="p-2 text-xs">{r.modelUsed ?? "-"}</td>
                    <td className="p-2 text-xs">{r.intent ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SendingMonitorRow {
  tenantId: number;
  tenantName: string;
  today: number;
  last7Days: number;
  status: "normal" | "atencao" | "limite";
}
interface SendingMonitorResponse {
  dailyLimit: number;
  tenants: SendingMonitorRow[];
}

interface AiLearningRow {
  id: number;
  tenantId: number;
  tenantName: string;
  question: string;
  answer: string;
  category: string;
  occurrences: number;
  createdAt: string;
  approvedAt: string | null;
}

function AiLearningCurationTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();
  const [approved, setApproved] = useState<AiLearningRow[]>([]);
  const [pending, setPending] = useState<AiLearningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes] = await Promise.all([
        adminFetch("/ai-learning/knowledge?status=approved", adminKey),
        adminFetch("/ai-learning/knowledge?status=pending", adminKey),
      ]);
      if (!aRes.ok) throw new Error(`Aprovados: HTTP ${aRes.status}`);
      if (!pRes.ok) throw new Error(`Pendentes: HTTP ${pRes.status}`);
      const aJson = await aRes.json();
      const pJson = await pRes.json();
      setApproved(aJson.items ?? []);
      setPending(pJson.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await adminFetch(`/ai-learning/knowledge/${id}`, adminKey, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApproved((rows) => rows.filter((r) => r.id !== id));
      setPending((rows) => rows.filter((r) => r.id !== id));
      toast({ title: "Removido", description: "Aprendizado excluído da base." });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao remover", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const renderTable = (rows: AiLearningRow[], emptyMsg: string) => (
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground py-4">{emptyMsg}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Clínica</th>
              <th className="p-2">Conhecimento</th>
              <th className="p-2 text-right">Ocorrências</th>
              <th className="p-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top">
                <td className="p-2 font-medium whitespace-nowrap">{r.tenantName}</td>
                <td className="p-2">
                  <div className="font-medium line-clamp-2">{r.question}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.answer}</div>
                </td>
                <td className="p-2 text-right tabular-nums">{r.occurrences}</td>
                <td className="p-2 text-right">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => remove(r.id)}
                    disabled={deletingId === r.id}
                  >
                    {deletingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-500" /> Aprovados Automaticamente — Últimos 30 dias
          </CardTitle>
          <CardDescription>
            Conhecimentos que a IA aprendeu sozinha (auto-aprovados por frequência) nos últimos 30 dias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
            : error ? <p className="text-sm text-red-500">Erro: {error}</p>
            : renderTable(approved, "Nenhum aprendizado aprovado nos últimos 30 dias.")}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-amber-500" /> Candidatos Pendentes
          </CardTitle>
          <CardDescription>
            Perguntas vistas algumas vezes que ainda não atingiram o limite para aprovação automática.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
            : error ? <p className="text-sm text-red-500">Erro: {error}</p>
            : renderTable(pending, "Nenhum candidato pendente.")}
        </CardContent>
      </Card>
    </div>
  );
}

function SendingMonitorTab({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<SendingMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await adminFetch("/sending-monitor", adminKey);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SendingMonitorResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [adminKey]);

  const statusBadge = (s: SendingMonitorRow["status"]) => {
    if (s === "limite") return <Badge className="bg-red-500/15 text-red-600 border-red-500/30">No limite</Badge>;
    if (s === "atencao") return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Próximo do limite</Badge>;
    return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Normal</Badge>;
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-500" /> Monitoramento de Envios
        </CardTitle>
        <CardDescription>
          Volume de mensagens automáticas enviadas por clínica. Limite diário sugerido: {data?.dailyLimit ?? 80} envios.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : error ? (
          <p className="text-sm text-red-500">Erro: {error}</p>
        ) : !data || data.tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Clínica</th>
                  <th className="p-2 text-right">Hoje</th>
                  <th className="p-2 text-right">Últimos 7 dias</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((t) => (
                  <tr key={t.tenantId} className="border-b last:border-0">
                    <td className="p-2 font-medium">{t.tenantName}</td>
                    <td className="p-2 text-right tabular-nums">{t.today} / {data.dailyLimit}</td>
                    <td className="p-2 text-right tabular-nums">{t.last7Days}</td>
                    <td className="p-2">{statusBadge(t.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type PlatformAlertRow = {
  id: number;
  service: string;
  kind: "down" | "recovery" | "degraded";
  severity: "critical" | "warning" | "info";
  message: string;
  error: string | null;
  createdAt: string;
  dismissedAt: string | null;
};

function AlertsTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<PlatformAlertRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; active: number; critical: number }>({ total: 0, active: 0, critical: 0 });
  const [onlyActive, setOnlyActive] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/alerts${onlyActive ? "?active=1" : ""}`, adminKey);
      const data = await res.json();
      setAlerts(data.alerts ?? []);
      setSummary(data.summary ?? { total: 0, active: 0, critical: 0 });
    } catch {
      toast({ title: "Erro ao carregar alertas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [adminKey, onlyActive, toast]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const dismiss = async (id: number) => {
    await adminFetch(`/alerts/${id}/dismiss`, adminKey, { method: "POST" });
    await load();
  };
  const dismissAll = async () => {
    await adminFetch(`/alerts/dismiss-all`, adminKey, { method: "POST" });
    await load();
  };

  const sevColor = (s: string) =>
    s === "critical" ? "bg-red-100 text-red-700 border-red-200"
    : s === "warning" ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-emerald-100 text-emerald-700 border-emerald-200";

  const kindLabel = (k: string) =>
    k === "down" ? "Fora do ar" : k === "recovery" ? "Recuperado" : "Degradado";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <KpiCard icon={AlertTriangle} label="Ativos" value={summary.active} color="bg-gradient-to-br from-amber-500 to-amber-600" />
        <KpiCard icon={AlertCircle} label="Críticos ativos" value={summary.critical} color="bg-gradient-to-br from-red-500 to-red-600" />
        <KpiCard icon={Activity} label="Últimas 24h" value={summary.total} color="bg-gradient-to-br from-blue-500 to-blue-600" />
      </div>

      <Card className="border-0 shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Alertas da Plataforma
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setOnlyActive((v) => !v)}>
                {onlyActive ? "Mostrar histórico" : "Só ativos"}
              </Button>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                Atualizar
              </Button>
              {summary.active > 0 && (
                <Button variant="default" size="sm" onClick={dismissAll}>
                  Marcar tudo como visto
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhum alerta {onlyActive ? "ativo" : "registrado"}.
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg border bg-white dark:bg-zinc-900">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-xs ${sevColor(a.severity)}`}>{a.severity}</Badge>
                      <Badge variant="outline" className="text-xs">{kindLabel(a.kind)}</Badge>
                      <span className="text-xs text-muted-foreground">{a.service}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("pt-BR")}</span>
                      {a.dismissedAt && <Badge variant="secondary" className="text-xs">visto</Badge>}
                    </div>
                    <div className="text-sm mt-1">{a.message}</div>
                    {a.error && (
                      <div className="text-xs font-mono text-red-600 mt-1 break-all">{a.error}</div>
                    )}
                  </div>
                  {!a.dismissedAt && (
                    <Button variant="ghost" size="sm" onClick={() => dismiss(a.id)}>
                      Marcar como visto
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const { toast } = useToast();
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("admin_key") || "");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<TenantDetail | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [creditsTenantId, setCreditsTenantId] = useState<number | null>(null);
  const [creditsTenantName, setCreditsTenantName] = useState("");
  const [creditsAmount, setCreditsAmount] = useState("");
  const [creditsDescription, setCreditsDescription] = useState("");
  const [creditsLoading, setCreditsLoading] = useState(false);

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusTenantId, setStatusTenantId] = useState<number | null>(null);
  const [statusTenantName, setStatusTenantName] = useState("");
  const [statusAction, setStatusAction] = useState<"active" | "cancelled">("active");

  const [activatePlanOpen, setActivatePlanOpen] = useState(false);
  const [activatePlanTenantId, setActivatePlanTenantId] = useState<number | null>(null);
  const [activatePlanTenantName, setActivatePlanTenantName] = useState("");
  const [activatePlanCurrent, setActivatePlanCurrent] = useState<string>("basic");
  const [activatePlanChoice, setActivatePlanChoice] = useState<string>("essencial");
  const [activatePlanDuration, setActivatePlanDuration] = useState<string>("30");
  const [activatePlanResetDate, setActivatePlanResetDate] = useState<boolean>(true);
  const [activatePlanLoading, setActivatePlanLoading] = useState(false);

  type RefundRow = {
    id: number;
    tenantId: number;
    tenantName: string | null;
    clinicName: string | null;
    tenantEmail: string | null;
    planAtRequest: string;
    referenceDate: string;
    daysSinceReference: number;
    withinSevenDayWindow: boolean;
    status: string;
    reasonText: string | null;
    amountBrl: number | null;
    requestedAt: string;
    processedAt: string | null;
    adminNotes: string | null;
    externalRefundId: string | null;
    externalProvider: string | null;
  };
  const [refundList, setRefundList] = useState<RefundRow[]>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundActionId, setRefundActionId] = useState<number | null>(null);
  const [refundNotes, setRefundNotes] = useState("");
  const [refundExternalId, setRefundExternalId] = useState("");
  const [refundProvider, setRefundProvider] = useState("");
  const [refundActionDialogOpen, setRefundActionDialogOpen] = useState(false);
  const [refundActionMode, setRefundActionMode] = useState<"process" | "deny">("process");

  const [audioSummaries, setAudioSummaries] = useState<AudioCreditSummary[]>([]);
  const [audioTransactions, setAudioTransactions] = useState<AudioCreditTx[]>([]);
  const [audioShowHistory, setAudioShowHistory] = useState(false);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [audioSelectedTenant, setAudioSelectedTenant] = useState<{ id: number; name: string } | null>(null);
  const [audioAmount, setAudioAmount] = useState("");
  const [audioDescription, setAudioDescription] = useState("");
  const [feedbackNovas, setFeedbackNovas] = useState(0);

  const loadDashboard = useCallback(async (key: string) => {
    const res = await adminFetch("/dashboard", key);
    // Qualquer status não-OK (401 chave faltando, 403 chave inválida, 5xx,
    // etc.) deve abortar — antes só 403 abortava, e o corpo de erro 401
    // (`{error:...}`) era tratado como dashboard válido, causando crash em
    // `formatCurrency(undefined)` ao renderizar os KPIs.
    if (!res.ok) throw new Error(`Dashboard load failed: ${res.status}`);
    return res.json();
  }, []);

  const loadTenants = useCallback(async (key: string) => {
    const res = await adminFetch("/tenants", key);
    if (!res.ok) throw new Error(`Tenants load failed: ${res.status}`);
    return res.json();
  }, []);

  const loadAudioCredits = useCallback(async (k: string) => {
    const [sumRes, txRes] = await Promise.all([
      audioFetch("/credits/all", k),
      audioFetch("/credits/transactions/all", k),
    ]);
    // Auth inválida (401/403) deve propagar para o handler central em
    // loadAll, que limpa a sessão e força re-login. Outros não-OK ficam
    // silenciosos para não derrubar o painel por falha pontual de subdados.
    if (sumRes.status === 401 || sumRes.status === 403 || txRes.status === 401 || txRes.status === 403) {
      console.warn("[admin] audio credits auth rejected", { sumStatus: sumRes.status, txStatus: txRes.status });
      throw new Error(`Audio credits auth failed: ${sumRes.status}/${txRes.status}`);
    }
    if (sumRes.ok) {
      const data = await sumRes.json();
      setAudioSummaries(Array.isArray(data) ? data : []);
    }
    if (txRes.ok) {
      const data = await txRes.json();
      setAudioTransactions(Array.isArray(data) ? data : []);
    }
  }, []);

  const loadFeedbackCount = useCallback(async (k: string) => {
    const res = await adminFetch("/feedback", k);
    if (res.status === 401 || res.status === 403) {
      console.warn("[admin] feedback auth rejected", { status: res.status });
      throw new Error(`Feedback auth failed: ${res.status}`);
    }
    if (res.ok) {
      try {
        const data = await res.json() as { novas: number };
        setFeedbackNovas(data.novas);
      } catch { /* non-fatal */ }
    }
  }, []);

  const loadAll = useCallback(async (key?: string) => {
    const k = key || adminKey;
    setLoading(true);
    try {
      // Aguardamos os 4 loaders para que qualquer 401/403 (em qualquer
      // endpoint admin, não só /dashboard ou /tenants) propague ao catch
      // central abaixo, limpando a sessão e forçando re-login.
      const [dash, tenantsList] = await Promise.all([
        loadDashboard(k),
        loadTenants(k),
        loadAudioCredits(k),
        loadFeedbackCount(k),
      ]);
      setDashboard(dash);
      // Defensivo: se a API retornar erro/objeto em vez de array, evita
      // crash em `tenants.filter` no render.
      setTenants(Array.isArray(tenantsList) ? tenantsList : []);
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
      setDashboard(null);
      setTenants([]);
      sessionStorage.removeItem("admin_key");
      toast({ title: "Acesso negado", description: "Chave administrativa inválida ou expirada — digite novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [adminKey, loadDashboard, loadTenants, loadAudioCredits, loadFeedbackCount, toast]);

  const handleAddAudioCredits = async () => {
    if (!audioSelectedTenant || !audioAmount) return;
    try {
      const res = await audioFetch("/credits/add", adminKey, {
        method: "POST",
        body: JSON.stringify({
          tenantId: audioSelectedTenant.id,
          amount: Number(audioAmount),
          description: audioDescription || "Créditos adicionados via admin",
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `${Number(audioAmount).toLocaleString("pt-BR")} créditos adicionados para ${audioSelectedTenant.name}` });
      setAudioDialogOpen(false);
      setAudioAmount("");
      setAudioDescription("");
      loadAudioCredits(adminKey);
    } catch {
      toast({ title: "Erro ao adicionar créditos", variant: "destructive" });
    }
  };

  const loadRefunds = useCallback(async (key?: string) => {
    const k = key || adminKey;
    setRefundLoading(true);
    try {
      const res = await adminFetch("/refunds", k);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRefundList(Array.isArray(data) ? data : []);
    } catch {
      setRefundList([]);
    } finally {
      setRefundLoading(false);
    }
  }, [adminKey]);

  const openActivatePlan = (tenantId: number, tenantName: string, currentPlan: string) => {
    setActivatePlanTenantId(tenantId);
    setActivatePlanTenantName(tenantName);
    setActivatePlanCurrent(currentPlan);
    setActivatePlanChoice(currentPlan && currentPlan !== "trial" && currentPlan !== "basic" ? currentPlan : "essencial");
    setActivatePlanDuration("30");
    setActivatePlanResetDate(true);
    setActivatePlanOpen(true);
  };

  const handleActivatePlan = async () => {
    if (!activatePlanTenantId) return;
    setActivatePlanLoading(true);
    try {
      const res = await adminFetch(`/tenants/${activatePlanTenantId}/activate-plan`, adminKey, {
        method: "POST",
        body: JSON.stringify({
          plan: activatePlanChoice,
          durationDays: Number(activatePlanDuration) || 30,
          resetSubscribedAt: activatePlanResetDate,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Plano ativado!", description: `${activatePlanTenantName} está agora no plano ${activatePlanChoice}.` });
      setActivatePlanOpen(false);
      await loadAll();
    } catch {
      toast({ title: "Erro", description: "Falha ao ativar o plano.", variant: "destructive" });
    } finally {
      setActivatePlanLoading(false);
    }
  };

  const openRefundAction = (id: number, mode: "process" | "deny") => {
    setRefundActionId(id);
    setRefundActionMode(mode);
    setRefundNotes("");
    setRefundExternalId("");
    setRefundProvider("");
    setRefundActionDialogOpen(true);
  };

  const handleRefundAction = async () => {
    if (!refundActionId) return;
    try {
      const path = refundActionMode === "process"
        ? `/refunds/${refundActionId}/process`
        : `/refunds/${refundActionId}/deny`;
      const body = refundActionMode === "process"
        ? { adminNotes: refundNotes, externalRefundId: refundExternalId, externalProvider: refundProvider }
        : { adminNotes: refundNotes };
      const res = await adminFetch(path, adminKey, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: refundActionMode === "process" ? "Reembolso marcado como processado" : "Reembolso negado" });
      setRefundActionDialogOpen(false);
      await loadRefunds();
    } catch {
      toast({ title: "Erro", description: "Falha ao atualizar reembolso.", variant: "destructive" });
    }
  };

  const handleLogin = async () => {
    sessionStorage.setItem("admin_key", adminKey);
    await loadAll(adminKey);
    loadRefunds(adminKey);
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setAdminKey("");
    sessionStorage.removeItem("admin_key");
  };

  useEffect(() => {
    // Só auto-carrega se já existe chave salva na sessão; senão evita
    // disparar o toast de "chave inválida" no primeiro acesso.
    if (!authenticated && adminKey) {
      loadAll(adminKey);
    }
  }, []);

  const openTenantDetail = async (tenantId: number) => {
    try {
      const res = await adminFetch(`/tenants/${tenantId}`, adminKey);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSelectedTenant(data);
      setDetailDialogOpen(true);
    } catch {
      toast({ title: "Erro", description: "Falha ao carregar detalhes.", variant: "destructive" });
    }
  };

  const openCreditsDialog = (tenantId: number, tenantName: string) => {
    setCreditsTenantId(tenantId);
    setCreditsTenantName(tenantName);
    setCreditsAmount("");
    setCreditsDescription("");
    setCreditsDialogOpen(true);
  };

  const handleAddCredits = async () => {
    if (!creditsTenantId || !creditsAmount) return;
    setCreditsLoading(true);
    try {
      const res = await adminFetch(`/tenants/${creditsTenantId}/credits`, adminKey, {
        method: "POST",
        body: JSON.stringify({ amount: Number(creditsAmount), description: creditsDescription || "Créditos adicionados pelo admin" }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast({ title: "Créditos adicionados!", description: `Novo saldo: ${data.balance.toLocaleString("pt-BR")} caracteres` });
      setCreditsDialogOpen(false);
      await loadAll();
    } catch {
      toast({ title: "Erro", description: "Falha ao adicionar créditos.", variant: "destructive" });
    } finally {
      setCreditsLoading(false);
    }
  };

  const openStatusDialog = (tenantId: number, tenantName: string, action: "active" | "cancelled") => {
    setStatusTenantId(tenantId);
    setStatusTenantName(tenantName);
    setStatusAction(action);
    setStatusDialogOpen(true);
  };

  const handleStatusChange = async () => {
    if (!statusTenantId) return;
    try {
      const res = await adminFetch(`/tenants/${statusTenantId}`, adminKey, {
        method: "PATCH",
        body: JSON.stringify({ subscriptionStatus: statusAction }),
      });
      if (!res.ok) throw new Error();
      toast({ title: statusAction === "active" ? "Clínica ativada!" : "Clínica desativada!", description: `${statusTenantName} foi ${statusAction === "active" ? "ativada" : "desativada"} com sucesso.` });
      setStatusDialogOpen(false);
      await loadAll();
    } catch {
      toast({ title: "Erro", description: "Falha ao alterar status.", variant: "destructive" });
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 shadow-2xl">
          <CardHeader className="text-center pb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-xl">Painel Administrativo</CardTitle>
            <CardDescription>Acesso restrito ao proprietário do sistema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Chave Administrativa</Label>
              <Input
                type="password"
                placeholder="Digite a chave de acesso..."
                value={adminKey}
                onChange={e => setAdminKey(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
              />
            </div>
            <Button className="w-full" onClick={handleLogin} disabled={loading}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              {loading ? "Verificando..." : "Entrar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredTenants = (Array.isArray(tenants) ? tenants : []).filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.clinicName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Painel Administrativo</h1>
            <p className="text-sm text-muted-foreground">Gestão de clínicas e receita do sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAll()}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-1.5" />
            Sair
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="w-full overflow-x-auto scrollbar-thin">
          <TabsList className="inline-flex w-max h-auto">
            <TabsTrigger value="dashboard" className="gap-1.5 whitespace-nowrap shrink-0">
              <BarChart3 className="w-3.5 h-3.5" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="tenants" className="gap-1.5 whitespace-nowrap shrink-0">
              <Building2 className="w-3.5 h-3.5" /> Clínicas
            </TabsTrigger>
            <TabsTrigger value="creditos" className="gap-1.5 whitespace-nowrap shrink-0">
              <Coins className="w-3.5 h-3.5" /> Créditos Áudio
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="gap-1.5 whitespace-nowrap shrink-0">
              <Activity className="w-3.5 h-3.5" /> Monitoramento
            </TabsTrigger>
            <TabsTrigger value="envios" className="gap-1.5 whitespace-nowrap shrink-0">
              <MessageSquare className="w-3.5 h-3.5" /> Envios
            </TabsTrigger>
            <TabsTrigger value="churn" className="gap-1.5 whitespace-nowrap shrink-0">
              <Users className="w-3.5 h-3.5" /> Assinaturas
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5 whitespace-nowrap shrink-0" data-testid="tab-alerts">
              <AlertTriangle className="w-3.5 h-3.5" /> Alertas
            </TabsTrigger>
            <TabsTrigger value="informacoes" className="gap-1.5 whitespace-nowrap shrink-0">
              <Sparkles className="w-3.5 h-3.5" /> Informações
            </TabsTrigger>
            <TabsTrigger value="feedback" className="gap-1.5 whitespace-nowrap shrink-0">
              <MessageSquare className="w-3.5 h-3.5" /> Feedback
              {feedbackNovas > 0 && (
                <span className="ml-0.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold leading-none">
                  {feedbackNovas}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="lgpd" className="gap-1.5 whitespace-nowrap shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" /> LGPD
            </TabsTrigger>
            <TabsTrigger value="ai-modes" className="gap-1.5 whitespace-nowrap shrink-0" data-testid="tab-ai-modes">
              <Sparkles className="w-3.5 h-3.5" /> Modos IA
            </TabsTrigger>
            <TabsTrigger value="ai-learning" className="gap-1.5 whitespace-nowrap shrink-0" data-testid="tab-ai-learning">
              <Brain className="w-3.5 h-3.5" /> Aprendizados IA
            </TabsTrigger>
            <TabsTrigger value="ai-cost" className="gap-1.5 whitespace-nowrap shrink-0" data-testid="tab-ai-cost">
              <Coins className="w-3.5 h-3.5" /> Custos IA
            </TabsTrigger>
            <TabsTrigger value="simulador" className="gap-1.5 whitespace-nowrap shrink-0" data-testid="tab-simulador">
              <FlaskConical className="w-3.5 h-3.5" /> Simulador
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="mt-6 space-y-6">
          {dashboard && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Building2} label="Total de Clínicas" value={dashboard.totalTenants} color="bg-gradient-to-br from-blue-500 to-blue-600" />
                <KpiCard icon={CheckCircle2} label="Ativas" value={dashboard.activeTenants} sub={`${dashboard.cancelledTenants} canceladas`} color="bg-gradient-to-br from-emerald-500 to-emerald-600" />
                <KpiCard icon={UserPlus} label="Novas no Período" value={dashboard.newInPeriod} sub={`${dashboard.cancelledInPeriod} cancelaram`} color="bg-gradient-to-br from-violet-500 to-violet-600" />
                <KpiCard icon={TrendingUp} label="Receita no Período" value={formatCurrency(dashboard.totalRevenue)} color="bg-gradient-to-br from-amber-500 to-amber-600" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Users} label="Total Pacientes" value={formatNumber(dashboard.totalPatients)} color="bg-gradient-to-br from-cyan-500 to-cyan-600" />
                <KpiCard icon={Target} label="Total Leads" value={formatNumber(dashboard.totalLeads)} color="bg-gradient-to-br from-pink-500 to-pink-600" />
                <KpiCard icon={Zap} label="Créditos Carregados" value={formatNumber(dashboard.creditsAdded)} sub="caracteres no período" color="bg-gradient-to-br from-indigo-500 to-indigo-600" />
                <KpiCard icon={Activity} label="Créditos Consumidos" value={formatNumber(dashboard.creditsConsumed)} sub="caracteres no período" color="bg-gradient-to-br from-rose-500 to-rose-600" />
              </div>

              <AiStatusCard adminKey={adminKey} />

              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="w-4 h-4 text-amber-500" /> Distribuição por Plano
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(dashboard.planCounts).map(([plan, count]) => (
                      <div key={plan} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-zinc-800/60 border">
                        <Badge className={`text-xs ${planColors[plan] || planColors.basic}`}>
                          {planLabels[plan] || plan}
                        </Badge>
                        <span className="text-lg font-bold">{count}</span>
                        <span className="text-xs text-muted-foreground">
                          {dashboard.totalTenants > 0 ? `(${Math.round(count / dashboard.totalTenants * 100)}%)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="tenants" className="mt-6 space-y-4">
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Undo2 className="w-4 h-4 text-amber-500" /> Solicitações de reembolso
                  {refundList.filter(r => r.status === "pending").length > 0 && (
                    <Badge className="bg-amber-500 text-white">{refundList.filter(r => r.status === "pending").length} pendente(s)</Badge>
                  )}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => loadRefunds()}>
                  <RefreshCw className={`w-4 h-4 mr-1.5 ${refundLoading ? "animate-spin" : ""}`} /> Atualizar
                </Button>
              </div>
              <CardDescription>Solicitações com checagem automática da janela de 7 dias (CDC art. 49). O reembolso real precisa ser feito no painel da empresa de pagamento.</CardDescription>
            </CardHeader>
            <CardContent>
              {refundList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma solicitação registrada</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Clínica</TableHead>
                        <TableHead className="text-xs">Plano</TableHead>
                        <TableHead className="text-xs text-right">Valor</TableHead>
                        <TableHead className="text-xs text-center">Dias</TableHead>
                        <TableHead className="text-xs text-center">Janela 7d</TableHead>
                        <TableHead className="text-xs">Pedido em</TableHead>
                        <TableHead className="text-xs">Motivo</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refundList.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs font-medium">{r.clinicName || r.tenantName || `#${r.tenantId}`}</TableCell>
                          <TableCell><Badge className={`text-xs ${planColors[r.planAtRequest] || planColors.basic}`}>{planLabels[r.planAtRequest] || r.planAtRequest}</Badge></TableCell>
                          <TableCell className="text-xs text-right font-mono">{r.amountBrl ? formatCurrency(r.amountBrl) : "—"}</TableCell>
                          <TableCell className="text-xs text-center font-mono">{r.daysSinceReference}</TableCell>
                          <TableCell className="text-xs text-center">
                            {r.withinSevenDayWindow
                              ? <Badge className="bg-emerald-100 text-emerald-700 text-xs">Sim</Badge>
                              : <Badge className="bg-red-100 text-red-700 text-xs">Não</Badge>}
                          </TableCell>
                          <TableCell className="text-xs">{formatDate(r.requestedAt)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={r.reasonText || ""}>{r.reasonText || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${
                              r.status === "pending" ? "text-amber-600 border-amber-200" :
                              r.status === "processed" ? "text-emerald-600 border-emerald-200" :
                              r.status === "denied" ? "text-red-500 border-red-200" :
                              "text-muted-foreground"
                            }`}>{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {r.status === "pending" ? (
                              <div className="flex items-center gap-1.5 justify-end">
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600" onClick={() => openRefundAction(r.id, "process")} title="Marcar como processado">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-red-500" onClick={() => openRefundAction(r.id, "deny")} title="Negar">
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{r.processedAt ? formatDate(r.processedAt) : "—"}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Buscar clínica..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Badge variant="outline" className="text-xs">
              {filteredTenants.length} clínica{filteredTenants.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <Card className="border-0 shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50 dark:bg-zinc-800/30">
                    <TableHead className="font-semibold">Clínica</TableHead>
                    <TableHead className="font-semibold">Plano</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold text-center">Pacientes</TableHead>
                    <TableHead className="font-semibold text-center">Leads</TableHead>
                    <TableHead className="font-semibold text-center">Áudio / Mês</TableHead>
                    <TableHead className="font-semibold text-center">Recarga áudio</TableHead>
                    <TableHead className="font-semibold text-center">Conversas / Mês</TableHead>
                    <TableHead className="font-semibold text-center">Recarga conv.</TableHead>
                    <TableHead className="font-semibold">Desde</TableHead>
                    <TableHead className="font-semibold text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTenants.map(t => (
                    <TableRow key={t.id} className="group">
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{t.clinicName}</p>
                          <p className="text-xs text-muted-foreground">{t.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${planColors[t.plan] || planColors.basic}`}>
                          {planLabels[t.plan] || t.plan}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.subscriptionStatus === "active" ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Ativo
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs gap-1">
                            <XCircle className="w-3 h-3" /> Cancelado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-medium">{t.patientCount}</TableCell>
                      <TableCell className="text-center font-medium">{t.leadCount}</TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const used = Math.round((t.monthlyCharsUsed ?? 0) / 1000);
                          const pct = Math.min(100, Math.round(((t.monthlyCharsUsed ?? 0) / 20000) * 100));
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <span className="font-mono text-xs font-medium">{used}/20 min</span>
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-violet-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-xs font-medium">{Math.round(t.creditBalance / 1000)} min</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const used = t.monthlyConversationsUsed ?? 0;
                          const limit = Math.max(0, t.monthlyConversationsLimit ?? 0);
                          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : (used > 0 ? 100 : 0);
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <span className="font-mono text-xs font-medium">{used}/{limit}</span>
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-violet-500"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-xs font-medium">{t.conversationRechargeBalance ?? 0}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(t.subscribedAt || t.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1.5 justify-end opacity-70 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openTenantDetail(t.id)} title="Ver detalhes">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-violet-600" onClick={() => openCreditsDialog(t.id, t.clinicName)} title="Carregar créditos">
                            <Coins className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600" onClick={() => openActivatePlan(t.id, t.clinicName, t.plan)} title="Ativar plano">
                            <Rocket className="w-3.5 h-3.5" />
                          </Button>
                          {t.subscriptionStatus === "active" ? (
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-red-500" onClick={() => openStatusDialog(t.id, t.clinicName, "cancelled")} title="Desativar">
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600" onClick={() => openStatusDialog(t.id, t.clinicName, "active")} title="Ativar">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredTenants.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? "Nenhuma clínica encontrada" : "Nenhuma clínica cadastrada"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="creditos" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Créditos de Áudio IA</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Gerencie os créditos de voz por clínica (1 crédito = 1 caractere de áudio)</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAudioShowHistory(!audioShowHistory)} className="gap-1.5">
              <History className="w-3.5 h-3.5" />
              {audioShowHistory ? "Ver Saldos" : "Histórico"}
            </Button>
          </div>

          {!audioShowHistory ? (
            <Card className="border-0 shadow-md overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/50 dark:bg-zinc-800/30">
                      <TableHead className="font-semibold">Clínica</TableHead>
                      <TableHead className="font-semibold text-right">Saldo</TableHead>
                      <TableHead className="font-semibold text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audioSummaries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground text-sm">Nenhuma clínica cadastrada</TableCell>
                      </TableRow>
                    ) : audioSummaries.map((s) => (
                      <TableRow key={s.tenantId} className="group">
                        <TableCell className="font-medium">{s.tenantName}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={s.balance > 1000 ? "default" : s.balance > 0 ? "secondary" : "destructive"} className="font-mono">
                            {s.balance.toLocaleString("pt-BR")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="gap-1.5 opacity-70 group-hover:opacity-100" onClick={() => {
                            setAudioSelectedTenant({ id: s.tenantId, name: s.tenantName });
                            setAudioAmount("");
                            setAudioDescription("Créditos adicionados via admin");
                            setAudioDialogOpen(true);
                          }}>
                            <Plus className="w-3.5 h-3.5" /> Adicionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" /> Histórico Global de Créditos
                </CardTitle>
              </CardHeader>
              <CardContent>
                {audioTransactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma transação registrada</p>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto space-y-1">
                    {audioTransactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{tx.description || (tx.type === "add" ? "Créditos adicionados" : "Consumo TTS")}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {audioSummaries.find(s => s.tenantId === tx.tenantId)?.tenantName || `Clínica #${tx.tenantId}`} · {new Date(tx.createdAt).toLocaleString("pt-BR")}
                          </p>
                        </div>
                        <span className={`text-sm font-mono font-medium ${tx.type === "add" ? "text-emerald-500" : "text-red-400"}`}>
                          {tx.type === "add" ? "+" : "-"}{Math.abs(tx.amount).toLocaleString("pt-BR")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-6">
          <MonitoringTab />
        </TabsContent>

        <TabsContent value="alerts" className="mt-6">
          <AlertsTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="envios" className="mt-6">
          <SendingMonitorTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="churn" className="mt-6">
          <ChurnTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="informacoes" className="mt-6">
          <InsightsTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="feedback" className="mt-6">
          <FeedbackTab adminKey={adminKey} onNovasChange={setFeedbackNovas} />
        </TabsContent>

        <TabsContent value="ai-modes" className="mt-6">
          <AiModesAuditTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="ai-learning" className="mt-6">
          <AiLearningCurationTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="lgpd" className="mt-6">
          <AdminLgpdTab tenants={tenants} adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="ai-cost" className="mt-6">
          <AdminAiCostTab adminKey={adminKey} />
        </TabsContent>

        <TabsContent value="simulador" className="mt-6">
          <SimulatorPage />
        </TabsContent>
      </Tabs>

      <Dialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-violet-500" />
              Adicionar Créditos — {audioSelectedTenant?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Quantidade de Créditos</Label>
              <Input
                type="number"
                value={audioAmount}
                onChange={(e) => setAudioAmount(e.target.value)}
                placeholder="Ex: 10000"
                min="1"
                onKeyDown={(e) => e.key === "Enter" && handleAddAudioCredits()}
              />
              <p className="text-[11px] text-muted-foreground">1 crédito = 1 caractere de áudio gerado</p>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={audioDescription}
                onChange={(e) => setAudioDescription(e.target.value)}
                placeholder="Motivo da adição"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAudioDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddAudioCredits} disabled={!audioAmount || Number(audioAmount) <= 0}>
              Adicionar {audioAmount ? Number(audioAmount).toLocaleString("pt-BR") : 0} créditos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedTenant && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-500" />
                  {selectedTenant.clinicName}
                </DialogTitle>
                <DialogDescription>
                  Detalhes da clínica #{selectedTenant.id} — {selectedTenant.slug}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Plano</p>
                  <Badge className={`mt-1 text-xs ${planColors[selectedTenant.plan] || planColors.basic}`}>
                    {planLabels[selectedTenant.plan] || selectedTenant.plan}
                  </Badge>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className={`text-sm font-semibold mt-1 ${selectedTenant.subscriptionStatus === "active" ? "text-emerald-600" : "text-red-500"}`}>
                    {selectedTenant.subscriptionStatus === "active" ? "Ativo" : "Cancelado"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">WhatsApp</p>
                  <p className={`text-sm font-semibold mt-1 ${selectedTenant.whatsappConnected === "true" ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {selectedTenant.whatsappConnected === "true" ? "Conectado" : "Desconectado"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Pacientes</p>
                  <p className="text-lg font-bold mt-0.5">{selectedTenant.patientCount}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Leads</p>
                  <p className="text-lg font-bold mt-0.5">{selectedTenant.leadCount}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Créditos Audio</p>
                  <p className="text-lg font-bold mt-0.5 text-violet-600">{selectedTenant.creditBalance.toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Consultas</p>
                  <p className="text-lg font-bold mt-0.5">{selectedTenant.totalAppointments}</p>
                  <p className="text-xs text-muted-foreground">{selectedTenant.completedAppointments} finalizadas</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Receita Total</p>
                  <p className="text-lg font-bold mt-0.5 text-emerald-600">{formatCurrency(selectedTenant.totalRevenue)}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Desde</p>
                  <p className="text-sm font-semibold mt-1">{formatDate(selectedTenant.subscribedAt || selectedTenant.createdAt)}</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800/40 border">
                  <p className="text-xs text-muted-foreground">Max Profissionais</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min={1}
                      className="h-7 w-16 text-sm font-bold"
                      defaultValue={selectedTenant.maxProfessionals}
                      onBlur={async (e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!val || val < 1 || val === selectedTenant.maxProfessionals) return;
                        try {
                          await adminFetch(`/tenants/${selectedTenant.id}`, adminKey, {
                            method: "PATCH",
                            body: JSON.stringify({ maxProfessionals: val }),
                          });
                          setSelectedTenant({ ...selectedTenant, maxProfessionals: val });
                          toast({ title: `Max profissionais atualizado para ${val}` });
                          await loadAll();
                        } catch {
                          toast({ title: "Erro ao atualizar", variant: "destructive" });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {selectedTenant.clinicPhone && (
                <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                  <Phone className="w-4 h-4" /> {selectedTenant.clinicPhone}
                </div>
              )}

              <Separator className="my-4" />

              <div className="flex items-center gap-2 mb-3">
                <Coins className="w-4 h-4 text-violet-500" />
                <p className="font-medium text-sm">Últimas transações de crédito</p>
              </div>

              {selectedTenant.recentTransactions.length > 0 ? (
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs text-right">Qtd</TableHead>
                        <TableHead className="text-xs">Descrição</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedTenant.recentTransactions.map(tx => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-xs">{formatDate(tx.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${tx.type === "add" ? "text-emerald-600 border-emerald-200" : "text-red-500 border-red-200"}`}>
                              {tx.type === "add" ? "Adição" : "Consumo"}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-xs text-right font-mono font-medium ${tx.type === "add" ? "text-emerald-600" : "text-red-500"}`}>
                            {tx.type === "add" ? "+" : ""}{tx.amount.toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{tx.description || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma transação registrada</p>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={() => { setDetailDialogOpen(false); openCreditsDialog(selectedTenant.id, selectedTenant.clinicName); }}>
                  <Coins className="w-4 h-4 mr-1.5 text-violet-500" /> Carregar Créditos
                </Button>
                {selectedTenant.subscriptionStatus === "active" ? (
                  <Button variant="outline" size="sm" className="text-red-500 border-red-200" onClick={() => { setDetailDialogOpen(false); openStatusDialog(selectedTenant.id, selectedTenant.clinicName, "cancelled"); }}>
                    <Ban className="w-4 h-4 mr-1.5" /> Desativar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="text-emerald-600 border-emerald-200" onClick={() => { setDetailDialogOpen(false); openStatusDialog(selectedTenant.id, selectedTenant.clinicName, "active"); }}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Ativar
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={creditsDialogOpen} onOpenChange={setCreditsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-violet-500" /> Carregar Créditos ElevenLabs
            </DialogTitle>
            <DialogDescription>
              Adicionar créditos de áudio para <strong>{creditsTenantName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Quantidade (caracteres)</Label>
              <Input
                type="number"
                placeholder="Ex: 50000"
                value={creditsAmount}
                onChange={e => setCreditsAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input
                placeholder="Ex: Recarga mensal"
                value={creditsDescription}
                onChange={e => setCreditsDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddCredits} disabled={creditsLoading || !creditsAmount || Number(creditsAmount) <= 0}>
              {creditsLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Adicionar Créditos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {statusAction === "cancelled" ? (
                <><Ban className="w-5 h-5 text-red-500" /> Desativar Clínica</>
              ) : (
                <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Ativar Clínica</>
              )}
            </DialogTitle>
            <DialogDescription>
              {statusAction === "cancelled"
                ? `Tem certeza que deseja desativar a clínica "${statusTenantName}"? O acesso será limitado.`
                : `Deseja reativar a clínica "${statusTenantName}"? O acesso completo será restaurado.`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancelar</Button>
            <Button
              variant={statusAction === "cancelled" ? "destructive" : "default"}
              onClick={handleStatusChange}
            >
              {statusAction === "cancelled" ? "Confirmar Desativação" : "Confirmar Ativação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activatePlanOpen} onOpenChange={setActivatePlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-blue-500" /> Ativar plano
            </DialogTitle>
            <DialogDescription>
              Ativar/trocar plano de <strong>{activatePlanTenantName}</strong>. Plano atual: <Badge className={`text-xs ml-1 ${planColors[activatePlanCurrent] || planColors.basic}`}>{planLabels[activatePlanCurrent] || activatePlanCurrent}</Badge>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Plano</Label>
              <Select value={activatePlanChoice} onValueChange={setActivatePlanChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Básico — R$ 197/mês (R$ 97 com desconto)</SelectItem>
                  <SelectItem value="essencial">Essencial — R$ 297/mês (R$ 197 com desconto)</SelectItem>
                  <SelectItem value="pro">Pro — R$ 447/mês</SelectItem>
                  <SelectItem value="trial">Trial (gratuito)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Duração (dias)</Label>
              <Input
                type="number"
                min={1}
                value={activatePlanDuration}
                onChange={e => setActivatePlanDuration(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Define a data de vencimento da assinatura. Padrão: 30 dias.</p>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="reset-subscribed-at"
                type="checkbox"
                checked={activatePlanResetDate}
                onChange={e => setActivatePlanResetDate(e.target.checked)}
                className="mt-1"
              />
              <Label htmlFor="reset-subscribed-at" className="cursor-pointer leading-tight">
                Reiniciar a data de início (recomendado quando confirmar pagamento agora — também reinicia a janela de 7 dias para reembolso)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivatePlanOpen(false)} disabled={activatePlanLoading}>Cancelar</Button>
            <Button onClick={handleActivatePlan} disabled={activatePlanLoading}>
              {activatePlanLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
              Ativar plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundActionDialogOpen} onOpenChange={setRefundActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {refundActionMode === "process" ? (
                <><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Marcar reembolso como processado</>
              ) : (
                <><XCircle className="w-5 h-5 text-red-500" /> Negar reembolso</>
              )}
            </DialogTitle>
            <DialogDescription>
              {refundActionMode === "process"
                ? "Confirme depois de fazer o estorno no painel da empresa de pagamento. Você pode anotar o ID do estorno para auditoria."
                : "Negue se a solicitação não atende às condições. Anote o motivo para auditoria."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {refundActionMode === "process" && (
              <>
                <div>
                  <Label>Empresa de pagamento (opcional)</Label>
                  <Input placeholder="Ex: stripe, mercadopago, pagseguro..." value={refundProvider} onChange={e => setRefundProvider(e.target.value)} />
                </div>
                <div>
                  <Label>ID do estorno na empresa (opcional)</Label>
                  <Input placeholder="Ex: re_1NXY..." value={refundExternalId} onChange={e => setRefundExternalId(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Label>Anotações internas</Label>
              <Input placeholder="Anotação para auditoria" value={refundNotes} onChange={e => setRefundNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundActionDialogOpen(false)}>Cancelar</Button>
            <Button
              variant={refundActionMode === "deny" ? "destructive" : "default"}
              onClick={handleRefundAction}
            >
              {refundActionMode === "process" ? "Confirmar processamento" : "Confirmar negação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
