import { useState, useMemo } from "react";
import {
  useListAppointments, useCreateAppointment, useUpdateAppointment,
  useDeleteAppointment, useListPatients, useListProcedures,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, CalendarDays, Clock, Trash2, CheckCircle2, XCircle,
  AlertCircle, List, ChevronLeft, ChevronRight, User, Pencil,
} from "lucide-react";
import { useProfessionals, type Professional } from "@/components/professionals-tab";

interface AptRecord {
  id: number;
  patientId: number;
  patientName?: string;
  professionalId?: number | null;
  professionalName?: string;
  procedureId?: number | null;
  procedureName?: string;
  status: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  price?: string;
  pixPaymentStatus?: string | null;
}

const statusConfig: Record<string, { label: string; color: string; calColor: string; icon: React.ElementType }> = {
  scheduled: {
    label: "Agendado",
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    calColor: "bg-blue-500/15 border-l-2 border-blue-500 text-blue-700 dark:text-blue-300",
    icon: CalendarDays,
  },
  confirmed: {
    label: "Confirmado",
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    calColor: "bg-emerald-500/15 border-l-2 border-emerald-500 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  completed: {
    label: "Concluido",
    color: "bg-primary/10 text-primary border-primary/20",
    calColor: "bg-primary/10 border-l-2 border-primary text-primary",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelado",
    color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
    calColor: "bg-red-500/10 border-l-2 border-red-400 text-red-600 dark:text-red-400 opacity-60",
    icon: XCircle,
  },
  no_show: {
    label: "Nao compareceu",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    calColor: "bg-orange-500/10 border-l-2 border-orange-400 text-orange-600 opacity-70",
    icon: AlertCircle,
  },
};


function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7:00 to 18:00

