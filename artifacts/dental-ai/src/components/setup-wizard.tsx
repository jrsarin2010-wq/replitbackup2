import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken } from "@/lib/api-config";
import { WIZARD_STEP_KEY, WIZARD_DATA_KEY, markWizardDone } from "@/lib/wizard-state";
import OdontoFlowLogo from "@/components/odonto-flow-logo";
import {
  Building2, User, MessageSquare, Bot, ArrowRight, ChevronRight,
  CheckCircle2, Phone, MapPin, Stethoscope, Sparkles, RefreshCw,
  Plus, X, Info,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";

interface WizardData {
  clinicPhone: string;
  clinicAddress: string;
  professionalName: string;
  specialty: string;
  otherSpecialties: string[];
  acceptsInsurance: boolean;
  chargesConsultation: boolean;
  consultationFee: string;
  aiName: string;
  personalityType: string;
  aiPersonality: string;
}

const defaultData: WizardData = {
  clinicPhone: "",
  clinicAddress: "",
  professionalName: "",
  specialty: "",
  otherSpecialties: [],
  acceptsInsurance: false,
  chargesConsultation: true,
  consultationFee: "",
  aiName: "",
  personalityType: "warm",
  aiPersonality: "",
};

const SPECIALTIES = [
  "Clínico Geral",
  "Ortodontia",
  "Endodontia",
  "Implantodontia",
  "Periodontia",
  "Odontopediatria",
  "Cirurgia Oral e Maxilofacial",
  "Prótese Dentária",
  "Estética Dental",
  "Radiologia Odontológica",
  "Harmonização Orofacial",
  "DTM e Dor Orofacial",
];

const PERSONALITY_OPTIONS = [
  {
    key: "warm",
    label: "Acolhedora",
    emoji: "🤗",
    description: "Calorosa e empática. Prioriza criar vínculo antes de agendar. Ideal para clínicas que recebem muitos pacientes ansiosos.",
    example: "\"Oi! 😊 Entendo que ir ao dentista pode ser ansioso — na nossa clínica você vai se sentir super bem cuidado(a). O que está precisando?\"",
  },
  {
    key: "professional",
    label: "Profissional",
    emoji: "💼",
    description: "Clara, objetiva e eficiente. Informações precisas, sem rodeios. Ideal para clínicas focadas em agilidade.",
    example: "\"Olá! Para agendar, preciso saber: qual procedimento você busca e qual horário funciona melhor?\"",
  },
  {
    key: "commercial",
    label: "Comercial",
    emoji: "🚀",
    description: "Foco em converter contatos em consultas. Cria urgência natural e destaca benefícios. Ideal para quem quer alta conversão.",
    example: "\"Oi! Temos apenas 2 encaixes essa semana — melhor garantir logo. Qual dia te funciona melhor?\"",
  },
  {
    key: "custom",
    label: "Personalizada",
    emoji: "✏️",
    description: "Você define exatamente como a secretária deve se comportar e falar.",
    example: "",
  },
];

const steps = [
  { id: 1, title: "Clínica", icon: Building2, color: "text-primary", bg: "bg-primary/10" },
  { id: 2, title: "Profissional", icon: User, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  { id: 3, title: "Atendimento", icon: Stethoscope, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  { id: 4, title: "WhatsApp", icon: MessageSquare, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10" },
  { id: 5, title: "Secretária IA", icon: Bot, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
];

async function apiPatch(path: string, body: Record<string, unknown>) {
  const token = getAuthToken();
  await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiPut(path: string, body: Record<string, unknown>) {
  const token = getAuthToken();
  await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(path: string) {
  const token = getAuthToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return null;
  return res.json();
}

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const savedStep = Number(localStorage.getItem(WIZARD_STEP_KEY)) || 1;
  const savedData: WizardData = (() => {
    try {
      const raw = localStorage.getItem(WIZARD_DATA_KEY);
      return raw ? { ...defaultData, ...JSON.parse(raw) } : { ...defaultData };
    } catch {
      return { ...defaultData };
    }
  })();

  const [step, setStep] = useState(Math.min(Math.max(savedStep, 1), steps.length));
  const [data, setData] = useState<WizardData>(savedData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [animDir, setAnimDir] = useState<"right" | "left">("right");
  const [newSpecialty, setNewSpecialty] = useState("");

  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const [qrError, setQrError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const WHATSAPP_STEP = 4;
  const AI_STEP = 5;

  useEffect(() => { localStorage.setItem(WIZARD_STEP_KEY, String(step)); }, [step]);
  useEffect(() => { localStorage.setItem(WIZARD_DATA_KEY, JSON.stringify(data)); }, [data]);

  async function fetchQrCode() {
    try {
      const token = getAuthToken();
      const res = await fetch(`${BASE}api/dental/whatsapp/connect`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) { setQrError("Não foi possível gerar o QR Code. Tente novamente."); return; }
      const json = await res.json() as { status: string; qrCode?: string | null };
      if (json.status === "connected") {
        setQrConnected(true);
        setQrCode(null);
        if (pollRef.current) clearInterval(pollRef.current);
        setTimeout(() => navigateTo(AI_STEP, "right"), 1200);
      } else if (json.qrCode) {
        setQrCode(json.qrCode);
        setQrError("");
      }
    } catch {
      setQrError("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setQrLoading(false);
    }
  }

  useEffect(() => {
    if (step !== WHATSAPP_STEP) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    setQrLoading(true);
    setQrError("");
    setQrConnected(false);
    setQrCode(null);
    fetchQrCode();
    pollRef.current = setInterval(fetchQrCode, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function updateData(partial: Partial<WizardData>) {
    setData(prev => ({ ...prev, ...partial }));
  }

  function navigateTo(nextStep: number, dir: "right" | "left") {
    setAnimDir(dir);
    setStep(nextStep);
    setError("");
  }

  function addOtherSpecialty() {
    const val = newSpecialty.trim();
    if (!val || data.otherSpecialties.includes(val)) return;
    updateData({ otherSpecialties: [...data.otherSpecialties, val] });
    setNewSpecialty("");
  }

  function removeOtherSpecialty(s: string) {
    updateData({ otherSpecialties: data.otherSpecialties.filter(x => x !== s) });
  }

  async function handleContinue() {
    setSaving(true);
    setError("");
    try {
      if (step === 1) {
        if (data.clinicPhone || data.clinicAddress) {
          await apiPut("api/dental/settings", {
            ...(data.clinicPhone ? { clinicPhone: data.clinicPhone } : {}),
            ...(data.clinicAddress ? { clinicAddress: data.clinicAddress } : {}),
          }).catch(() => {});
        }
      } else if (step === 2) {
        const allSpecialties = [
          data.specialty,
          ...data.otherSpecialties,
        ].filter(Boolean).join(", ");
        if (data.professionalName || data.specialty) {
          const profs = await apiGet("api/dental/professionals");
          const owner = profs?.professionals?.find((p: { isOwner: boolean }) => p.isOwner);
          if (owner) {
            await apiPatch(`api/dental/professionals/${owner.id}`, {
              ...(data.professionalName ? { name: data.professionalName } : {}),
              ...(data.specialty ? { specialty: data.specialty, specialties: allSpecialties } : {}),
            }).catch(() => {});
          }
        }
      } else if (step === 3) {
        await apiPut("api/dental/settings", {
          acceptsInsurance: data.acceptsInsurance,
          chargesConsultation: data.chargesConsultation,
          ...(data.chargesConsultation && data.consultationFee ? { consultationFee: data.consultationFee } : {}),
        }).catch(() => {});
      } else if (step === AI_STEP) {
        const isCustom = data.personalityType === "custom";
        await apiPut("api/dental/settings", {
          ...(data.aiName ? { aiName: data.aiName } : {}),
          personalityType: isCustom ? "" : data.personalityType,
          ...(isCustom && data.aiPersonality ? { aiPersonality: data.aiPersonality } : {}),
        }).catch(() => {});
        markWizardDone();
        onComplete();
        return;
      }

      navigateTo(step + 1, "right");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setError("");
    if (step === AI_STEP) {
      markWizardDone();
      onComplete();
      return;
    }
    navigateTo(step + 1, "right");
  }

  const progress = ((step - 1) / (steps.length - 1)) * 100;
  const currentStepInfo = steps[step - 1];
  const StepIcon = currentStepInfo.icon;
  const selectedPersonality = PERSONALITY_OPTIONS.find(o => o.key === data.personalityType) || PERSONALITY_OPTIONS[0];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-primary/8 to-transparent blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-emerald-500/6 to-transparent blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-3">
            <OdontoFlowLogo size="lg" showText={false} />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">Vamos configurar sua clínica</h1>
          <p className="text-muted-foreground text-[13px]">
            5 etapas rápidas — pode pular qualquer uma e ajustar depois nas Configurações.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px] text-muted-foreground/70">
            <span>Etapa {step} de {steps.length}</span>
            <span>{Math.round(progress)}% concluído</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex gap-1.5 pt-1">
            {steps.map((s) => (
              <div
                key={s.id}
                className={`flex-1 flex flex-col items-center gap-1 transition-all duration-300 ${s.id <= step ? "opacity-100" : "opacity-30"}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${s.id < step ? "bg-primary text-primary-foreground" : s.id === step ? `${s.bg} ${s.color}` : "bg-muted text-muted-foreground"}`}>
                  {s.id < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                </div>
                <span className={`text-[9px] font-medium leading-none text-center ${s.id === step ? "text-foreground" : "text-muted-foreground/60"}`}>
                  {s.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div key={step} className={`animate-in fade-in duration-300 ${animDir === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4"}`}>
          <div className="premium-card rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${currentStepInfo.bg}`}>
                <StepIcon className={`w-5 h-5 ${currentStepInfo.color}`} />
              </div>
              <div>
                <h2 className="text-[15px] font-bold leading-tight">{currentStepInfo.title}</h2>
                <p className="text-[12px] text-muted-foreground/70 leading-tight mt-0.5">
                  {step === 1 && "Para seus pacientes te encontrarem"}
                  {step === 2 && "Quem atende na clínica"}
                  {step === 3 && "Como funciona o atendimento"}
                  {step === 4 && "Conecte seu WhatsApp ao sistema"}
                  {step === 5 && "Defina a personalidade da sua secretária IA"}
                </p>
              </div>
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 flex gap-2 text-[12px] text-muted-foreground">
                  <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <span>A IA usa o telefone e endereço para responder pacientes que perguntam como chegar ou como entrar em contato.</span>
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" /> Telefone da Clínica
                  </Label>
                  <Input
                    value={data.clinicPhone}
                    onChange={e => updateData({ clinicPhone: e.target.value })}
                    placeholder="(11) 99999-9999"
                    className="h-11 rounded-xl"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" /> Endereço
                  </Label>
                  <Input
                    value={data.clinicAddress}
                    onChange={e => updateData({ clinicAddress: e.target.value })}
                    placeholder="Rua das Flores, 123 — São Paulo, SP"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3 flex gap-2 text-[12px] text-muted-foreground">
                  <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>A IA usa o nome e especialidades do dentista para se apresentar corretamente e encaminhar cada paciente para o profissional certo.</span>
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground" /> Seu Nome Completo
                  </Label>
                  <Input
                    value={data.professionalName}
                    onChange={e => updateData({ professionalName: e.target.value })}
                    placeholder="Dr. Carlos Silva"
                    className="h-11 rounded-xl"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" /> Especialidade Principal
                  </Label>
                  <Select value={data.specialty} onValueChange={v => updateData({ specialty: v })}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder="Selecione sua especialidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPECIALTIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5 text-muted-foreground" /> Outras especialidades que atende
                    <span className="text-[11px] font-normal text-muted-foreground/60">(opcional)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground/60 -mt-1">
                    Ex: você é clínico geral mas também faz harmonização ou implante.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={newSpecialty}
                      onChange={e => setNewSpecialty(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOtherSpecialty(); } }}
                      placeholder="Ex: Harmonização Orofacial"
                      className="h-9 rounded-lg text-[13px]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addOtherSpecialty}
                      className="h-9 px-3 rounded-lg flex-shrink-0"
                      disabled={!newSpecialty.trim()}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {data.otherSpecialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {data.otherSpecialties.map(s => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium rounded-full px-2.5 py-1"
                        >
                          {s}
                          <button type="button" onClick={() => removeOtherSpecialty(s)} className="hover:opacity-70">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 flex gap-2 text-[12px] text-muted-foreground">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>Essas informações determinam o que a IA fala sobre pagamento e planos. Você pode ajustar depois nas Configurações.</span>
                </div>

                <div className="space-y-3">
                  <Label className="text-[13px] font-semibold">Aceita convênio / plano odontológico?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { val: false, label: "Não, só particular", emoji: "💳" },
                      { val: true, label: "Sim, aceito convênio", emoji: "🏥" },
                    ].map(opt => (
                      <button
                        key={String(opt.val)}
                        type="button"
                        onClick={() => updateData({ acceptsInsurance: opt.val })}
                        className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${data.acceptsInsurance === opt.val ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                      >
                        <div className="text-base mb-1">{opt.emoji}</div>
                        <div className={`text-[12px] font-medium ${data.acceptsInsurance === opt.val ? "text-primary" : ""}`}>{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-[13px] font-semibold">Cobra consulta/avaliação?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { val: false, label: "Gratuita", emoji: "🎁", hint: "Diferencial — IA destaca isso" },
                      { val: true, label: "Cobro consulta", emoji: "💰", hint: "Informe o valor abaixo" },
                    ].map(opt => (
                      <button
                        key={String(opt.val)}
                        type="button"
                        onClick={() => updateData({ chargesConsultation: opt.val })}
                        className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${data.chargesConsultation === opt.val ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                      >
                        <div className="text-base mb-1">{opt.emoji}</div>
                        <div className={`text-[12px] font-medium ${data.chargesConsultation === opt.val ? "text-primary" : ""}`}>{opt.label}</div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">{opt.hint}</div>
                      </button>
                    ))}
                  </div>
                  {data.chargesConsultation && (
                    <div className="space-y-1">
                      <Label className="text-[12px] text-muted-foreground">Valor da consulta (R$)</Label>
                      <Input
                        value={data.consultationFee}
                        onChange={e => updateData({ consultationFee: e.target.value.replace(/\D/g, "") })}
                        placeholder="Ex: 200"
                        className="h-10 rounded-xl"
                      />
                      <p className="text-[11px] text-muted-foreground/60">A IA informará esse valor automaticamente quando oferecer horário</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4 flex flex-col items-center w-full">
                <div className="bg-green-500/5 border border-green-500/15 rounded-xl p-3 flex gap-2 text-[12px] text-muted-foreground w-full">
                  <Info className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <span>A secretária IA responde pelo WhatsApp da clínica. Para funcionar, escaneie o QR Code com o celular onde está o número da clínica.</span>
                </div>
                {qrConnected ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-9 h-9 text-green-500" />
                    </div>
                    <p className="text-[14px] font-semibold text-green-600 dark:text-green-400">WhatsApp conectado!</p>
                    <p className="text-[12px] text-muted-foreground text-center">Avançando para a próxima etapa...</p>
                  </div>
                ) : qrLoading && !qrCode ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-48 h-48 bg-muted rounded-xl flex items-center justify-center">
                      <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
                    </div>
                    <p className="text-[12px] text-muted-foreground">Gerando QR Code...</p>
                  </div>
                ) : qrError ? (
                  <div className="flex flex-col items-center gap-3 py-2 w-full">
                    <div className="w-full rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-[12px] text-destructive text-center">{qrError}</div>
                    <Button variant="outline" size="sm" onClick={() => { setQrLoading(true); setQrError(""); fetchQrCode(); }} className="gap-2">
                      <RefreshCw className="w-3 h-3" /> Tentar novamente
                    </Button>
                  </div>
                ) : qrCode ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-3 bg-white rounded-xl shadow-sm">
                      <img src={qrCode} alt="QR Code WhatsApp" className="w-48 h-48" />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      Aguardando leitura...
                    </div>
                    <div className="bg-muted/50 rounded-xl p-3 space-y-1.5 text-[11px] text-muted-foreground w-full">
                      <p className="font-semibold text-foreground text-[12px]">Como escanear:</p>
                      <p>1. Abra o <strong>WhatsApp</strong> no celular da clínica</p>
                      <p>2. Toque nos <strong>3 pontinhos</strong> → Dispositivos conectados</p>
                      <p>3. Toque em <strong>Conectar dispositivo</strong></p>
                      <p>4. Aponte a câmera para o QR Code acima</p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-muted-foreground" /> Nome da Secretária
                  </Label>
                  <Input
                    value={data.aiName}
                    onChange={e => updateData({ aiName: e.target.value })}
                    placeholder="Ex: Sofia, Ana, Júlia..."
                    className="h-11 rounded-xl"
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground/60">Como a IA vai se apresentar: "Olá! Sou a Sofia, secretária da Clínica X..."</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-[13px] font-semibold">Personalidade da secretária</Label>
                  <p className="text-[11px] text-muted-foreground/60">Define o tom e estilo de todas as mensagens enviadas aos pacientes.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PERSONALITY_OPTIONS.map(opt => {
                      const selected = data.personalityType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => updateData({ personalityType: opt.key })}
                          className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-base">{opt.emoji}</span>
                            {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                          </div>
                          <div className={`text-[12px] font-semibold mb-0.5 ${selected ? "text-primary" : ""}`}>{opt.label}</div>
                          <div className="text-[10px] text-muted-foreground/70 leading-relaxed">{opt.description}</div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedPersonality.example && (
                    <div className="bg-muted/50 rounded-xl p-3 space-y-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Exemplo de mensagem:</p>
                      <p className="text-[12px] text-foreground/80 italic">{selectedPersonality.example}</p>
                    </div>
                  )}

                  {data.personalityType === "custom" && (
                    <div className="space-y-1.5">
                      <Label className="text-[12px] text-muted-foreground">Descreva como a secretária deve se comportar</Label>
                      <Textarea
                        value={data.aiPersonality}
                        onChange={e => updateData({ aiPersonality: e.target.value })}
                        placeholder="Ex: Fala de forma informal, usa emojis com moderação, é direta ao ponto e sempre pergunta se pode ajudar em mais alguma coisa..."
                        rows={3}
                        className="rounded-xl text-[13px]"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                <p className="text-[12px] text-destructive font-medium">{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Button
            onClick={handleContinue}
            disabled={saving}
            className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
          >
            {saving ? "Salvando..." : step === AI_STEP ? "Concluir configuração ✓" : "Continuar"}
            {!saving && step !== AI_STEP && <ArrowRight className="w-4 h-4" />}
          </Button>

          <button
            onClick={handleSkip}
            disabled={saving}
            className="w-full text-[13px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center justify-center gap-1 py-1"
          >
            {step === AI_STEP ? "Pular e concluir" : "Pular esta etapa"}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40">
          Você pode alterar qualquer configuração a qualquer momento em ⚙️ Configurações
        </p>
      </div>
    </div>
  );
}
