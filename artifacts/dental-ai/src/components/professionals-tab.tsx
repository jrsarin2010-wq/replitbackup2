import { useState, useEffect, useRef } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { getTenantPlan } from "@/lib/api-config";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, User, Clock, Coffee, GraduationCap, Loader2, Users, CreditCard, ExternalLink, X, Heart, DollarSign, Shield, AtSign, Star, Video, Music, Upload, Trash2, PlayCircle, Image as ImageIcon, Tag,
} from "lucide-react";

const DAY_LABELS: Record<string, string> = {
  "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui", "5": "Sex", "6": "Sab",
};

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
  chargesConsultation: boolean;
  defaultLeadDurationMinutes: number;
  defaultPatientDurationMinutes: number;
  insurancePlans: string | null;
  insuranceDays: string | null;
  insuranceHoursStart: string | null;
  insuranceHoursEnd: string | null;
  instagramUrl: string | null;
  profilePhotoUrl: string | null;
  welcomeVideoUrl: string | null;
  welcomeAudioUrl: string | null;
  pixKey: string | null;
  pixEnabled: boolean;
  pixMode: string;
  pixBank: string | null;
  pixKeyType: string | null;
  isOwner: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProfessionalForm {
  name: string;
  specialties: string[];
  cro: string;
  workingDays: string[];
  workingHoursStart: string;
  workingHoursEnd: string;
  lunchStart: string;
  lunchEnd: string;
  acceptsInsurance: boolean;
  consultationFee: string;
  chargesConsultation: boolean;
  defaultLeadDurationMinutes: string;
  defaultPatientDurationMinutes: string;
  insurancePlans: string;
  insuranceDays: string[];
  insuranceHoursStart: string;
  insuranceHoursEnd: string;
  instagramUrl: string;
  profilePhotoUrl: string;
  pixEnabled: boolean;
  pixKey: string;
  pixMode: "optional" | "required";
  pixBank: string;
  pixKeyType: "" | "cpf" | "cnpj" | "email" | "phone" | "random";
}

const defaultForm: ProfessionalForm = {
  name: "",
  specialties: [],
  cro: "",
  workingDays: ["1", "2", "3", "4", "5"],
  workingHoursStart: "08:00",
  workingHoursEnd: "18:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  acceptsInsurance: false,
  consultationFee: "",
  chargesConsultation: true,
  defaultLeadDurationMinutes: "30",
  defaultPatientDurationMinutes: "30",
  insurancePlans: "",
  insuranceDays: [],
  insuranceHoursStart: "08:00",
  insuranceHoursEnd: "12:00",
  instagramUrl: "",
  profilePhotoUrl: "",
  pixEnabled: false,
  pixKey: "",
  pixMode: "optional",
  pixBank: "",
  pixKeyType: "",
};

interface ProfessionalsResponse {
  professionals: Professional[];
  maxProfessionals: number;
}

function useProfessionals() {
  return useQuery<ProfessionalsResponse>({
    queryKey: ["/api/dental/professionals", "all"],
    queryFn: async () => {
      const res = await fetch("/api/dental/professionals?includeInactive=true");
      if (!res.ok) throw new Error("Erro ao carregar profissionais");
      return res.json();
    },
  });
}