function WeekCalendar({
  appointments,
  weekStart,
  onAppointmentClick,
}: {
  appointments: AptRecord[];
  weekStart: Date;
  onAppointmentClick: (apt: AptRecord) => void;
}) {
  const days = getWeekDays(weekStart);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const DAY_NAMES_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

  function aptsByDay(day: Date): AptRecord[] {
    return appointments.filter((a) => {
      const d = new Date(a.startsAt);
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate()
      );
    });
  }

  function minutesFromMidnight(dateStr: string): number {
    const d = new Date(dateStr);
    return d.getHours() * 60 + d.getMinutes();
  }

  const SLOT_H = 56;
  const GRID_START_MIN = 7 * 60;
  const GRID_END_MIN = 19 * 60;
  const TOTAL_MIN = GRID_END_MIN - GRID_START_MIN;
  const GRID_H = HOURS.length * SLOT_H;

  return (
    <div className="overflow-auto">
      <div className="min-w-[700px]">
        <div className="flex">
          <div className="w-14 flex-shrink-0" />
          {days.map((day, i) => {
            const isToday = day.getTime() === today.getTime();
            return (
              <div key={i} className="flex-1 text-center pb-2 border-b border-border/40">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? "text-primary" : "text-muted-foreground/60"}`}>
                  {DAY_NAMES_SHORT[day.getDay()]}
                </p>
                <div className={`mx-auto w-7 h-7 rounded-full flex items-center justify-center mt-1 text-[13px] font-bold ${
                  isToday ? "bg-primary text-white shadow-md shadow-primary/30" : "text-foreground/80"
                }`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex relative" style={{ height: GRID_H }}>
          <div className="w-14 flex-shrink-0 relative">
            {HOURS.map((h, i) => (
              <div key={h} className="absolute right-2 text-[10px] text-muted-foreground/50 font-medium" style={{ top: i * SLOT_H - 6 }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((day, di) => {
            const dayApts = aptsByDay(day);
            const isToday = day.getTime() === today.getTime();
            return (
              <div key={di} className={`flex-1 relative border-l border-border/30 ${isToday ? "bg-primary/[0.02]" : ""}`}>
                {HOURS.map((_, hi) => (
                  <div key={hi} className="absolute w-full border-t border-border/20" style={{ top: hi * SLOT_H }} />
                ))}
                {dayApts.map((apt) => {
                  const startMin = minutesFromMidnight(apt.startsAt);
                  const endMin = minutesFromMidnight(apt.endsAt);
                  const clampedStart = Math.max(startMin, GRID_START_MIN);
                  const clampedEnd = Math.min(endMin, GRID_END_MIN);
                  if (clampedEnd <= clampedStart) return null;
                  const topPct = ((clampedStart - GRID_START_MIN) / TOTAL_MIN) * GRID_H;
                  const heightPct = Math.max(((clampedEnd - clampedStart) / TOTAL_MIN) * GRID_H, 22);
                  const cfg = statusConfig[apt.status] || statusConfig.scheduled;
                  return (
                    <button
                      key={apt.id}
                      onClick={() => onAppointmentClick(apt)}
                      className={`absolute left-1 right-1 rounded-md px-1.5 py-1 text-left overflow-hidden transition-all hover:opacity-90 hover:shadow-md ${cfg.calColor}`}
                      style={{ top: topPct, height: heightPct }}
                    >
                      <p className="text-[10px] font-bold truncate leading-tight">
                        {new Date(apt.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {heightPct > 30 && (
                        <p className="text-[10px] truncate font-medium opacity-90 leading-tight mt-0.5">
                          {apt.patientName || `Paciente #${apt.patientId}`}
                        </p>
                      )}
                      {heightPct > 44 && apt.procedureName && (
                        <p className="text-[9px] truncate opacity-70 leading-tight">
                          {apt.procedureName}
                        </p>
                      )}
                      {heightPct > 56 && apt.professionalName && (
                        <p className="text-[9px] truncate opacity-60 leading-tight">
                          {apt.professionalName}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppointmentDetailDialog({
  apt,
  open,
  onClose,
  onStatusChange,
  onPixConfirm,
  onDelete,
  onEdit,
}: {
  apt: AptRecord | null;
  open: boolean;
  onClose: () => void;
  onStatusChange: (id: number, status: string) => void;
  onPixConfirm: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (apt: AptRecord) => void;
}) {
  if (!apt) return null;
  const cfg = statusConfig[apt.status] || statusConfig.scheduled;
  const StatusIcon = cfg.icon;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Detalhes da Consulta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl premium-icon-box flex items-center justify-center flex-shrink-0">
              <CalendarDays className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-bold text-[14px]">{apt.patientName || `Paciente #${apt.patientId}`}</p>
              <p className="text-[12px] text-muted-foreground">{apt.procedureName || "Procedimento"}</p>
              {apt.professionalName && (
                <p className="text-[11px] text-primary/70 font-medium mt-0.5 flex items-center gap-1">
                  <User className="w-3 h-3" /> {apt.professionalName}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="premium-card rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground/60 uppercase font-bold mb-1">Data</p>
              <p className="text-[13px] font-semibold">{new Date(apt.startsAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</p>
            </div>
            <div className="premium-card rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground/60 uppercase font-bold mb-1">Horário</p>
              <p className="text-[13px] font-semibold">
                {new Date(apt.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(apt.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`${cfg.color} border gap-1`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
              {apt.pixPaymentStatus === "pending" && (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700 gap-1 text-[10px]">
                  <span className="font-bold">PIX</span> Aguardando pagamento
                </Badge>
              )}
              {apt.pixPaymentStatus === "confirmed_auto" && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 gap-1 text-[10px]">
                  <CheckCircle2 className="w-3 h-3" /> PIX confirmado pela IA
                </Badge>
              )}
              {apt.pixPaymentStatus === "confirmed_manual" && (
                <Badge variant="outline" className="bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700 gap-1 text-[10px]">
                  <CheckCircle2 className="w-3 h-3" /> PIX confirmado manualmente
                </Badge>
              )}
              {apt.pixPaymentStatus === "confirmed" && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 gap-1 text-[10px]">
                  <CheckCircle2 className="w-3 h-3" /> PIX Confirmado
                </Badge>
              )}
            </div>
            <Badge variant="secondary" className="font-mono text-xs">
              R$ {Number(apt.price || 0).toLocaleString("pt-BR")}
            </Badge>
          </div>
          {apt.notes && (
            <div className="premium-card rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground/60 uppercase font-bold mb-1">Observações</p>
              <p className="text-[13px]">{apt.notes}</p>
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {apt.status === "scheduled" && (
            <Button variant="outline" size="sm" onClick={() => { onStatusChange(apt.id, "confirmed"); onClose(); }}>
              Confirmar
            </Button>
          )}
          {apt.pixPaymentStatus === "pending" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              onClick={() => { onPixConfirm(apt.id); onClose(); }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar PIX manualmente
            </Button>
          )}
          {apt.status === "confirmed" && (
            <Button variant="outline" size="sm" onClick={() => { onStatusChange(apt.id, "completed"); onClose(); }}>
              Concluir
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { onEdit(apt); onClose(); }}
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => { onDelete(apt.id); onClose(); }}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Excluir
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AppointmentsPage() {
  const [viewMode, setViewMode] = useState<"list" | "week">("week");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailApt, setDetailApt] = useState<AptRecord | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [form, setForm] = useState({ patientId: "", procedureId: "", professionalId: "", startsAt: "", notes: "", durationMinutes: "" });
  const [profFilter, setProfFilter] = useState<string>("all");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: aptsData, isLoading } = useListAppointments(
    statusFilter !== "all" ? { status: statusFilter } : {}
  );
  const { data: patientsData } = useListPatients();
  const { data: proceduresData } = useListProcedures();
  const { data: professionalsData } = useProfessionals();
  const createMut = useCreateAppointment();
  const updateMut = useUpdateAppointment();
  const deleteMut = useDeleteAppointment();

  const allAppointments: AptRecord[] = useMemo(
    () => (aptsData as AptRecord[] | undefined) || [],
    [aptsData]
  );
  const appointments = useMemo(
    () => profFilter === "all" ? allAppointments : allAppointments.filter((a) => String(a.professionalId) === profFilter),
    [allAppointments, profFilter]
  );
  const patients = (patientsData as { data?: Array<{ id: number; name: string }> })?.data || [];
  const procedures = (proceduresData as Array<{ id: number; name: string; durationMinutes?: number }>) || [];
  const professionals = professionalsData?.professionals?.filter((p) => p.isActive) || [];

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [weekStart]);

  const weekAppointments = useMemo(
    () => appointments.filter((a) => {
      const d = new Date(a.startsAt);
      return d >= weekStart && d <= weekEnd;
    }),
    [appointments, weekStart, weekEnd]
  );

  function prevWeek() {
    setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; });
  }
  function nextWeek() {
    setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; });
  }
  function goToday() {
    setWeekStart(startOfWeek(new Date()));
  }

  function formatDatetimeLocal(dateStr: string): string {
    const d = new Date(dateStr);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openCreate() {
    setForm({ patientId: "", procedureId: "", professionalId: professionals.length === 1 ? String(professionals[0].id) : "", startsAt: "", notes: "", durationMinutes: "" });
    setEditId(null);
    setDialogOpen(true);
  }

  function snapDuration(minutes: number): string {
    const options = [15, 20, 30, 45, 60, 90, 120];
    const clamped = Math.max(15, minutes);
    const nearest = options.reduce((prev, curr) =>
      Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
    );
    return String(nearest);
  }

  function openEdit(apt: AptRecord) {
    const durationMs = new Date(apt.endsAt).getTime() - new Date(apt.startsAt).getTime();
    const rawMinutes = Math.max(Math.round(durationMs / 60000), 15);
    setForm({
      patientId: String(apt.patientId),
      procedureId: apt.procedureId ? String(apt.procedureId) : "",
      professionalId: apt.professionalId ? String(apt.professionalId) : "",
      startsAt: formatDatetimeLocal(apt.startsAt),
      notes: apt.notes || "",
      durationMinutes: snapDuration(rawMinutes),
    });
    setEditId(apt.id);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    const durationMs = (form.durationMinutes ? Number(form.durationMinutes) : 60) * 60 * 1000;
    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(startsAt.getTime() + durationMs);
    const basePayload = {
      patientId: Number(form.patientId),
      procedureId: Number(form.procedureId),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      price: "0" as string | null,
      notes: form.notes || undefined,
    };
    try {
      if (editId) {
        const updatePayload = {
          ...basePayload,
          ...(form.professionalId ? { professionalId: Number(form.professionalId) } : { professionalId: null }),
        };
        await updateMut.mutateAsync({ appointmentId: editId, data: updatePayload });
        toast({ title: "Consulta atualizada" });
      } else {
        const createPayload = {
          ...basePayload,
          ...(form.professionalId ? { professionalId: Number(form.professionalId) } : {}),
        };
        await createMut.mutateAsync({ data: createPayload });
        toast({ title: "Consulta agendada" });
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/dental/appointments"] });
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleStatusChange(id: number, status: string) {
    try {
      await updateMut.mutateAsync({ appointmentId: id, data: { status } });
      toast({ title: `Status atualizado para ${statusConfig[status]?.label || status}` });
      qc.invalidateQueries({ queryKey: ["/api/dental/appointments"] });
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handlePixConfirm(id: number) {
    try {
      const endpoint = `/api/dental/appointments/${id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed", pixPaymentStatus: "confirmed_manual" }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Pagamento PIX confirmado manualmente" });
      qc.invalidateQueries({ queryKey: ["/api/dental/appointments"] });
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir esta consulta?")) return;
    try {
      await deleteMut.mutateAsync({ appointmentId: id });
      toast({ title: "Consulta excluida" });
      qc.invalidateQueries({ queryKey: ["/api/dental/appointments"] });
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  const weekLabel = useMemo(() => {
    const days = getWeekDays(weekStart);
    const first = days[0];
    const last = days[6];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} ${first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
    }
    return `${first.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${last.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  }, [weekStart]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Agenda</h1>
          <p className="text-[12px] text-muted-foreground/60 font-medium mt-1">{appointments.length} consultas no total</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {professionals.length > 0 && (
            <Select value={profFilter} onValueChange={setProfFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs rounded-lg">
                <User className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Profissional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {professionals.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/40">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={`h-7 px-2.5 text-[11px] font-semibold rounded-md gap-1.5 ${viewMode === "list" ? "shadow-sm" : ""}`}
            >
              <List className="w-3.5 h-3.5" /> Lista
            </Button>
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("week")}
              className={`h-7 px-2.5 text-[11px] font-semibold rounded-md gap-1.5 ${viewMode === "week" ? "shadow-sm" : ""}`}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Semana
            </Button>
          </div>
          <Button onClick={openCreate} className="gap-2 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all h-9 px-4">
            <Plus className="w-4 h-4" />
            Nova Consulta
          </Button>
        </div>
      </div>

      {viewMode === "week" && (
        <div className="premium-card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={prevWeek}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={nextWeek}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <p className="text-[13px] font-semibold capitalize">{weekLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{weekAppointments.length} consultas</Badge>
              <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-lg" onClick={goToday}>Hoje</Button>
            </div>
          </div>
          <div className="p-3">
            {isLoading ? (
              <Skeleton className="h-[500px] rounded-xl" />
            ) : (
              <WeekCalendar
                appointments={appointments}
                weekStart={weekStart}
                onAppointmentClick={(apt) => setDetailApt(apt)}
              />
            )}
          </div>
        </div>
      )}

      {viewMode === "list" && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { value: "all", label: "Todas" },
              { value: "scheduled", label: "Agendadas" },
              { value: "confirmed", label: "Confirmadas" },
              { value: "completed", label: "Concluidas" },
              { value: "cancelled", label: "Canceladas" },
              { value: "no_show", label: "Não compareceu" },
            ].map((f) => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.value)}
                className={`text-[11px] font-semibold rounded-lg h-8 px-3 transition-all duration-300 ${statusFilter === f.value ? "shadow-md shadow-primary/20" : ""}`}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
          ) : (
            <div className="space-y-3">
              {appointments.map((apt) => {
                const config = statusConfig[apt.status] || statusConfig.scheduled;
                const StatusIcon = config.icon;
                return (
                  <Card key={apt.id} className="premium-card-glow rounded-xl overflow-hidden cursor-pointer" onClick={() => setDetailApt(apt)}>
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-3.5 flex-1 min-w-0">
                          <div className="w-12 h-14 rounded-xl premium-icon-box flex flex-col items-center justify-center flex-shrink-0">
                            <span className="text-sm font-extrabold text-primary number-display leading-none">
                              {new Date(apt.startsAt).toLocaleDateString("pt-BR", { day: "2-digit" })}
                            </span>
                            <span className="text-[9px] text-primary/60 uppercase font-bold tracking-wider mt-0.5">
                              {new Date(apt.startsAt).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[13px] truncate">{apt.patientName || `Paciente #${apt.patientId}`}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] text-muted-foreground/70 font-medium">{apt.procedureName || "Procedimento"}</p>
                              {apt.professionalName && (
                                <Badge variant="secondary" className="text-[9px] gap-1 px-1.5 py-0">
                                  <User className="w-2.5 h-2.5" />
                                  {apt.professionalName}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 font-medium bg-muted/40 px-2 py-0.5 rounded-md">
                                <Clock className="w-3 h-3" />
                                {new Date(apt.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                {" – "}
                                {new Date(apt.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap" onClick={(e) => e.stopPropagation()}>
                          <Badge variant="outline" className={`${config.color} border text-xs gap-1`}>
                            <StatusIcon className="w-3 h-3" />
                            {config.label}
                          </Badge>
                          {apt.pixPaymentStatus === "pending" && (
                            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700 gap-1 text-[10px]">
                              <span className="font-bold">PIX</span> Pendente
                            </Badge>
                          )}
                          {apt.pixPaymentStatus === "confirmed_auto" && (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 gap-1 text-[10px]">
                              <CheckCircle2 className="w-2.5 h-2.5" /> PIX (IA)
                            </Badge>
                          )}
                          {apt.pixPaymentStatus === "confirmed_manual" && (
                            <Badge variant="outline" className="bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700 gap-1 text-[10px]">
                              <CheckCircle2 className="w-2.5 h-2.5" /> PIX (Manual)
                            </Badge>
                          )}
                          {apt.pixPaymentStatus === "confirmed" && (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 gap-1 text-[10px]">
                              <CheckCircle2 className="w-2.5 h-2.5" /> PIX
                            </Badge>
                          )}
                          <Badge variant="secondary" className="font-mono text-xs">
                            R$ {Number(apt.price || 0).toLocaleString("pt-BR")}
                          </Badge>
                          <div className="flex gap-1">
                            {apt.status === "scheduled" && (
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(apt.id, "confirmed")}>
                                Confirmar
                              </Button>
                            )}
                            {apt.pixPaymentStatus === "pending" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                onClick={() => handlePixConfirm(apt.id)}
                              >
                                <CheckCircle2 className="w-3 h-3" /> PIX ok
                              </Button>
                            )}
                            {apt.status === "confirmed" && (
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleStatusChange(apt.id, "completed")}>
                                Concluir
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(apt.id)}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {appointments.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhuma consulta encontrada</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <AppointmentDetailDialog
        apt={detailApt}
        open={!!detailApt}
        onClose={() => setDetailApt(null)}
        onStatusChange={handleStatusChange}
        onPixConfirm={handlePixConfirm}
        onDelete={handleDelete}
        onEdit={openEdit}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Consulta" : "Nova Consulta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Paciente *</Label>
              <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione o paciente" /></SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Procedimento *</Label>
              <Select
                value={form.procedureId}
                onValueChange={(v) => {
                  const proc = procedures.find((p) => String(p.id) === v);
                  const autoMinutes = proc?.durationMinutes ? String(proc.durationMinutes) : form.durationMinutes;
                  setForm({ ...form, procedureId: v, durationMinutes: autoMinutes });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o procedimento" /></SelectTrigger>
                <SelectContent>
                  {procedures.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}{p.durationMinutes ? ` (${p.durationMinutes}min)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {professionals.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  Profissional
                </Label>
                <Select value={form.professionalId || "none"} onValueChange={(v) => setForm({ ...form, professionalId: v === "none" ? "" : v })}>
                  <SelectTrigger className="rounded-xl h-10"><SelectValue placeholder="Selecione o profissional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem profissional</SelectItem>
                    {professionals.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Duração do Atendimento
              </Label>
              <Select
                value={form.durationMinutes || "60"}
                onValueChange={(v) => setForm({ ...form, durationMinutes: v })}
              >
                <SelectTrigger className="rounded-xl h-10">
                  <SelectValue placeholder="Selecione a duração" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutos</SelectItem>
                  <SelectItem value="20">20 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="45">45 minutos</SelectItem>
                  <SelectItem value="60">60 minutos (1h)</SelectItem>
                  <SelectItem value="90">90 minutos (1h30)</SelectItem>
                  <SelectItem value="120">120 minutos (2h)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data e Hora *</Label>
              <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="rounded-xl h-10" />
            </div>
            <div className="space-y-2">
              <Label>Observacoes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre a consulta" className="rounded-xl h-10" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.patientId || !form.procedureId || !form.startsAt}
              className="rounded-xl shadow-md shadow-primary/20"
            >
              {editId ? "Salvar" : "Agendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

