import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneCall, PhoneOff, PhoneMissed, Phone, Clock, Calendar,
  RefreshCw, Play, FileText, Loader2, Plus, User, PhoneIncoming, PhoneOutgoing,
} from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CallLog {
  id: number;
  vapiCallId: string | null;
  phone: string;
  direction: string;
  status: string;
  trigger: string | null;
  duration: number | null;
  outcome: string | null;
  answeredByHuman: boolean | null;
  endedReason: string | null;
  summary: string | null;
  cost: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  leadName: string | null;
  patientName: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const statusConfig: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  initiated: { label: "Iniciada", icon: Phone, color: "text-blue-500" },
  ringing: { label: "Chamando", icon: PhoneCall, color: "text-amber-500" },
  in_progress: { label: "Em andamento", icon: PhoneCall, color: "text-green-500" },
  completed: { label: "Concluída", icon: Phone, color: "text-emerald-500" },
  failed: { label: "Falhou", icon: PhoneOff, color: "text-destructive" },
};

const outcomeConfig: Record<string, { label: string; color: string }> = {
  completed: { label: "Concluída", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  voicemail: { label: "Caixa postal", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  no_answer: { label: "Sem resposta", color: "bg-muted text-muted-foreground" },
  busy: { label: "Ocupado", color: "bg-muted text-muted-foreground" },
  failed: { label: "Falhou", color: "bg-destructive/10 text-destructive" },
};

const triggerLabels: Record<string, string> = {
  hot_lead_followup: "Lead Quente",
  appointment_confirmation: "Confirmação",
  patient_recovery: "Recuperação",
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CallStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, icon: Phone, color: "text-muted-foreground" };
  const Icon = config.icon;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${config.color}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function ManualCallDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [trigger, setTrigger] = useState("hot_lead_followup");
  const [patientName, setPatientName] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/dental/calls/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ phone, trigger, patientName: patientName || undefined }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error || "Erro ao iniciar chamada");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Chamada iniciada com sucesso!" });
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-primary" />
            Iniciar Ligação Manual
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Telefone (com DDI)</Label>
            <Input
              placeholder="+5511999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de Ligação</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hot_lead_followup">Follow-up de Lead Quente</SelectItem>
                <SelectItem value="appointment_confirmation">Confirmação de Consulta</SelectItem>
                <SelectItem value="patient_recovery">Recuperação de Paciente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nome do paciente (opcional)</Label>
            <Input
              placeholder="Ex: Maria"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !phone || !trigger}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PhoneCall className="w-4 h-4 mr-2" />}
            Ligar agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryDialog({ call, open, onClose }: { call: CallLog | null; open: boolean; onClose: () => void }) {
  if (!call) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalhes da Ligação</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground text-xs">Telefone</p>
              <p className="font-medium">{call.phone}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Duração</p>
              <p className="font-medium">{formatDuration(call.duration)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Status</p>
              <CallStatusBadge status={call.status} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Motivo do fim</p>
              <p className="font-medium">{call.endedReason || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Custo</p>
              <p className="font-medium">{call.cost ? `$${call.cost}` : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Data</p>
              <p className="font-medium">{formatDate(call.createdAt)}</p>
            </div>
          </div>
          {call.summary && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Resumo</p>
              <p className="text-sm">{call.summary}</p>
            </div>
          )}
          {call.vapiCallId && (
            <p className="text-xs text-muted-foreground">ID: {call.vapiCallId}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CallsPage() {
  const [page, setPage] = useState(1);
  const [directionFilter, setDirectionFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);

  const { data, isLoading, refetch } = useQuery<{ data: CallLog[]; pagination: Pagination }>({
    queryKey: ["calls", page, directionFilter],
    queryFn: async () => {
      const dirParam = directionFilter !== "all" ? `&direction=${directionFilter}` : "";
      const res = await fetch(`${BASE}/api/dental/calls?page=${page}&limit=20${dirParam}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Erro ao carregar ligações");
      return res.json();
    },
  });

  const calls = data?.data || [];
  const pagination = data?.pagination;

  const stats = {
    total: pagination?.total || 0,
    completed: calls.filter((c) => c.outcome === "completed").length,
    answered: calls.filter((c) => c.answeredByHuman).length,
    avgDuration: calls.length
      ? Math.round(calls.filter((c) => c.duration).reduce((acc, c) => acc + (c.duration || 0), 0) / (calls.filter((c) => c.duration).length || 1))
      : 0,
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Ligações IA</h1>
          <p className="text-sm text-muted-foreground mt-1">Histórico e controle das chamadas feitas pela secretária virtual</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={() => setManualDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Ligar agora
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total de ligações", value: stats.total, icon: PhoneCall, color: "text-blue-500" },
          { label: "Atendidas", value: stats.answered, icon: Phone, color: "text-emerald-500" },
          { label: "Concluídas", value: stats.completed, icon: PhoneCall, color: "text-green-500" },
          { label: "Duração média", value: formatDuration(stats.avgDuration), icon: Clock, color: "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Histórico de Ligações</CardTitle>
          <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v as "all" | "inbound" | "outbound"); setPage(1); }}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as ligações</SelectItem>
              <SelectItem value="inbound">Recebidas</SelectItem>
              <SelectItem value="outbound">Realizadas</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <PhoneMissed className="w-12 h-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground font-medium">Nenhuma ligação ainda</p>
              <p className="text-sm text-muted-foreground">Configure o Vapi em Configurações → Ligações IA para começar</p>
            </div>
          ) : (
            <div className="divide-y">
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setSelectedCall(call)}
                >
                  <div className="flex-shrink-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${call.direction === "inbound" ? "bg-blue-500/10" : "bg-muted"}`}>
                      {call.direction === "inbound" ? (
                        <PhoneIncoming className="w-4 h-4 text-blue-500" />
                      ) : call.direction === "outbound" ? (
                        <PhoneOutgoing className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <User className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {call.leadName || call.patientName || call.phone}
                      </p>
                      {call.direction === "inbound" && (
                        <Badge variant="secondary" className="text-[10px] h-4 shrink-0 bg-blue-500/15 text-blue-700 dark:text-blue-300">
                          Recebida
                        </Badge>
                      )}
                      {call.trigger && call.direction !== "inbound" && (
                        <Badge variant="outline" className="text-[10px] h-4 shrink-0">
                          {triggerLabels[call.trigger] || call.trigger}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {call.phone} · {formatDate(call.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <CallStatusBadge status={call.status} />
                    {call.outcome && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${outcomeConfig[call.outcome]?.color || "bg-muted text-muted-foreground"}`}>
                        {outcomeConfig[call.outcome]?.label || call.outcome}
                      </span>
                    )}
                    {call.duration && (
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDuration(call.duration)}
                      </span>
                    )}
                  </div>
                  {call.summary && (
                    <FileText className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}

          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <p className="text-xs text-muted-foreground">
                {pagination.total} ligações no total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próximo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ManualCallDialog
        open={manualDialogOpen}
        onClose={() => setManualDialogOpen(false)}
        onSuccess={() => refetch()}
      />

      <SummaryDialog
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
      />
    </div>
  );
}
