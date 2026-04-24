import { useState, useRef, useCallback, useMemo } from "react";
import { useListLeads, useCreateLead, useUpdateLead, useDeleteLead, useConvertLead } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Flame, Thermometer, Snowflake, UserPlus,
  Trash2, Pencil, Phone, Mail, Target, GripVertical, AtSign,
  CreditCard, ShieldCheck, HelpCircle,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ContactAvatar } from "@/components/ui/contact-avatar";

interface LeadProfessional {
  id: number;
  name: string;
  instagramUrl?: string | null;
  isOwner: boolean;
}

function useProfessionalsForLeads() {
  return useQuery<LeadProfessional[]>({
    queryKey: ["/api/dental/professionals"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/dental/professionals?includeInactive=false`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json() as { professionals?: LeadProfessional[] } | LeadProfessional[];
      return Array.isArray(data) ? data : (data.professionals ?? []);
    },
    staleTime: 5 * 60 * 1000,
  });
}

function getInstagramHandle(rawUrl: string): string {
  const cleaned = rawUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "");
  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}

type Temperature = "hot" | "warm" | "cold";

interface LeadItem {
  id: number;
  name: string;
  phone: string;
  email?: string;
  temperature: string;
  source?: string;
  interest?: string;
  notes?: string;
  profilePicUrl?: string;
  status: string;
  professionalId?: number | null;
  paymentType?: "insurance" | "private" | null;
  lastContactAt?: string;
  createdAt: string;
}

const paymentTypeConfig = {
  insurance: { label: "Convênio", icon: ShieldCheck, classes: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700" },
  private: { label: "Particular", icon: CreditCard, classes: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700" },
  none: { label: "Não definido", icon: HelpCircle, classes: "bg-muted/40 text-muted-foreground border-border" },
} as const;

const tempConfig: Record<string, { label: string; icon: React.ElementType; color: string; bg: string; headerGradient: string; dropHighlight: string }> = {
  hot: {
    label: "Quente",
    icon: Flame,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10 border-red-200 dark:border-red-800",
    headerGradient: "from-red-500/15 to-red-500/5",
    dropHighlight: "ring-red-400/50 bg-red-50/50 dark:bg-red-950/20",
  },
  warm: {
    label: "Morno",
    icon: Thermometer,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10 border-orange-200 dark:border-orange-800",
    headerGradient: "from-orange-500/15 to-orange-500/5",
    dropHighlight: "ring-orange-400/50 bg-orange-50/50 dark:bg-orange-950/20",
  },
  cold: {
    label: "Frio",
    icon: Snowflake,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10 border-blue-200 dark:border-blue-800",
    headerGradient: "from-blue-500/15 to-blue-500/5",
    dropHighlight: "ring-blue-400/50 bg-blue-50/50 dark:bg-blue-950/20",
  },
};

export default function LeadsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", interest: "", source: "", notes: "", temperature: "cold" });
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const dragCounter = useRef<Record<string, number>>({});

  const { data: leadsData, isLoading } = useListLeads();
  const { data: professionals } = useProfessionalsForLeads();

  const { data: pixAppointmentsRaw } = useQuery<Array<{ leadId: number | null; pixPaymentStatus: string }>>({
    queryKey: ["/api/dental/appointments", "pix-leads"],
    queryFn: async () => {
      const res = await fetch("/api/dental/appointments");
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data.filter((a: { pixPaymentStatus?: string }) => a.pixPaymentStatus && a.pixPaymentStatus !== "none");
    },
    staleTime: 2 * 60 * 1000,
  });

  const leadPixStatus = useMemo(() => {
    const map: Record<number, string> = {};
    for (const apt of pixAppointmentsRaw || []) {
      if (apt.leadId && apt.pixPaymentStatus) {
        const existing = map[apt.leadId];
        if (!existing || apt.pixPaymentStatus === "pending") {
          map[apt.leadId] = apt.pixPaymentStatus;
        }
      }
    }
    return map;
  }, [pixAppointmentsRaw]);

  function getProfessionalInstagram(lead: LeadItem): { handle: string; name: string } | null {
    const profs = professionals || [];
    let prof: LeadProfessional | null = null;
    if (lead.professionalId) {
      const assigned = profs.find((p) => p.id === lead.professionalId) || null;
      if (assigned?.instagramUrl) prof = assigned;
    }
    if (!prof) {
      prof = profs.find((p) => p.isOwner && p.instagramUrl) || null;
    }
    if (!prof) {
      prof = profs.find((p) => p.instagramUrl) || null;
    }
    if (!prof?.instagramUrl) return null;
    return { handle: getInstagramHandle(prof.instagramUrl), name: prof.name };
  }
  const createMut = useCreateLead();
  const updateMut = useUpdateLead();
  const deleteMut = useDeleteLead();
  const convertMut = useConvertLead();

  const leads = (leadsData as LeadItem[]) || [];

  const grouped = {
    hot: leads.filter((l) => l.temperature === "hot"),
    warm: leads.filter((l) => l.temperature === "warm"),
    cold: leads.filter((l) => l.temperature === "cold"),
  };

  function openCreate() {
    setForm({ name: "", phone: "", email: "", interest: "", source: "", notes: "", temperature: "cold" });
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(l: LeadItem) {
    setForm({
      name: l.name || "",
      phone: l.phone || "",
      email: l.email || "",
      interest: l.interest || "",
      source: l.source || "",
      notes: l.notes || "",
      temperature: l.temperature || "cold",
    });
    setEditId(l.id);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    const payload = {
      name: form.name,
      phone: form.phone,
      temperature: form.temperature as Temperature,
      email: form.email || undefined,
      interest: form.interest || undefined,
      source: form.source || undefined,
      notes: form.notes || undefined,
    };

    try {
      if (editId) {
        await updateMut.mutateAsync({ leadId: editId, data: payload });
        toast({ title: "Lead atualizado" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "Lead criado" });
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/dental/leads"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleConvert(id: number) {
    if (!confirm("Converter este lead em paciente?")) return;
    try {
      await convertMut.mutateAsync({ leadId: id, data: {} });
      toast({ title: "Lead convertido em paciente!" });
      qc.invalidateQueries({ queryKey: ["/api/dental/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/dental/patients"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleChangePaymentType(leadId: number, paymentType: "insurance" | "private" | null) {
    try {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/dental/leads/${leadId}/payment-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ paymentType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const labelMap = { insurance: "Convênio", private: "Particular" } as const;
      toast({ title: "Tipo de pagamento atualizado", description: paymentType ? labelMap[paymentType] : "Não definido" });
      qc.invalidateQueries({ queryKey: ["/api/dental/leads"] });
    } catch (e) {
      toast({ title: "Erro ao atualizar tipo de pagamento", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este lead?")) return;
    try {
      await deleteMut.mutateAsync({ leadId: id });
      toast({ title: "Lead excluido" });
      qc.invalidateQueries({ queryKey: ["/api/dental/leads"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  const handleDrop = useCallback(async (leadId: number, newTemp: Temperature) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.temperature === newTemp) return;

    const oldTemp = tempConfig[lead.temperature]?.label || lead.temperature;
    const newTempLabel = tempConfig[newTemp]?.label || newTemp;

    try {
      await updateMut.mutateAsync({
        leadId,
        data: { temperature: newTemp },
      });
      toast({ title: `Lead movido para ${newTempLabel}`, description: `${lead.name}: ${oldTemp} → ${newTempLabel}` });
      qc.invalidateQueries({ queryKey: ["/api/dental/leads"] });
    } catch (e) {
      toast({ title: "Erro ao mover lead", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }, [leads, updateMut, toast, qc]);

  function onDragStart(e: React.DragEvent, leadId: number) {
    e.dataTransfer.setData("text/plain", String(leadId));
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => setDraggingId(leadId), 0);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDropTarget(null);
    dragCounter.current = {};
  }

  function onDragEnterColumn(e: React.DragEvent, temp: string) {
    e.preventDefault();
    dragCounter.current[temp] = (dragCounter.current[temp] || 0) + 1;
    setDropTarget(temp);
  }

  function onDragLeaveColumn(temp: string) {
    dragCounter.current[temp] = (dragCounter.current[temp] || 0) - 1;
    if (dragCounter.current[temp] <= 0) {
      dragCounter.current[temp] = 0;
      if (dropTarget === temp) setDropTarget(null);
    }
  }

  function onDragOverColumn(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDropColumn(e: React.DragEvent, temp: Temperature) {
    e.preventDefault();
    const leadId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(leadId)) {
      handleDrop(leadId, temp);
    }
    setDropTarget(null);
    setDraggingId(null);
    dragCounter.current = {};
  }

  function LeadCard({ lead }: { lead: LeadItem }) {
    const config = tempConfig[lead.temperature] || tempConfig.cold;
    const TempIcon = config.icon;
    const isDragging = draggingId === lead.id;
    const profInsta = getProfessionalInstagram(lead);
    const pixStatus = leadPixStatus[lead.id];

    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, lead.id)}
        onDragEnd={onDragEnd}
        className={`group cursor-grab active:cursor-grabbing transition-all duration-200 ${
          isDragging ? "opacity-40 scale-95 rotate-1" : "opacity-100"
        }`}
      >
        <Card className="premium-card-glow rounded-xl overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-2.5 mb-3">
              <div className="pt-1.5 opacity-0 group-hover:opacity-40 transition-opacity cursor-grab">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <ContactAvatar name={lead.name} profilePicUrl={lead.profilePicUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="font-bold text-[13px] truncate">{lead.name}</p>
                    {lead.source && <p className="text-[10px] text-muted-foreground/60 font-medium">via {lead.source}</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1 mb-3 ml-[22px]">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                <Phone className="w-3 h-3 shrink-0" /> <span className="truncate font-medium">{lead.phone}</span>
              </div>
              {lead.email && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                  <Mail className="w-3 h-3 shrink-0" /> <span className="truncate font-medium">{lead.email}</span>
                </div>
              )}
            </div>

            {lead.interest && (
              <p className="text-[11px] text-muted-foreground/80 bg-muted/40 px-2.5 py-1.5 rounded-lg mb-3 ml-[22px] line-clamp-2 font-medium border border-border/30">
                {lead.interest}
              </p>
            )}

            {lead.lastContactAt && (
              <p className="text-[10px] text-muted-foreground/50 mb-3 ml-[22px] font-medium">
                Ultimo contato: {new Date(lead.lastContactAt).toLocaleDateString("pt-BR")}
              </p>
            )}

            {profInsta && (
              <div className="flex items-center gap-1.5 mb-3 ml-[22px]">
                <AtSign className="w-3 h-3 text-pink-500 shrink-0" />
                <a
                  href={`https://instagram.com/${profInsta.handle.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-pink-600 dark:text-pink-400 font-semibold hover:underline truncate"
                  onClick={(e) => e.stopPropagation()}
                  title={`Instagram de ${profInsta.name}`}
                >
                  {profInsta.handle}
                </a>
                <span className="text-[10px] text-muted-foreground/50">Prova Social do Profissional</span>
              </div>
            )}

            <div className="mb-2.5 ml-[22px]">
              {(() => {
                const ptKey = (lead.paymentType ?? "none") as keyof typeof paymentTypeConfig;
                const cfg = paymentTypeConfig[ptKey];
                const PtIcon = cfg.icon;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold hover:opacity-80 transition-opacity ${cfg.classes}`}
                        title="Clique para alterar o tipo de pagamento"
                      >
                        <PtIcon className="w-3 h-3" />
                        {cfg.label}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => handleChangePaymentType(lead.id, "insurance")}>
                        <ShieldCheck className="w-3.5 h-3.5 mr-2 text-indigo-600" /> Convênio
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleChangePaymentType(lead.id, "private")}>
                        <CreditCard className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Particular
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleChangePaymentType(lead.id, null)}>
                        <HelpCircle className="w-3.5 h-3.5 mr-2 text-muted-foreground" /> Não definido
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
            </div>

            {pixStatus && (
              <div className="mb-2.5 ml-[22px]">
                {pixStatus === "pending" && (
                  <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700">
                    PIX Pendente
                  </Badge>
                )}
                {(pixStatus === "confirmed_auto" || pixStatus === "confirmed") && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700">
                    PIX Confirmado (IA)
                  </Badge>
                )}
                {pixStatus === "confirmed_manual" && (
                  <Badge variant="outline" className="text-[10px] bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700">
                    PIX Confirmado (Manual)
                  </Badge>
                )}
              </div>
            )}

            <div className="flex gap-1.5 ml-[22px]">
              {lead.status !== "converted" && (
                <Button variant="default" size="sm" className="h-7 text-xs gap-1 flex-1" onClick={() => handleConvert(lead.id)}>
                  <UserPlus className="w-3 h-3" />
                  Converter
                </Button>
              )}
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => openEdit(lead)}>
                <Pencil className="w-3 h-3" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => handleDelete(lead.id)}>
                <Trash2 className="w-3 h-3 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[400px]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Pipeline de Leads</h1>
          <p className="text-[12px] text-muted-foreground/60 mt-1 font-medium">
            {leads.length} leads ativos — arraste para mudar a temperatura
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
          <Plus className="w-4 h-4" />
          Novo Lead
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {(["hot", "warm", "cold"] as const).map((temp) => {
          const config = tempConfig[temp];
          const TempIcon = config.icon;
          const isOver = dropTarget === temp;
          const draggedLead = leads.find((l) => l.id === draggingId);
          const isValidDrop = draggingId !== null && draggedLead?.temperature !== temp;

          return (
            <div
              key={temp}
              className={`rounded-2xl border-2 transition-all duration-200 ${
                isOver && isValidDrop
                  ? `ring-2 ${config.dropHighlight} border-dashed`
                  : draggingId !== null && isValidDrop
                    ? "border-dashed border-border/60"
                    : "border-transparent"
              }`}
              onDragEnter={(e) => onDragEnterColumn(e, temp)}
              onDragLeave={() => onDragLeaveColumn(temp)}
              onDragOver={onDragOverColumn}
              onDrop={(e) => onDropColumn(e, temp)}
            >
              <div className={`bg-gradient-to-r ${config.headerGradient} rounded-t-2xl px-4 py-3 flex items-center gap-2`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${config.bg}`}>
                  <TempIcon className={`w-3.5 h-3.5 ${config.color}`} />
                </div>
                <h2 className="text-sm font-semibold flex-1">{config.label}</h2>
                <Badge variant="secondary" className="text-[10px] font-bold">{grouped[temp].length}</Badge>
              </div>

              <div className="p-3 space-y-3 min-h-[250px]">
                {isOver && isValidDrop && (
                  <div className={`border-2 border-dashed rounded-xl p-3 text-center transition-all ${config.bg} ${config.color}`}>
                    <p className="text-xs font-medium">Soltar aqui para mover para {config.label}</p>
                  </div>
                )}

                {grouped[temp].map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}

                {grouped[temp].length === 0 && !isOver && (
                  <div className="border border-dashed border-border rounded-xl p-8 text-center">
                    <Target className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">Nenhum lead {config.label.toLowerCase()}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Arraste um lead para ca</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Lead" : "Novo Lead"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do lead" />
            </div>
            <div className="space-y-2">
              <Label>Telefone *</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+55 11 99999-0000" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Temperatura</Label>
                <Select value={form.temperature} onValueChange={(v) => setForm({ ...form, temperature: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cold">Frio</SelectItem>
                    <SelectItem value="warm">Morno</SelectItem>
                    <SelectItem value="hot">Quente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fonte</Label>
                <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Instagram, Google..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Interesse</Label>
              <Input value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} placeholder="Clareamento, implante..." />
            </div>
            <div className="space-y-2">
              <Label>Observacoes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre o lead" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.name || !form.phone}>
              {editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
