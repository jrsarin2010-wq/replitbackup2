import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAppointments } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock, Coffee, GraduationCap, Heart, DollarSign, CalendarDays,
  Search, User, Stethoscope,
  CalendarCheck2, ChevronRight, Star,
} from "lucide-react";

const DAY_LABELS: Record<string, string> = {
  "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui", "5": "Sex", "6": "Sáb",
};

const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-blue-500 to-indigo-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-sky-600",
  "from-fuchsia-500 to-violet-600",
  "from-lime-500 to-green-600",
];

interface Professional {
  id: number;
  tenantId: number;
  name: string;
  specialty: string | null;
  specialties: string | null;
  cro: string | null;
  workingDays: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  lunchStart: string;
  lunchEnd: string;
  slotDurationMinutes: number;
  acceptsInsurance: boolean;
  consultationFee: string | null;
  isOwner: boolean;
  isActive: boolean;
}

interface AptRecord {
  id: number;
  professionalId: number | null;
  patientId: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  procedureName: string | null;
  notes: string | null;
  pixPaymentStatus?: string | null;
}

function useProfessionalsData() {
  return useQuery<{ professionals: Professional[]; maxProfessionals: number }>({
    queryKey: ["/api/dental/professionals", "active"],
    queryFn: async () => {
      const res = await fetch("/api/dental/professionals?includeInactive=false");
      if (!res.ok) throw new Error("Erro ao carregar profissionais");
      return res.json();
    },
  });
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function getSpecialtiesList(prof: Professional): string[] {
  const raw = prof.specialties || prof.specialty || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatFee(fee: string | null): string | null {
  if (!fee) return null;
  const num = parseFloat(fee.replace(",", "."));
  if (isNaN(num)) return fee;
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isThisWeek(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return d >= startOfWeek && d <= endOfWeek;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function WorkingDaysBadges({ days, compact }: { days: string; compact?: boolean }) {
  const activeDays = days.split(",").map((d) => d.trim());
  return (
    <div className="flex gap-1 flex-wrap">
      {["0", "1", "2", "3", "4", "5", "6"].map((d) => {
        const active = activeDays.includes(d);
        if (compact && !active) return null;
        return (
          <span
            key={d}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-colors ${
              active
                ? "bg-primary/15 text-primary"
                : "bg-muted/40 text-muted-foreground/30"
            }`}
          >
            {DAY_LABELS[d]}
          </span>
        );
      })}
    </div>
  );
}

function ProfessionalAvatar({ name, index, size = "lg" }: { name: string; index: number; size?: "sm" | "lg" | "xl" }) {
  const gradient = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const sizeClasses = {
    sm: "w-9 h-9 text-[13px]",
    lg: "w-14 h-14 text-lg",
    xl: "w-20 h-20 text-2xl",
  };
  return (
    <div className={`${sizeClasses[size]} rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-white shadow-lg ring-2 ring-white/20 flex-shrink-0`}>
      {getInitials(name)}
    </div>
  );
}

function AppointmentRow({ apt }: { apt: AptRecord }) {
  const statusColors: Record<string, string> = {
    scheduled: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    completed: "bg-muted/60 text-muted-foreground border-border/40",
    cancelled: "bg-red-500/10 text-red-500 border-red-500/20",
    no_show: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  };
  const statusLabels: Record<string, string> = {
    scheduled: "Agendado",
    confirmed: "Confirmado",
    completed: "Realizado",
    cancelled: "Cancelado",
    no_show: "Faltou",
  };
  const color = statusColors[apt.status] || statusColors.scheduled;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/60 hover:bg-card transition-colors">
      <div className="flex flex-col items-center min-w-[44px] text-center">
        <span className="text-xs font-bold text-primary">{formatTime(apt.startsAt)}</span>
        <span className="text-[10px] text-muted-foreground/50">{formatTime(apt.endsAt)}</span>
      </div>
      <div className="w-px h-8 bg-border/50" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate text-foreground/90">
          {apt.procedureName || "Consulta"}
        </p>
        {apt.notes && (
          <p className="text-[11px] text-muted-foreground/60 truncate">{apt.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
          {statusLabels[apt.status] || apt.status}
        </span>
        {apt.pixPaymentStatus === "pending" && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-yellow-500/10 text-yellow-700 border-yellow-400/40">
            PIX?
          </span>
        )}
        {(apt.pixPaymentStatus === "confirmed_auto" || apt.pixPaymentStatus === "confirmed") && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 border-emerald-400/40">
            PIX✓
          </span>
        )}
        {apt.pixPaymentStatus === "confirmed_manual" && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-teal-500/10 text-teal-600 border-teal-400/40">
            PIX✓M
          </span>
        )}
      </div>
    </div>
  );
}

function ProfessionalSheet({
  professional,
  index,
  open,
  onClose,
  appointments,
}: {
  professional: Professional;
  index: number;
  open: boolean;
  onClose: () => void;
  appointments: AptRecord[];
}) {
  const specialties = getSpecialtiesList(professional);
  const fee = formatFee(professional.consultationFee);

  const todayApts = useMemo(
    () => appointments
      .filter((a) => a.professionalId === professional.id && isToday(a.startsAt) && a.status !== "cancelled")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [appointments, professional.id]
  );

  const weekApts = useMemo(
    () => appointments.filter((a) => a.professionalId === professional.id && isThisWeek(a.startsAt) && a.status !== "cancelled"),
    [appointments, professional.id]
  );

  const upcomingApts = useMemo(() => {
    const now = new Date();
    return appointments
      .filter((a) =>
        a.professionalId === professional.id &&
        new Date(a.startsAt) > now &&
        a.status !== "cancelled"
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 5);
  }, [appointments, professional.id]);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-card to-muted/30 border-b border-border/40 p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-transparent" />
          <SheetHeader className="relative">
            <div className="flex items-start gap-4 mb-4">
              <ProfessionalAvatar name={professional.name} index={index} size="xl" />
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-2 mb-1">
                  {professional.isOwner && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <Star className="w-2.5 h-2.5" /> Titular
                    </span>
                  )}
                </div>
                <SheetTitle className="text-xl font-bold text-foreground leading-tight">
                  {professional.name}
                </SheetTitle>
                {professional.cro && (
                  <p className="text-[12px] text-muted-foreground mt-0.5 font-medium">{professional.cro}</p>
                )}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {specialties.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-lg">
                      <GraduationCap className="w-2.5 h-2.5" /> {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Hoje", value: todayApts.length, icon: CalendarCheck2, color: "text-blue-600" },
                { label: "Esta semana", value: weekApts.length, icon: CalendarDays, color: "text-emerald-600" },
                { label: "Slot (min)", value: professional.slotDurationMinutes, icon: Clock, color: "text-violet-600" },
              ].map((stat) => (
                <div key={stat.label} className="bg-background/60 rounded-xl p-3 text-center border border-border/40">
                  <stat.icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
                  <p className="text-lg font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </SheetHeader>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Info */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">Informações</h3>
            <div className="grid grid-cols-2 gap-3">
              {fee && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/40 bg-card/60">
                  <DollarSign className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Consulta</p>
                    <p className="text-[13px] font-bold text-foreground">{fee}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/40 bg-card/60">
                <Heart className={`w-4 h-4 flex-shrink-0 ${professional.acceptsInsurance ? "text-emerald-600" : "text-muted-foreground/30"}`} />
                <div>
                  <p className="text-[10px] text-muted-foreground">Convênio</p>
                  <p className={`text-[13px] font-bold ${professional.acceptsInsurance ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                    {professional.acceptsInsurance ? "Aceita" : "Não aceita"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Schedule */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">Horários</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-card/60">
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/80">
                  <Clock className="w-4 h-4 text-primary" />
                  Expediente
                </div>
                <span className="text-[13px] font-bold text-foreground">
                  {professional.workingHoursStart} — {professional.workingHoursEnd}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-card/60">
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/80">
                  <Coffee className="w-4 h-4 text-amber-500" />
                  Almoço
                </div>
                <span className="text-[13px] font-bold text-foreground">
                  {professional.lunchStart} — {professional.lunchEnd}
                </span>
              </div>
              <div className="p-3 rounded-xl border border-border/40 bg-card/60">
                <p className="text-[12px] text-muted-foreground mb-2">Dias de atendimento</p>
                <WorkingDaysBadges days={professional.workingDays} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Today's appointments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Agenda de Hoje
              </h3>
              {todayApts.length > 0 && (
                <span className="text-[10px] font-bold bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full">
                  {todayApts.length} consulta{todayApts.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {todayApts.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <CalendarCheck2 className="w-8 h-8 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground/50">Sem consultas hoje</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayApts.map((apt) => <AppointmentRow key={apt.id} apt={apt} />)}
              </div>
            )}
          </div>

          {/* Upcoming */}
          {upcomingApts.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  Próximas Consultas
                </h3>
                <div className="space-y-2">
                  {upcomingApts.map((apt) => (
                    <div key={apt.id} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/60">
                      <div className="min-w-[60px] text-center">
                        <p className="text-[10px] font-bold text-muted-foreground">
                          {new Date(apt.startsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                        </p>
                        <p className="text-xs font-bold text-primary">{formatTime(apt.startsAt)}</p>
                      </div>
                      <div className="w-px h-8 bg-border/50" />
                      <p className="text-[13px] font-medium text-foreground/80 truncate flex-1">
                        {apt.procedureName || "Consulta"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfessionalCard({
  professional,
  index,
  todayCount,
  weekCount,
  onClick,
}: {
  professional: Professional;
  index: number;
  todayCount: number;
  weekCount: number;
  onClick: () => void;
}) {
  const specialties = getSpecialtiesList(professional);
  const fee = formatFee(professional.consultationFee);

  return (
    <button
      onClick={onClick}
      className="w-full text-left group premium-card rounded-2xl border border-border/60 bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 overflow-hidden"
    >
      {/* Top accent strip */}
      <div className={`h-1 w-full bg-gradient-to-r ${AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length]} opacity-70 group-hover:opacity-100 transition-opacity`} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <ProfessionalAvatar name={professional.name} index={index} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {professional.isOwner && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                  <Star className="w-2 h-2" /> Titular
                </span>
              )}
              {professional.acceptsInsurance && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                  <Heart className="w-2 h-2" /> Convênio
                </span>
              )}
            </div>
            <h3 className="text-[15px] font-bold text-foreground leading-tight truncate">{professional.name}</h3>
            {professional.cro && (
              <p className="text-[11px] text-muted-foreground font-medium mt-0.5">{professional.cro}</p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
        </div>

        {/* Specialties */}
        {specialties.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {specialties.slice(0, 3).map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary/8 text-primary px-2 py-0.5 rounded-lg">
                <GraduationCap className="w-2.5 h-2.5" /> {s}
              </span>
            ))}
            {specialties.length > 3 && (
              <span className="text-[11px] font-semibold text-muted-foreground/60 px-2 py-0.5 rounded-lg bg-muted/40">
                +{specialties.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Schedule */}
        <div className="flex items-center justify-between text-[12px] mb-4">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span className="font-medium">{professional.workingHoursStart} — {professional.workingHoursEnd}</span>
          </div>
          {fee && (
            <div className="flex items-center gap-1 text-emerald-600 font-bold">
              <DollarSign className="w-3 h-3" />
              <span>{fee}</span>
            </div>
          )}
        </div>

        {/* Days */}
        <WorkingDaysBadges days={professional.workingDays} />

        {/* Bottom stats */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <CalendarCheck2 className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div>
              <p className="text-base font-bold text-foreground leading-none">{todayCount}</p>
              <p className="text-[10px] text-muted-foreground">hoje</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
              <CalendarDays className="w-3.5 h-3.5 text-violet-600" />
            </div>
            <div>
              <p className="text-base font-bold text-foreground leading-none">{weekCount}</p>
              <p className="text-[10px] text-muted-foreground">esta semana</p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function ProfessionalCardSkeleton() {
  return (
    <div className="premium-card rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="h-1 w-full bg-muted/40" />
      <div className="p-5 space-y-4">
        <div className="flex gap-4">
          <Skeleton className="w-14 h-14 rounded-2xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-lg" />
          <Skeleton className="h-5 w-24 rounded-lg" />
        </div>
        <Skeleton className="h-3 w-full" />
        <div className="flex gap-1">
          {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-5 w-8 rounded-md" />)}
        </div>
        <div className="pt-4 border-t border-border/40 grid grid-cols-2 gap-3">
          <Skeleton className="h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function ProfessionalsPage() {
  const [search, setSearch] = useState("");
  const [selectedProfessional, setSelectedProfessional] = useState<{ prof: Professional; index: number } | null>(null);
  const [insuranceFilter, setInsuranceFilter] = useState<"all" | "yes" | "no">("all");

  const { data: profData, isLoading: profLoading } = useProfessionalsData();
  const { data: aptsData } = useListAppointments({});

  const professionals = profData?.professionals || [];
  const allApts = (aptsData as AptRecord[] | undefined) || [];

  const filtered = useMemo(() => {
    return professionals.filter((p) => {
      const q = search.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchSpec = (p.specialties || p.specialty || "").toLowerCase().includes(q);
      if (q && !matchName && !matchSpec) return false;
      if (insuranceFilter === "yes" && !p.acceptsInsurance) return false;
      if (insuranceFilter === "no" && p.acceptsInsurance) return false;
      return true;
    });
  }, [professionals, search, insuranceFilter]);

  function getTodayCount(profId: number) {
    return allApts.filter(
      (a) => a.professionalId === profId && isToday(a.startsAt) && a.status !== "cancelled"
    ).length;
  }

  function getWeekCount(profId: number) {
    return allApts.filter(
      (a) => a.professionalId === profId && isThisWeek(a.startsAt) && a.status !== "cancelled"
    ).length;
  }

  const totalTodayApts = professionals.reduce((sum, p) => sum + getTodayCount(p.id), 0);
  const totalWeekApts = professionals.reduce((sum, p) => sum + getWeekCount(p.id), 0);
  const insuranceCount = professionals.filter((p) => p.acceptsInsurance).length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center shadow-md shadow-primary/20">
            <Stethoscope className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Profissionais</h1>
            <p className="text-[13px] text-muted-foreground">
              {professionals.length} profissional{professionals.length !== 1 ? "is" : ""} ativo{professionals.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Total de profissionais",
            value: professionals.length,
            icon: User,
            color: "from-primary/15 to-primary/5",
            iconColor: "text-primary",
            iconBg: "bg-primary/15",
          },
          {
            label: "Consultas hoje",
            value: totalTodayApts,
            icon: CalendarCheck2,
            color: "from-blue-500/10 to-blue-500/5",
            iconColor: "text-blue-600",
            iconBg: "bg-blue-500/10",
          },
          {
            label: "Consultas na semana",
            value: totalWeekApts,
            icon: CalendarDays,
            color: "from-violet-500/10 to-violet-500/5",
            iconColor: "text-violet-600",
            iconBg: "bg-violet-500/10",
          },
          {
            label: "Aceitam convênio",
            value: insuranceCount,
            icon: Heart,
            color: "from-emerald-500/10 to-emerald-500/5",
            iconColor: "text-emerald-600",
            iconBg: "bg-emerald-500/10",
          },
        ].map((stat) => (
          <div key={stat.label} className={`premium-card rounded-2xl border border-border/60 bg-gradient-to-br ${stat.color} p-4 flex items-center gap-3`}>
            <div className={`w-9 h-9 rounded-xl ${stat.iconBg} flex items-center justify-center flex-shrink-0`}>
              <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground leading-none">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou especialidade..."
            className="pl-9 h-10 rounded-xl"
          />
        </div>
        <div className="flex gap-2">
          {[
            { key: "all", label: "Todos" },
            { key: "yes", label: "Aceita convênio" },
            { key: "no", label: "Sem convênio" },
          ].map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={insuranceFilter === opt.key ? "default" : "outline"}
              className={`rounded-xl h-10 text-xs font-semibold ${insuranceFilter === opt.key ? "shadow-md shadow-primary/20" : ""}`}
              onClick={() => setInsuranceFilter(opt.key as typeof insuranceFilter)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {profLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <ProfessionalCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
            <Stethoscope className="w-7 h-7 text-muted-foreground/30" />
          </div>
          <p className="text-base font-semibold text-muted-foreground">Nenhum profissional encontrado</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {search ? "Tente ajustar a busca" : "Adicione profissionais em Configurações"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((prof, idx) => {
            const realIndex = professionals.findIndex((p) => p.id === prof.id);
            return (
              <ProfessionalCard
                key={prof.id}
                professional={prof}
                index={realIndex}
                todayCount={getTodayCount(prof.id)}
                weekCount={getWeekCount(prof.id)}
                onClick={() => setSelectedProfessional({ prof, index: realIndex })}
              />
            );
          })}
        </div>
      )}

      {/* Detail Sheet */}
      {selectedProfessional && (
        <ProfessionalSheet
          professional={selectedProfessional.prof}
          index={selectedProfessional.index}
          open={!!selectedProfessional}
          onClose={() => setSelectedProfessional(null)}
          appointments={allApts}
        />
      )}
    </div>
  );
}
