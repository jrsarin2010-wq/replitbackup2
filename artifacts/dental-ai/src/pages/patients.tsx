import { useState, useCallback } from "react";
import { useListPatients, useCreatePatient, useUpdatePatient, useDeletePatient, getListPatientsQueryKey, useListTreatments, useConvertLead } from "@workspace/api-client-react";
import type { PatientsListResponseDataItem, ListPatientsFilter } from "@workspace/api-client-react";
import type { ProcedureItem } from "@/lib/types";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Phone, Mail, Trash2, Pencil, UserPlus,
  FileText, CheckCircle2, Clock, Receipt, DollarSign,
  ArrowRightLeft, Flame, Snowflake, Zap, Users, UserCheck, Filter,
  MapPin,
} from "lucide-react";
import { ContactAvatar } from "@/components/ui/contact-avatar";

interface PatientForm {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  cpf: string;
  address: string;
  notes: string;
}

interface ConvertForm {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  cpf: string;
  address: string;
  notes: string;
}

const emptyForm: PatientForm = { name: "", phone: "", email: "", birthDate: "", cpf: "", address: "", notes: "" };
const emptyConvertForm: ConvertForm = { name: "", phone: "", email: "", birthDate: "", cpf: "", address: "", notes: "" };

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function TemperatureBadge({ temp }: { temp?: string }) {
  if (!temp) return null;
  const config: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    hot: { icon: <Flame className="w-3 h-3" />, label: "Quente", cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" },
    warm: { icon: <Zap className="w-3 h-3" />, label: "Morno", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
    cold: { icon: <Snowflake className="w-3 h-3" />, label: "Frio", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  };
  const c = config[temp] || config.cold;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] rounded-md ${c.cls}`}>
      {c.icon} {c.label}
    </Badge>
  );
}

interface PatientAppointment {
  id: number;
  status: string;
  startsAt: string;
  procedureName?: string | null;
  pixPaymentStatus?: string | null;
}

function PatientDetailDialog({ patient, open, onClose }: { patient: { id: number; name: string; phone: string; email?: string; cpf?: string; birthDate?: string; notes?: string; profilePicUrl?: string; totalSpent: string; createdAt: string }; open: boolean; onClose: () => void }) {
  const { data: treatments } = useListTreatments(
    { patientId: patient?.id },
    { query: { enabled: open && !!patient } } as Parameters<typeof useListTreatments>[1]
  );
  const treatmentList = Array.isArray(treatments) ? treatments : [];

  const { data: patientAppointments = [] } = useQuery<PatientAppointment[]>({
    queryKey: ["/api/dental/appointments", "patient", patient?.id],
    queryFn: async () => {
      const res = await fetch(`/api/dental/appointments?patientId=${patient.id}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: open && !!patient,
  });

  if (!patient) return null;

  const totalValue = treatmentList.reduce((s: number, t) => s + Number(t.totalValue || 0), 0);
  const totalPaid = treatmentList.reduce((s: number, t) => s + Number(t.paidValue || 0), 0);
  const finalized = treatmentList.filter((t) => t.status === "finished").length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <ContactAvatar name={patient.name} profilePicUrl={patient.profilePicUrl} size="sm" />
            Ficha de {patient.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="premium-card rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground uppercase">Telefone</span>
              </div>
              <p className="text-[13px] font-medium">{patient.phone}</p>
            </div>
            <div className="premium-card rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground uppercase">Email</span>
              </div>
              <p className="text-[13px] font-medium">{patient.email || "-"}</p>
            </div>
            <div className="premium-card rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground uppercase">CPF</span>
              </div>
              <p className="text-[13px] font-medium">{patient.cpf || "-"}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="premium-card rounded-xl p-3 text-center">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mx-auto mb-1" />
              <p className="text-[10px] text-muted-foreground uppercase">Total Gasto</p>
              <p className="font-mono font-bold text-sm mt-0.5">{formatBRL(totalPaid)}</p>
            </div>
            <div className="premium-card rounded-xl p-3 text-center">
              <Receipt className="w-5 h-5 text-primary mx-auto mb-1" />
              <p className="text-[10px] text-muted-foreground uppercase">Valor Total</p>
              <p className="font-mono font-bold text-sm mt-0.5">{formatBRL(totalValue)}</p>
            </div>
            <div className="premium-card rounded-xl p-3 text-center">
              <CheckCircle2 className="w-5 h-5 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
              <p className="text-[10px] text-muted-foreground uppercase">Finalizados</p>
              <p className="font-bold text-sm mt-0.5">{finalized} / {treatmentList.length}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Tratamentos</h3>
            {treatmentList.length === 0 ? (
              <div className="premium-card rounded-xl p-6 text-center text-muted-foreground text-[13px]">
                Nenhum tratamento registrado
              </div>
            ) : (
              <div className="space-y-2">
                {treatmentList.map((t) => {
                  let procs: ProcedureItem[] = [];
                  try { procs = typeof t.procedures === "string" ? JSON.parse(t.procedures) : (t.procedures || []); } catch {}
                  const isFinished = t.status === "finished";
                  return (
                    <div key={t.id} className="premium-card rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-[13px]">{t.description}</p>
                        <Badge
                          variant="outline"
                          className={`gap-1 text-[10px] rounded-md ${
                            isFinished
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                              : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                          }`}
                        >
                          {isFinished ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {isFinished ? "Finalizado" : "Em Andamento"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {procs.map((p: { name: string; value: string }, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[10px] rounded-md">
                            {p.name} ({formatBRL(Number(p.value))})
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">
                          {t.paymentMethod && <span className="mr-2">{t.paymentMethod}</span>}
                          {t.createdAt && new Date(t.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                        <div className="flex gap-3">
                          <span>Valor: <strong className="font-mono">{formatBRL(Number(t.totalValue))}</strong></span>
                          <span>Pago: <strong className={`font-mono ${Number(t.paidValue) >= Number(t.totalValue) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {formatBRL(Number(t.paidValue))}
                          </strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {patientAppointments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Agendamentos</h3>
              <div className="space-y-2">
                {patientAppointments.map((apt) => {
                  const statusLabels: Record<string, string> = {
                    scheduled: "Agendado", confirmed: "Confirmado", completed: "Realizado",
                    cancelled: "Cancelado", no_show: "Faltou",
                  };
                  const statusColors: Record<string, string> = {
                    scheduled: "bg-blue-500/10 text-blue-700 border-blue-200",
                    confirmed: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
                    completed: "bg-muted/60 text-muted-foreground border-border/40",
                    cancelled: "bg-red-500/10 text-red-600 border-red-200",
                    no_show: "bg-amber-500/10 text-amber-700 border-amber-200",
                  };
                  return (
                    <div key={apt.id} className="premium-card rounded-xl p-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold">{apt.procedureName || "Consulta"}</p>
                        <p className="text-[11px] text-muted-foreground/60">
                          {new Date(apt.startsAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${statusColors[apt.status] || statusColors.scheduled}`}>
                          {statusLabels[apt.status] || apt.status}
                        </Badge>
                        {apt.pixPaymentStatus === "pending" && (
                          <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-700 border-yellow-300">
                            PIX Pendente
                          </Badge>
                        )}
                        {apt.pixPaymentStatus === "confirmed_auto" && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-300">
                            PIX (IA)
                          </Badge>
                        )}
                        {apt.pixPaymentStatus === "confirmed_manual" && (
                          <Badge variant="outline" className="text-[10px] bg-teal-500/10 text-teal-700 border-teal-300">
                            PIX (Manual)
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ListItem = PatientsListResponseDataItem;

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "patients" | "leads">("patients");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PatientForm>(emptyForm);
  const [detailPatient, setDetailPatient] = useState<any>(null);
  const [convertLeadItem, setConvertLeadItem] = useState<ListItem | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertForm>(emptyConvertForm);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useListPatients({ search: search || undefined, filter });
  const createMut = useCreatePatient();
  const updateMut = useUpdatePatient();
  const deleteMut = useDeletePatient();

  const items: ListItem[] = data?.data || [];
  const totalPatients = data?.totalPatients ?? 0;
  const totalLeads = data?.totalLeads ?? 0;

  const convertMut = useConvertLead({
    mutation: {
      onSuccess: () => {
        toast({ title: "Lead convertido em paciente!" });
        setConvertLeadItem(null);
        setConvertForm(emptyConvertForm);
        qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      },
      onError: (err: Error) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      },
    },
  });

  function openCreate() {
    setForm(emptyForm);
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(p: { id: number; name: string; phone: string; email?: string | null; cpf?: string; birthDate?: string; address?: string | null; notes?: string | null }) {
    setForm({
      name: p.name || "",
      phone: p.phone || "",
      email: p.email || "",
      birthDate: p.birthDate ? p.birthDate.split("T")[0] : "",
      cpf: p.cpf || "",
      address: p.address || "",
      notes: p.notes || "",
    });
    setEditId(p.id);
    setDialogOpen(true);
  }

  function openConvert(item: ListItem) {
    setConvertForm({
      name: item.name || "",
      phone: item.phone || "",
      email: item.email || "",
      birthDate: "",
      cpf: "",
      address: "",
      notes: item.notes || "",
    });
    setConvertLeadItem(item);
  }

  const handleConvert = useCallback(() => {
    if (!convertLeadItem) return;
    convertMut.mutate({ leadId: convertLeadItem.leadId || convertLeadItem.id, data: convertForm });
  }, [convertLeadItem, convertForm, convertMut]);

  async function handleSubmit() {
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email || undefined,
      birthDate: form.birthDate || undefined,
      cpf: form.cpf || undefined,
      address: form.address || undefined,
      notes: form.notes || undefined,
    };

    try {
      if (editId) {
        await updateMut.mutateAsync({ patientId: editId, data: payload });
        toast({ title: "Paciente atualizado" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "Paciente criado" });
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Tem certeza que deseja excluir este paciente?")) return;
    try {
      await deleteMut.mutateAsync({ patientId: id });
      toast({ title: "Paciente excluido" });
      qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  const filterTabs = [
    { key: "all" as const, label: "Todos", icon: <Users className="w-3.5 h-3.5" />, count: totalPatients + totalLeads },
    { key: "patients" as const, label: "Pacientes", icon: <UserCheck className="w-3.5 h-3.5" />, count: totalPatients },
    { key: "leads" as const, label: "Leads", icon: <Filter className="w-3.5 h-3.5" />, count: totalLeads },
  ];

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-[28px] font-extrabold tracking-tight gradient-text-warm">Pacientes</h1>
          <p className="text-[12px] text-muted-foreground/60 font-medium mt-1">{totalPatients} pacientes · {totalLeads} leads</p>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto rounded-xl h-10 px-5 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
          <UserPlus className="w-4 h-4" />
          Novo Paciente
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 rounded-xl bg-card border-border/60"
          />
        </div>
        <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                filter === tab.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                filter === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="premium-card rounded-2xl p-12 text-center">
          <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {filter === "leads" ? "Nenhum lead encontrado" : filter === "patients" ? "Nenhum paciente encontrado" : "Nenhum registro encontrado"}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <div className="premium-card rounded-2xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Nome</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Telefone</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Email</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Status</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80 text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow
                      key={`${p.type}-${p.id}`}
                      className="hover:bg-muted/30 transition-colors group cursor-pointer"
                      onClick={() => p.type === "patient" ? setDetailPatient(p) : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ContactAvatar name={p.name} profilePicUrl={p.profilePicUrl} size="sm" />
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[13px]">{p.name}</span>
                            {p.type === "lead" && (
                              <Badge variant="outline" className="text-[10px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 gap-1">
                                <Zap className="w-2.5 h-2.5" />
                                Lead
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-[13px]">{p.phone}</TableCell>
                      <TableCell className="text-muted-foreground text-[13px]">{p.email || "-"}</TableCell>
                      <TableCell>
                        {p.type === "lead" ? (
                          <TemperatureBadge temp={p.temperature ?? undefined} />
                        ) : (
                          <Badge variant="secondary" className="font-mono text-xs rounded-lg">
                            R$ {Number(p.totalSpent || 0).toLocaleString("pt-BR")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          {p.type === "lead" ? (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 text-[11px] rounded-lg gap-1 shadow-sm"
                              onClick={() => openConvert(p)}
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              Converter em Paciente
                            </Button>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Ver Ficha" onClick={() => setDetailPatient(p)}>
                                <FileText className="w-3.5 h-3.5 text-primary" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit({ ...p, cpf: p.cpf ?? undefined, birthDate: p.birthDate ?? undefined })}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleDelete(p.id)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="md:hidden space-y-3">
            {items.map((p) => (
              <div
                key={`${p.type}-${p.id}`}
                className="premium-card rounded-2xl p-4"
                onClick={() => p.type === "patient" ? setDetailPatient(p) : undefined}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <ContactAvatar name={p.name} profilePicUrl={p.profilePicUrl} size="md" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[13px]">{p.name}</p>
                        {p.type === "lead" && (
                          <Badge variant="outline" className="text-[10px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 gap-1">
                            <Zap className="w-2.5 h-2.5" />
                            Lead
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {p.phone}
                      </div>
                      {p.email && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          {p.email}
                        </div>
                      )}
                    </div>
                  </div>
                  {p.type === "patient" && (
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit({ ...p, cpf: p.cpf ?? undefined, birthDate: p.birthDate ?? undefined })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {p.type === "lead" ? (
                    <TemperatureBadge temp={p.temperature ?? undefined} />
                  ) : (
                    <Badge variant="secondary" className="font-mono text-[11px] rounded-lg">
                      R$ {Number(p.totalSpent || 0).toLocaleString("pt-BR")}
                    </Badge>
                  )}
                  {p.type === "lead" ? (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-[11px] rounded-lg gap-1"
                      onClick={(e) => { e.stopPropagation(); openConvert(p); }}
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      Converter
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] rounded-lg gap-1 text-primary" onClick={(e) => { e.stopPropagation(); setDetailPatient(p); }}>
                      <FileText className="w-3 h-3" /> Ver Ficha
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <PatientDetailDialog
        patient={detailPatient}
        open={!!detailPatient}
        onClose={() => setDetailPatient(null)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">{editId ? "Editar Paciente" : "Novo Paciente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" className="rounded-xl h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Telefone *</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+55 11 99999-0000" className="rounded-xl h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" className="rounded-xl h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Data de Nascimento</Label>
                <Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className="rounded-xl h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">CPF</Label>
                <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" className="rounded-xl h-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Endereco
              </Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua, numero, bairro, cidade" className="rounded-xl h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Observacoes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre o paciente" className="rounded-xl h-10" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.name || !form.phone} className="rounded-xl shadow-md shadow-primary/20">
              {editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!convertLeadItem} onOpenChange={(open) => { if (!open) { setConvertLeadItem(null); setConvertForm(emptyConvertForm); } }}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
              Converter Lead em Paciente
            </DialogTitle>
          </DialogHeader>
          {convertLeadItem && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-200 dark:border-violet-800">
                <ContactAvatar name={convertLeadItem.name} profilePicUrl={convertLeadItem.profilePicUrl} size="sm" />
                <div>
                  <p className="text-sm font-semibold">{convertLeadItem.name}</p>
                  <p className="text-[11px] text-muted-foreground">{convertLeadItem.phone} {convertLeadItem.interest ? `· Interesse: ${convertLeadItem.interest}` : ""}</p>
                </div>
                <TemperatureBadge temp={convertLeadItem.temperature ?? undefined} />
              </div>

              <p className="text-[12px] text-muted-foreground">Preencha a ficha completa do paciente. Os dados do lead ja foram pre-carregados.</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium">Nome *</Label>
                  <Input value={convertForm.name} onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })} className="rounded-xl h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium">Telefone *</Label>
                  <Input value={convertForm.phone} onChange={(e) => setConvertForm({ ...convertForm, phone: e.target.value })} className="rounded-xl h-10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Email</Label>
                <Input value={convertForm.email} onChange={(e) => setConvertForm({ ...convertForm, email: e.target.value })} placeholder="email@exemplo.com" className="rounded-xl h-10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium">CPF</Label>
                  <Input value={convertForm.cpf} onChange={(e) => setConvertForm({ ...convertForm, cpf: e.target.value })} placeholder="000.000.000-00" className="rounded-xl h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-medium">Data de Nascimento</Label>
                  <Input type="date" value={convertForm.birthDate} onChange={(e) => setConvertForm({ ...convertForm, birthDate: e.target.value })} className="rounded-xl h-10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Endereco
                </Label>
                <Input value={convertForm.address} onChange={(e) => setConvertForm({ ...convertForm, address: e.target.value })} placeholder="Rua, numero, bairro, cidade" className="rounded-xl h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Observacoes</Label>
                <Textarea
                  value={convertForm.notes}
                  onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })}
                  placeholder="Anotacoes sobre o paciente..."
                  className="rounded-xl min-h-[80px]"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setConvertLeadItem(null); setConvertForm(emptyConvertForm); }} className="rounded-xl">Cancelar</Button>
            <Button
              onClick={handleConvert}
              disabled={!convertForm.name || !convertForm.phone || convertMut.isPending}
              className="rounded-xl shadow-md shadow-primary/20 gap-2"
            >
              {convertMut.isPending ? (
                <><Clock className="w-4 h-4 animate-spin" /> Convertendo...</>
              ) : (
                <><UserCheck className="w-4 h-4" /> Converter em Paciente</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