const BASE = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) ? import.meta.env.BASE_URL : "/";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export default function ProfessionalsTab() {
  const { data: profData, isLoading } = useProfessionals();
  const professionals = profData?.professionals;
  const maxProfessionals = profData?.maxProfessionals ?? 1;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<ProfessionalForm>(defaultForm);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [purchaseQty, setPurchaseQty] = useState(1);
  const [purchasing, setPurchasing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  async function uploadFileDirectly(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    const res = await fetch(`${BASE}api/storage/uploads/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Erro ao enviar arquivo");
    const { objectPath } = await res.json();
    return objectPath as string;
  }

  async function handlePhotoUpload(file: File) {
    if (file.size > MAX_PHOTO_BYTES) {
      toast({ title: "Arquivo muito grande", description: "A foto deve ter no máximo 5MB.", variant: "destructive" });
      return;
    }
    setUploadingPhoto(true);
    try {
      const objectPath = await uploadFileDirectly(file);
      const servingUrl = `${BASE}api/storage${objectPath}`;
      setForm((f) => ({ ...f, profilePhotoUrl: servingUrl }));
      toast({ title: "Foto carregada!", description: "A foto foi carregada com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro ao enviar foto", description: err.message, variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
    }
  }

  // Task #31: only Pro can purchase, and the global cap of *purchasable*
  // extras (beyond what the plan already includes) is now 1.
  // Pro = titular + 1 incluso + opção de +1 extra pago.
  const MAX_EXTRA_PROFESSIONALS = 1;
  const PLAN_INCLUDED_PROFESSIONALS: Record<string, number> = {
    free: 1,
    essencial: 1,
    pro: 2,
  };
  const currentPlan = getTenantPlan();
  const isPro = currentPlan === "pro";
  const planIncluded = PLAN_INCLUDED_PROFESSIONALS[currentPlan ?? ""] ?? 1;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("slot_purchased") === "1") {
      params.delete("slot_purchased");
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      qc.refetchQueries({ queryKey: ["/api/dental/professionals", "all"] }).then(() => {
        openCreate();
        toast({
          title: "Slot liberado!",
          description: "Pagamento confirmado. Cadastre agora o novo profissional.",
        });
      });
    }
  }, []);

  const ownerProfessional = professionals?.find((p) => p.isOwner) || null;
  const extraProfessionals = professionals?.filter((p) => !p.isOwner) || [];
  const extraActive = extraProfessionals.filter((p) => p.isActive).length;
  // Total non-titular slots the tenant currently has access to (included by
  // plan + already-purchased extras).
  const maxExtraSlots = Math.max(0, maxProfessionals - 1);
  // How many extras have actually been *purchased* on top of the plan's
  // included quota — this is what counts against MAX_EXTRA_PROFESSIONALS.
  const purchasedExtras = Math.max(0, maxProfessionals - planIncluded);
  const slotsRestantes = Math.max(0, MAX_EXTRA_PROFESSIONALS - purchasedExtras);
  const atProductMax = slotsRestantes <= 0;
  const atSlotsLimit = maxExtraSlots > 0 && extraActive >= maxExtraSlots;

  const createMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch("/api/dental/professionals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar profissional");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Profissional cadastrado!" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/dental/professionals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao atualizar profissional");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Profissional atualizado!" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/dental/professionals/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao desativar");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Profissional desativado" });
    },
  });

  const reactivateMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/dental/professionals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) throw new Error("Erro ao reativar");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Profissional reativado" });
    },
  });

  function openCreate() {
    setForm(defaultForm);
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(prof: Professional) {
    const specialtiesArr = prof.specialties
      ? prof.specialties.split(",").map((s) => s.trim()).filter(Boolean)
      : prof.specialty
        ? [prof.specialty.trim()]
        : [];
    setForm({
      name: prof.name,
      specialties: specialtiesArr,
      cro: prof.cro || "",
      workingDays: prof.workingDays.split(",").map((d) => d.trim()),
      workingHoursStart: prof.workingHoursStart,
      workingHoursEnd: prof.workingHoursEnd,
      lunchStart: prof.lunchStart,
      lunchEnd: prof.lunchEnd,
      acceptsInsurance: prof.acceptsInsurance ?? false,
      consultationFee: prof.consultationFee || "",
      chargesConsultation: prof.chargesConsultation ?? true,
      defaultLeadDurationMinutes: String(prof.defaultLeadDurationMinutes ?? 30),
      defaultPatientDurationMinutes: String(prof.defaultPatientDurationMinutes ?? 30),
      insurancePlans: prof.insurancePlans || "",
      insuranceDays: prof.insuranceDays ? prof.insuranceDays.split(",").filter(Boolean) : [],
      insuranceHoursStart: prof.insuranceHoursStart || "08:00",
      insuranceHoursEnd: prof.insuranceHoursEnd || "12:00",
      instagramUrl: prof.instagramUrl || "",
      profilePhotoUrl: prof.profilePhotoUrl || "",
      pixEnabled: prof.pixEnabled ?? false,
      pixKey: prof.pixKey || "",
      pixMode: (prof.pixMode === "required" ? "required" : "optional") as "optional" | "required",
      pixBank: prof.pixBank || "",
      pixKeyType: (["cpf","cnpj","email","phone","random"].includes(prof.pixKeyType || "") ? prof.pixKeyType : "") as ProfessionalForm["pixKeyType"],
    });
    setEditId(prof.id);
    setDialogOpen(true);
  }

  function handleSubmit() {
    const specialtiesStr = form.specialties.join(",");
    const payload = {
      name: form.name,
      specialties: specialtiesStr || null,
      specialty: form.specialties[0] || null,
      cro: form.cro || null,
      workingDays: form.workingDays.join(","),
      workingHoursStart: form.workingHoursStart,
      workingHoursEnd: form.workingHoursEnd,
      lunchStart: form.lunchStart,
      lunchEnd: form.lunchEnd,
      acceptsInsurance: form.acceptsInsurance,
      consultationFee: form.consultationFee || null,
      chargesConsultation: form.chargesConsultation,
      defaultLeadDurationMinutes: Number(form.defaultLeadDurationMinutes),
      defaultPatientDurationMinutes: Number(form.defaultPatientDurationMinutes),
      insurancePlans: form.insurancePlans || null,
      insuranceDays: form.insuranceDays.join(",") || null,
      insuranceHoursStart: form.acceptsInsurance ? (form.insuranceHoursStart || null) : null,
      insuranceHoursEnd: form.acceptsInsurance ? (form.insuranceHoursEnd || null) : null,
      instagramUrl: form.instagramUrl || null,
      profilePhotoUrl: form.profilePhotoUrl || null,
      pixEnabled: form.pixEnabled,
      pixKey: form.pixEnabled ? (form.pixKey || null) : null,
      pixMode: form.pixMode,
      pixBank: form.pixEnabled ? (form.pixBank.trim() || null) : null,
      pixKeyType: form.pixEnabled && form.pixKeyType ? form.pixKeyType : null,
    };
    if (editId) {
      updateMut.mutate({ id: editId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(day)
        ? f.workingDays.filter((d) => d !== day)
        : [...f.workingDays, day].sort(),
    }));
  }

  async function handlePurchaseSlot() {
    const cleanTax = taxId.replace(/\D/g, "");
    if (cleanTax.length !== 11 && cleanTax.length !== 14) {
      toast({ title: "CPF/CNPJ inválido", description: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.", variant: "destructive" });
      return;
    }
    setPurchasing(true);
    try {
      const res = await fetch("/api/dental/professionals/purchase-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxId: cleanTax, quantity: purchaseQty }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao gerar cobrança");
      }
      const data = await res.json();
      if (data.url) {
        setPurchaseOpen(false);
        setTaxId("");
        setPurchaseQty(1);
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro ao gerar cobrança", variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  }

  const canAddProfessional = maxExtraSlots > extraActive;

  return (
    <div className="space-y-6">
      {/* Titular section */}
      <Card className="premium-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            Profissional Titular
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            O dentista responsável pela clínica
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : ownerProfessional ? (
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/40 bg-card hover:border-primary/30 transition-all">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl premium-icon-box flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm truncate">{ownerProfessional.name}</p>
                    <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4 font-medium bg-primary/10 text-primary">
                      <Star className="w-2.5 h-2.5" /> Titular
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {(() => {
                      const specs = ownerProfessional.specialties
                        ? ownerProfessional.specialties.split(",").map(s => s.trim()).filter(Boolean)
                        : ownerProfessional.specialty ? [ownerProfessional.specialty] : [];
                      return specs.map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4 font-medium">
                          <GraduationCap className="w-2.5 h-2.5" /> {s}
                        </Badge>
                      ));
                    })()}
                    {ownerProfessional.instagramUrl && (
                      <a
                        href={ownerProfessional.instagramUrl.startsWith("http") ? ownerProfessional.instagramUrl : `https://instagram.com/${ownerProfessional.instagramUrl.replace(/^@/, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-pink-600 dark:text-pink-400 font-medium flex items-center gap-0.5 hover:underline"
                      >
                        <AtSign className="w-2.5 h-2.5" />
                        {ownerProfessional.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}
                      </a>
                    )}
                    {ownerProfessional.cro && (
                      <span className="text-[11px] text-muted-foreground/60 font-medium">CRO: {ownerProfessional.cro}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/50">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {ownerProfessional.workingHoursStart}-{ownerProfessional.workingHoursEnd}</span>
                    <span className="flex items-center gap-1"><Coffee className="w-3 h-3" /> {ownerProfessional.lunchStart}-{ownerProfessional.lunchEnd}</span>
                    <span>
                      {ownerProfessional.workingDays.split(",").map((d) => DAY_LABELS[d.trim()] || d).join(", ")}
                    </span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={() => openEdit(ownerProfessional)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60 text-center py-4">Profissional titular não encontrado</p>
          )}
        </CardContent>
      </Card>

      <Card className="premium-card rounded-2xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Profissionais Extras
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                {isPro
                  ? "Até 1 profissional extra além do titular + 1 incluso — R$97/mês"
                  : "Profissionais extras estão disponíveis apenas no plano Pro"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {maxExtraSlots > 0 && (
                <Badge variant="outline" className="text-xs font-semibold gap-1.5 px-3 py-1">
                  <User className="w-3 h-3" />
                  {maxExtraSlots}/{Math.max(0, planIncluded - 1) + MAX_EXTRA_PROFESSIONALS} slots
                </Badge>
              )}
              {canAddProfessional ? (
                <Button
                  onClick={openCreate}
                  className="gap-2 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all h-9 px-4"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar
                </Button>
              ) : !isPro ? (
                <Link href="/subscription">
                  <Button
                    className="gap-2 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all h-9 px-4"
                  >
                    <Star className="w-4 h-4" />
                    Fazer upgrade para Pro
                  </Button>
                </Link>
              ) : atProductMax ? (
                <Badge variant="secondary" className="text-xs px-3 py-1.5 gap-1.5 font-semibold">
                  <User className="w-3 h-3" />
                  Limite Pro atingido
                </Badge>
              ) : (
                <Button
                  onClick={() => { setPurchaseQty(1); setPurchaseOpen(true); }}
                  className="gap-2 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all h-9 px-4"
                >
                  <CreditCard className="w-4 h-4" />
                  Comprar
                </Button>
              )}
            </div>
          </div>

          {/* Banner: sem slots ainda */}
          {maxExtraSlots === 0 && !isPro && (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                  Seu plano atual inclui apenas o profissional titular. Faça upgrade para o <strong>plano Pro</strong> para ter +1 profissional incluso e a opção de adicionar +1 extra por R$97/mês.
                </p>
                <Link href="/subscription">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1.5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 whitespace-nowrap flex-shrink-0"
                  >
                    <Star className="w-3 h-3" />
                    Ver plano Pro
                  </Button>
                </Link>
              </div>
            </div>
          )}
          {maxExtraSlots === 0 && isPro && (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                  Você ainda não possui slots para profissionais extras. Adicione por <strong>R$97/mês</strong> — pague via PIX ou Cartão de Crédito.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1.5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 whitespace-nowrap flex-shrink-0"
                  onClick={() => { setPurchaseQty(1); setPurchaseOpen(true); }}
                >
                  <CreditCard className="w-3 h-3" />
                  Adicionar profissional
                </Button>
              </div>
            </div>
          )}

          {/* Banner: slots ocupados, ainda pode comprar mais */}
          {atSlotsLimit && !atProductMax && (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                  Todos os {maxExtraSlots} slot{maxExtraSlots > 1 ? "s" : ""} estão ocupados.
                  Ainda é possível adicionar até <strong>{slotsRestantes} profissional{slotsRestantes > 1 ? "is" : ""}</strong> extra{slotsRestantes > 1 ? "s" : ""} por <strong>R$97/mês</strong> cada — pague via PIX ou Cartão de Crédito.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1.5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 whitespace-nowrap flex-shrink-0"
                  onClick={() => { setPurchaseQty(1); setPurchaseOpen(true); }}
                >
                  <CreditCard className="w-3 h-3" />
                  Comprar slot
                </Button>
              </div>
            </div>
          )}

          {/* Banner: limite do plano atingido */}
          {atProductMax && atSlotsLimit && (
            <div className="mt-3 p-3 rounded-xl bg-muted/60 border border-border/40">
              <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                Limite do plano Pro atingido — titular + 1 incluso + 1 extra. Para ampliar a equipe, entre em contato com o suporte.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : extraProfessionals.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhum profissional extra cadastrado</p>
              <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed">
                O profissional titular já está configurado na aba <span className="font-semibold text-foreground/70">Clínica</span>. Aqui você adiciona profissionais adicionais por R$97/mês cada.
              </p>
            </div>
          ) : (
            extraProfessionals.map((prof) => {
              return (
              <div
                key={prof.id}
                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                  prof.isActive
                    ? "bg-card border-border/40 hover:border-primary/30"
                    : "bg-muted/30 border-border/20 opacity-60"
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl premium-icon-box flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{prof.name}</p>
                      {!prof.isActive && (
                        <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {(() => {
                        const specs = prof.specialties
                          ? prof.specialties.split(",").map(s => s.trim()).filter(Boolean)
                          : prof.specialty ? [prof.specialty] : [];
                        return specs.map((s, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4 font-medium">
                            <GraduationCap className="w-2.5 h-2.5" /> {s}
                          </Badge>
                        ));
                      })()}
                      {prof.acceptsInsurance && (
                        <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4 font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          <Heart className="w-2.5 h-2.5" /> Convênio
                        </Badge>
                      )}
                      {prof.consultationFee && (
                        <span className="text-[10px] text-muted-foreground/60 font-medium flex items-center gap-0.5">
                          <DollarSign className="w-2.5 h-2.5" /> R${prof.consultationFee}
                        </span>
                      )}
                      {prof.instagramUrl && (
                        <a
                          href={prof.instagramUrl.startsWith("http") ? prof.instagramUrl : `https://instagram.com/${prof.instagramUrl.replace(/^@/, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-pink-600 dark:text-pink-400 font-medium flex items-center gap-0.5 hover:underline"
                        >
                          <AtSign className="w-2.5 h-2.5" />
                          {prof.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}
                        </a>
                      )}
                      {prof.cro && (
                        <span className="text-[11px] text-muted-foreground/60 font-medium">
                          CRO: {prof.cro}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/50">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {prof.workingHoursStart}-{prof.workingHoursEnd}
                      </span>
                      <span className="flex items-center gap-1">
                        <Coffee className="w-3 h-3" /> {prof.lunchStart}-{prof.lunchEnd}
                      </span>
                      <span>
                        {prof.workingDays.split(",").map((d) => DAY_LABELS[d.trim()] || d).join(", ")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(prof)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {prof.isActive ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Desativar ${prof.name}?`)) deactivateMut.mutate(prof.id);
                      }}
                    >
                      Desativar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-emerald-600"
                      onClick={() => reactivateMut.mutate(prof.id)}
                    >
                      Reativar
                    </Button>
                  )}
                </div>
              </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {professionals && professionals.length > 0 && (
        <WelcomeMediaCard professionals={professionals} />
      )}

      {professionals && professionals.length > 0 && (
        <PortfolioCard professionals={professionals} />
      )}

      <Dialog open={purchaseOpen} onOpenChange={(open) => { setPurchaseOpen(open); if (!open) { setTaxId(""); setPurchaseQty(1); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              Adicionar Profissional Adicional
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cada profissional adicional custa R$97/mês. Você escolhe a forma de pagamento na próxima etapa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Métodos de pagamento aceitos */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-border/40">
              <p className="text-[11px] text-muted-foreground font-medium flex-1">Formas de pagamento aceitas:</p>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-lg px-2 py-0.5">
                  <CreditCard className="w-3 h-3" /> Cartão de Crédito
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg px-2 py-0.5">
                  <DollarSign className="w-3 h-3" /> PIX
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Quantos profissionais deseja adicionar?</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    className="px-4 py-2 text-lg font-bold hover:bg-muted transition-colors disabled:opacity-40"
                    onClick={() => setPurchaseQty((q) => Math.max(1, q - 1))}
                    disabled={purchaseQty <= 1}
                  >−</button>
                  <span className="px-5 py-2 text-base font-bold min-w-[3rem] text-center">{purchaseQty}</span>
                  <button
                    type="button"
                    className="px-4 py-2 text-lg font-bold hover:bg-muted transition-colors disabled:opacity-40"
                    onClick={() => setPurchaseQty((q) => Math.min(slotsRestantes, q + 1))}
                    disabled={purchaseQty >= slotsRestantes}
                  >+</button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {slotsRestantes === 1
                    ? "Você pode adicionar 1 profissional extra"
                    : `Você pode adicionar até ${slotsRestantes} profissionais extras`}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm">
                    +{purchaseQty} profissional{purchaseQty > 1 ? "is" : ""} adicional{purchaseQty > 1 ? "is" : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {purchaseQty} × R$97/mês
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    R${(97 * purchaseQty).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">/mês</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">CPF ou CNPJ para cobrança</Label>
              <Input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                className="rounded-xl h-10"
              />
              <p className="text-[10px] text-muted-foreground">Necessário para identificação na cobrança</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseOpen(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              onClick={handlePurchaseSlot}
              disabled={purchasing || !taxId.replace(/\D/g, "")}
              className="rounded-xl shadow-md shadow-primary/20 gap-2"
            >
              {purchasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Ir para Pagamento — R${(97 * purchaseQty).toLocaleString("pt-BR")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editId ? "Editar Profissional" : "Novo Profissional Extra"}
            </DialogTitle>
            {!editId && (
              <p className="text-xs text-muted-foreground pt-1">Este profissional será cobrado <strong>R$97/mês</strong> separadamente do plano do titular.</p>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label className="text-xs font-semibold">Nome *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Dr. João Silva"
                  className="rounded-xl h-10"
                />
              </div>

              <div className="space-y-2 col-span-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <GraduationCap className="w-3 h-3" /> Especialidades
                </Label>
                <div className={`min-h-10 rounded-xl border bg-background px-3 py-2 flex flex-wrap gap-1.5 items-center cursor-text transition-colors ${form.specialties.length > 0 ? "border-border" : "border-input"}`}
                  onClick={(e) => {
                    const input = (e.currentTarget as HTMLElement).querySelector("input");
                    input?.focus();
                  }}
                >
                  {form.specialties.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[11px] font-semibold rounded-lg px-2 py-0.5">
                      {s}
                      <button
                        type="button"
                        className="ml-0.5 hover:text-destructive transition-colors"
                        onClick={() => setForm((f) => ({ ...f, specialties: f.specialties.filter((_, idx) => idx !== i) }))}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    className="flex-1 min-w-[120px] text-[13px] bg-transparent outline-none placeholder:text-muted-foreground/50 h-6"
                    placeholder={form.specialties.length === 0 ? "Ortodontia, Implante, Clínica Geral..." : "Adicionar..."}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim().replace(/,$/, "");
                        if (val && !form.specialties.includes(val)) {
                          setForm((f) => ({ ...f, specialties: [...f.specialties, val] }));
                          e.currentTarget.value = "";
                        }
                      } else if (e.key === "Backspace" && !e.currentTarget.value && form.specialties.length > 0) {
                        setForm((f) => ({ ...f, specialties: f.specialties.slice(0, -1) }));
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.value.trim().replace(/,$/, "");
                      if (val && !form.specialties.includes(val)) {
                        setForm((f) => ({ ...f, specialties: [...f.specialties, val] }));
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/60">Pressione Enter ou vírgula para adicionar cada especialidade</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">CRO</Label>
                <Input
                  value={form.cro}
                  onChange={(e) => setForm({ ...form, cro: e.target.value })}
                  placeholder="CRO-SP 12345"
                  className="rounded-xl h-10"
                />
              </div>

              <div className="space-y-2 col-span-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <AtSign className="w-3 h-3 text-pink-500" /> Instagram
                </Label>
                <Input
                  value={form.instagramUrl}
                  onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
                  placeholder="@drjoaosilva ou https://instagram.com/drjoaosilva"
                  className="rounded-xl h-10"
                />
                <p className="text-[10px] text-muted-foreground/60">A IA encaminhará este link ao paciente quando solicitado</p>
              </div>

              <div className="space-y-2 col-span-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="w-3 h-3 text-pink-500" /> Foto de Perfil
                </Label>
                <div className="flex items-center gap-3">
                  {form.profilePhotoUrl ? (
                    <div className="relative shrink-0">
                      <img
                        src={form.profilePhotoUrl}
                        alt="Foto de perfil"
                        className="w-14 h-14 rounded-xl object-cover border border-border/50"
                      />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, profilePhotoUrl: "" })}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : null}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handlePhotoUpload(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl h-10 gap-2"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {form.profilePhotoUrl ? "Alterar foto" : "Escolher foto"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/60">Foto do profissional (máx. 5MB). Será enviada junto com o link do Instagram como um card elegante no WhatsApp.</p>
              </div>
            </div>

            <div className="pt-3 border-t border-border/40 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-primary" /> Consulta Inicial</p>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card">
                <div>
                  <p className="text-xs font-semibold">Cobrar consulta / avaliação</p>
                  <p className="text-[10px] text-muted-foreground/60">Se desativado, a consulta inicial será gratuita</p>
                </div>
                <Switch
                  checked={form.chargesConsultation}
                  onCheckedChange={(v) => setForm({ ...form, chargesConsultation: v })}
                />
              </div>
              {form.chargesConsultation && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Valor da Consulta (R$)</Label>
                  <Input
                    value={form.consultationFee}
                    onChange={(e) => setForm({ ...form, consultationFee: e.target.value })}
                    placeholder="150,00"
                    className="rounded-xl h-10 max-w-[200px]"
                  />
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border/40 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <span className="text-green-500 font-bold text-sm">PIX</span> Pagamento via PIX
              </p>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card">
                <div>
                  <p className="text-xs font-semibold">Aceitar pagamento via PIX</p>
                  <p className="text-[10px] text-muted-foreground/60">A IA informará a chave PIX ao paciente</p>
                </div>
                <Switch
                  checked={form.pixEnabled}
                  onCheckedChange={(v) => setForm({ ...form, pixEnabled: v })}
                />
              </div>
              {form.pixEnabled && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Tipo de chave</Label>
                      <Select value={form.pixKeyType || ""} onValueChange={(v) => setForm({ ...form, pixKeyType: (v || "") as ProfessionalForm["pixKeyType"] })}>
                        <SelectTrigger className="rounded-xl h-10">
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cpf">CPF</SelectItem>
                          <SelectItem value="cnpj">CNPJ</SelectItem>
                          <SelectItem value="email">E-mail</SelectItem>
                          <SelectItem value="phone">Telefone</SelectItem>
                          <SelectItem value="random">Chave aleatória</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground/60">Opcional — aparece no cartão enviado ao paciente</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Banco</Label>
                      <Input
                        value={form.pixBank}
                        onChange={(e) => setForm({ ...form, pixBank: e.target.value })}
                        placeholder="Ex.: Nubank, Itaú, Banco do Brasil"
                        className="rounded-xl h-10"
                      />
                      <p className="text-[10px] text-muted-foreground/60">Opcional — aparece no cartão enviado ao paciente</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Chave PIX</Label>
                    <Input
                      value={form.pixKey}
                      onChange={(e) => setForm({ ...form, pixKey: e.target.value })}
                      placeholder="CPF, e-mail, telefone ou chave aleatória"
                      className="rounded-xl h-10"
                    />
                    <p className="text-[10px] text-muted-foreground/60">A IA usará esta chave ao informar dados de pagamento</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Modo de pagamento</Label>
                    <Select value={form.pixMode} onValueChange={(v) => setForm({ ...form, pixMode: v as "optional" | "required" })}>
                      <SelectTrigger className="rounded-xl h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="optional">Opcional — IA informa o PIX só quando o paciente perguntar e pede o comprovante</SelectItem>
                        <SelectItem value="required">Obrigatório — pagamento antes do atendimento, IA envia o PIX e aguarda o comprovante para confirmar</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground/60">
                      {form.pixMode === "required"
                        ? "Modo obrigatório: a IA explica que o pagamento da consulta é feito antes do atendimento, envia a chave PIX assim que o horário é escolhido, solicita o comprovante e SÓ confirma o agendamento depois de recebê-lo."
                        : "Modo opcional: a IA só informa a chave PIX quando o paciente perguntar sobre pagamento ou quiser pagar antecipado. Após enviar a chave, pede o comprovante para registro — mas não bloqueia o agendamento (o paciente também pode pagar na clínica)."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border/40 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> Duração de Atendimento</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Leads / Avaliação Inicial</Label>
                  <p className="text-[10px] text-muted-foreground/60 -mt-1">Primeiro contato</p>
                  <Select value={form.defaultLeadDurationMinutes} onValueChange={(v) => setForm({ ...form, defaultLeadDurationMinutes: v })}>
                    <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutos</SelectItem>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="45">45 minutos</SelectItem>
                      <SelectItem value="60">1 hora</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Pacientes / Retorno</Label>
                  <p className="text-[10px] text-muted-foreground/60 -mt-1">Pacientes cadastrados</p>
                  <Select value={form.defaultPatientDurationMinutes} onValueChange={(v) => setForm({ ...form, defaultPatientDurationMinutes: v })}>
                    <SelectTrigger className="rounded-xl h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutos</SelectItem>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="45">45 minutos</SelectItem>
                      <SelectItem value="60">1 hora</SelectItem>
                      <SelectItem value="90">1h30</SelectItem>
                      <SelectItem value="120">2 horas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border/40 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-primary" /> Convênio / Plano Dental</p>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-emerald-600" />
                  <div>
                    <p className="text-xs font-semibold">Aceita Convênio / Plano</p>
                    <p className="text-[10px] text-muted-foreground/60">Este profissional atende por convênio</p>
                  </div>
                </div>
                <Switch
                  checked={form.acceptsInsurance}
                  onCheckedChange={(v) => setForm({ ...form, acceptsInsurance: v })}
                />
              </div>
              {form.acceptsInsurance && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Planos aceitos</Label>
                    <Textarea
                      value={form.insurancePlans}
                      onChange={(e) => setForm({ ...form, insurancePlans: e.target.value })}
                      placeholder="Bradesco Dental, Amil Dental, SulAmerica Odonto..."
                      rows={2}
                      className="rounded-xl"
                    />
                    <p className="text-[10px] text-muted-foreground/60">Separe por vírgula ou um por linha</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Dias de atendimento por convênio</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {["1", "2", "3", "4", "5", "6"].map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setForm((f) => ({
                            ...f,
                            insuranceDays: f.insuranceDays.includes(day)
                              ? f.insuranceDays.filter((d) => d !== day)
                              : [...f.insuranceDays, day].sort(),
                          }))}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            form.insuranceDays.includes(day)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {DAY_LABELS[day]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Horário início (convênio)</Label>
                      <Input type="time" value={form.insuranceHoursStart} onChange={(e) => setForm({ ...form, insuranceHoursStart: e.target.value })} className="rounded-xl h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Horário fim (convênio)</Label>
                      <Input type="time" value={form.insuranceHoursEnd} onChange={(e) => setForm({ ...form, insuranceHoursEnd: e.target.value })} className="rounded-xl h-10" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border/40 space-y-2">
              <Label className="text-xs font-semibold">Dias de Atendimento</Label>
              <div className="flex gap-1.5 flex-wrap">
                {["0", "1", "2", "3", "4", "5", "6"].map((day) => (
                  <Button
                    key={day}
                    type="button"
                    variant={form.workingDays.includes(day) ? "default" : "outline"}
                    size="sm"
                    className={`h-8 w-12 text-xs font-semibold rounded-lg ${
                      form.workingDays.includes(day) ? "shadow-md shadow-primary/20" : ""
                    }`}
                    onClick={() => toggleDay(day)}
                  >
                    {DAY_LABELS[day]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Inicio Expediente
                </Label>
                <Input
                  type="time"
                  value={form.workingHoursStart}
                  onChange={(e) => setForm({ ...form, workingHoursStart: e.target.value })}
                  className="rounded-xl h-10"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Fim Expediente
                </Label>
                <Input
                  type="time"
                  value={form.workingHoursEnd}
                  onChange={(e) => setForm({ ...form, workingHoursEnd: e.target.value })}
                  className="rounded-xl h-10"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Coffee className="w-3 h-3" /> Inicio Almoco
                </Label>
                <Input
                  type="time"
                  value={form.lunchStart}
                  onChange={(e) => setForm({ ...form, lunchStart: e.target.value })}
                  className="rounded-xl h-10"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Coffee className="w-3 h-3" /> Fim Almoco
                </Label>
                <Input
                  type="time"
                  value={form.lunchEnd}
                  onChange={(e) => setForm({ ...form, lunchEnd: e.target.value })}
                  className="rounded-xl h-10"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name || createMut.isPending || updateMut.isPending}
              className="rounded-xl shadow-md shadow-primary/20"
            >
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editId ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

interface WelcomeMediaCardProps {
  professionals: Professional[];
}

function WelcomeMediaCard({ professionals }: WelcomeMediaCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploadingVideo, setUploadingVideo] = useState<Record<number, boolean>>({});
  const [uploadingAudio, setUploadingAudio] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const audioRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const activeProfessionals = professionals.filter((p) => p.isActive);

  async function uploadToStorage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    const res = await fetch(`${BASE}api/storage/uploads/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Erro ao enviar arquivo");
    const { objectPath } = await res.json();
    return objectPath as string;
  }

  async function updateProfessional(id: number, fields: { welcomeVideoUrl?: string | null; welcomeAudioUrl?: string | null }) {
    const res = await fetch(`${BASE}api/dental/professionals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error("Erro ao atualizar profissional");
    return res.json();
  }

  async function handleVideoUpload(prof: Professional, file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      toast({ title: "Arquivo muito grande", description: "O vídeo deve ter no máximo 30MB.", variant: "destructive" });
      return;
    }
    setUploadingVideo((v) => ({ ...v, [prof.id]: true }));
    try {
      const objectPath = await uploadToStorage(file);
      const servingUrl = `${BASE}api/storage${objectPath}`;
      await updateProfessional(prof.id, { welcomeVideoUrl: servingUrl });
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Vídeo salvo!", description: `Vídeo de boas-vindas de ${prof.name} atualizado.` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVideo((v) => ({ ...v, [prof.id]: false }));
    }
  }

  async function handleAudioUpload(prof: Professional, file: File) {
    if (file.size > MAX_AUDIO_BYTES) {
      toast({ title: "Arquivo muito grande", description: "O áudio deve ter no máximo 10MB.", variant: "destructive" });
      return;
    }
    setUploadingAudio((a) => ({ ...a, [prof.id]: true }));
    try {
      const objectPath = await uploadToStorage(file);
      const servingUrl = `${BASE}api/storage${objectPath}`;
      await updateProfessional(prof.id, { welcomeAudioUrl: servingUrl });
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Áudio salvo!", description: `Áudio de boas-vindas de ${prof.name} atualizado.` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploadingAudio((a) => ({ ...a, [prof.id]: false }));
    }
  }

  async function handleRemoveVideo(prof: Professional) {
    try {
      await updateProfessional(prof.id, { welcomeVideoUrl: null });
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Vídeo removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  }

  async function handleRemoveAudio(prof: Professional) {
    try {
      await updateProfessional(prof.id, { welcomeAudioUrl: null });
      qc.invalidateQueries({ queryKey: ["/api/dental/professionals"] });
      toast({ title: "Áudio removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Card className="premium-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Video className="w-4 h-4 text-primary" />
          Mensagem de Boas-Vindas
        </CardTitle>
        <CardDescription className="text-xs mt-1">
          Configure o vídeo e áudio que serão enviados automaticamente para novos leads após a primeira consulta ser agendada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {activeProfessionals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhum profissional ativo cadastrado.</p>
        ) : (
          activeProfessionals.map((prof) => (
            <div key={prof.id} className="p-4 rounded-xl border border-border/40 bg-card space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg premium-icon-box flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 text-primary" />
                </div>
                <p className="font-semibold text-sm">{prof.name}</p>
                {prof.isOwner && (
                  <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0 h-4 bg-primary/10 text-primary">
                    <Star className="w-2.5 h-2.5" /> Titular
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Video */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Video className="w-3 h-3" /> Vídeo de Boas-Vindas
                  </Label>
                  {prof.welcomeVideoUrl ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/30">
                      <PlayCircle className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-[11px] text-muted-foreground flex-1 truncate">Vídeo configurado</span>
                      <a
                        href={prof.welcomeVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary hover:underline shrink-0"
                      >
                        Ver
                      </a>
                      <button
                        type="button"
                        className="text-destructive hover:text-destructive/80 transition-colors shrink-0"
                        onClick={() => handleRemoveVideo(prof)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-border/40 hover:border-primary/40 cursor-pointer transition-colors"
                      onClick={() => videoRefs.current[prof.id]?.click()}
                    >
                      {uploadingVideo[prof.id] ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {uploadingVideo[prof.id] ? "Enviando..." : "Clique para selecionar (máx. 30MB)"}
                      </span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    ref={(el) => { videoRefs.current[prof.id] = el; }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleVideoUpload(prof, file);
                      e.target.value = "";
                    }}
                  />
                </div>

                {/* Audio */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Music className="w-3 h-3" /> Áudio de Boas-Vindas
                  </Label>
                  {prof.welcomeAudioUrl ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/30">
                      <Music className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-[11px] text-muted-foreground flex-1 truncate">Áudio configurado</span>
                      <audio
                        src={prof.welcomeAudioUrl}
                        controls
                        className="h-6 w-20 shrink-0"
                        style={{ minWidth: 80 }}
                      />
                      <button
                        type="button"
                        className="text-destructive hover:text-destructive/80 transition-colors shrink-0"
                        onClick={() => handleRemoveAudio(prof)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-border/40 hover:border-primary/40 cursor-pointer transition-colors"
                      onClick={() => audioRefs.current[prof.id]?.click()}
                    >
                      {uploadingAudio[prof.id] ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {uploadingAudio[prof.id] ? "Enviando..." : "Clique para selecionar (máx. 10MB)"}
                      </span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    ref={(el) => { audioRefs.current[prof.id] = el; }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleAudioUpload(prof, file);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
          O vídeo e áudio são enviados automaticamente pelo WhatsApp apenas na primeira consulta confirmada de um novo lead. Para pacientes recorrentes, o envio não ocorre.
        </p>
      </CardContent>
    </Card>
  );
}

interface PortfolioItem {
  id: number;
  professionalId: number;
  mediaUrl: string;
  keywords: string;
  caption: string | null;
  active: boolean;
}

interface PortfolioCardProps {
  professionals: Professional[];
}

function PortfolioCard({ professionals }: PortfolioCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeProfessionals = professionals.filter((p) => p.isActive);
  const [selectedProfId, setSelectedProfId] = useState<number | null>(
    activeProfessionals[0]?.id ?? null
  );
  const [keywords, setKeywords] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading } = useQuery<{ items: PortfolioItem[] }>({
    queryKey: ["/api/dental/portfolio", selectedProfId],
    queryFn: async () => {
      if (!selectedProfId) return { items: [] };
      const res = await fetch(`${BASE}api/dental/portfolio?professionalId=${selectedProfId}`);
      if (!res.ok) throw new Error("Erro ao buscar portfólio");
      return res.json();
    },
    enabled: !!selectedProfId,
  });

  const items = data?.items ?? [];

  async function handleFileUpload(file: File) {
    if (!selectedProfId) return;
    if (!keywords.trim()) {
      toast({ title: "Palavras-chave obrigatórias", description: "Informe as palavras-chave antes de enviar a foto.", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "A foto deve ter no máximo 10MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const uploadRes = await fetch(`${BASE}api/storage/uploads/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Erro ao enviar arquivo");
      const { objectPath } = await uploadRes.json();
      const mediaUrl = `${BASE}api/storage${objectPath}`;
      const res = await fetch(`${BASE}api/dental/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ professionalId: selectedProfId, mediaUrl, keywords: keywords.trim(), caption: caption.trim() || null }),
      });
      if (!res.ok) throw new Error("Erro ao salvar item");
      await qc.invalidateQueries({ queryKey: ["/api/dental/portfolio", selectedProfId] });
      setKeywords("");
      setCaption("");
      toast({ title: "Foto adicionada!", description: "A IA vai usá-la quando um paciente perguntar sobre esse procedimento." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`${BASE}api/dental/portfolio/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao remover");
      await qc.invalidateQueries({ queryKey: ["/api/dental/portfolio", selectedProfId] });
      toast({ title: "Foto removida" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Card className="premium-card rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-primary" />
          Portfólio de Casos
        </CardTitle>
        <CardDescription className="text-xs mt-1">
          Adicione fotos de casos reais por procedimento. Quando um paciente perguntar sobre aquele procedimento no WhatsApp, a IA enviará automaticamente a foto como prova social — sem alterar a conversa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {activeProfessionals.length > 1 && (
          <div className="space-y-1">
            <Label className="text-xs font-medium">Profissional</Label>
            <Select
              value={selectedProfId?.toString() ?? ""}
              onValueChange={(v) => setSelectedProfId(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs rounded-lg">
                <SelectValue placeholder="Selecione o profissional" />
              </SelectTrigger>
              <SelectContent>
                {activeProfessionals.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()} className="text-xs">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
          </div>
        ) : items.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {items.map((item) => (
              <div key={item.id} className="relative group rounded-xl overflow-hidden border border-border/40 aspect-square bg-muted">
                <img
                  src={item.mediaUrl}
                  alt={item.keywords}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="self-end w-6 h-6 rounded-full bg-destructive/90 flex items-center justify-center hover:bg-destructive transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-white" />
                  </button>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <Tag className="w-2.5 h-2.5 text-white/80 shrink-0" />
                      <p className="text-[10px] text-white/90 leading-tight line-clamp-2">{item.keywords}</p>
                    </div>
                    {item.caption && (
                      <p className="text-[10px] text-white/70 leading-tight line-clamp-1">{item.caption}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70 italic">Nenhuma foto adicionada ainda.</p>
        )}

        <div className="border border-border/40 rounded-xl p-3 space-y-3 bg-muted/20">
          <p className="text-[11px] font-semibold text-foreground/80">Adicionar nova foto</p>
          <div className="space-y-1">
            <Label className="text-[11px] flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Palavras-chave <span className="text-destructive">*</span>
            </Label>
            <Input
              className="h-8 text-xs rounded-lg"
              placeholder="lente, faceta, lente de contato"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground/60">Separe por vírgula. A IA vai buscar essas palavras na mensagem do paciente.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Legenda enviada ao paciente (opcional)</Label>
            <Input
              className="h-8 text-xs rounded-lg"
              placeholder="Olha esse resultado lindo que fizemos aqui na clínica 😍"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <div
            className="flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-border/40 hover:border-primary/40 cursor-pointer transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-[11px] text-muted-foreground">
              {uploading ? "Enviando..." : "Clique para selecionar a foto (máx. 10MB)"}
            </span>
          </div>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
          A foto é enviada automaticamente no WhatsApp apenas quando o paciente menciona o procedimento relacionado. O prompt da IA não é alterado.
        </p>
      </CardContent>
    </Card>
  );
}

export { useProfessionals };
export type { Professional };
