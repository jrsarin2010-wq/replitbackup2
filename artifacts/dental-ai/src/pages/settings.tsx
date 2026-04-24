import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useGetSettings, useUpdateSettings,
  useGetWhatsappStatus, useGetWhatsappQrCode, useDisconnectWhatsapp, useRecreateWhatsapp,
  getGetWhatsappStatusQueryKey, getGetWhatsappQrCodeQueryKey,
  useListProcedures, useCreateProcedure, useUpdateProcedure, useDeleteProcedure,
  useListVoices, usePreviewVoice, useGetAudioCredits, useGetAudioTransactions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Settings as SettingsIcon, MessageSquare, Stethoscope,
  Plus, Pencil, Trash2, QrCode, Wifi, WifiOff, Brain, RefreshCw,
  DollarSign, Shield, Clock, Volume2, Play, Coins, Target, Bell, Coffee,
  User, MapPin, Phone, GraduationCap, ExternalLink, Loader2, Check, Sparkles, Send, AlertTriangle, Copy, Search, ChevronRight, UserX, Cake, Users, CalendarOff, Ban, AtSign, PhoneCall, CheckCircle, FileText, Download, ScrollText, Lock,
} from "lucide-react";
import { getAuthToken } from "@/lib/api-config";
import { useSimulator } from "@/contexts/simulator-context";
import { isBasicPlan } from "@/lib/plan-features";
import ProfessionalsTab from "@/components/professionals-tab";
import { AudioCountdownWidget, type AudioCreditData } from "@/components/audio-countdown-widget";

const DAY_LABELS: Record<string, string> = {
  "0": "Domingo",
  "1": "Segunda",
  "2": "Terca",
  "3": "Quarta",
  "4": "Quinta",
  "5": "Sexta",
  "6": "Sabado",
};

interface ScheduleDay {
  day: string;
  enabled: boolean;
  start: string;
  end: string;
  period: string;
  lunchStart?: string;
  lunchEnd?: string;
}

function parseScheduleConfig(config: string | null | undefined, workingDays: string): ScheduleDay[] {
  const enabledDays = (workingDays || "1,2,3,4,5").split(",").map((d) => d.trim());

  if (config) {
    try {
      const parsed = JSON.parse(config) as ScheduleDay[];
      if (Array.isArray(parsed) && parsed.length === 7) return parsed;
    } catch {}
  }

  return ["0", "1", "2", "3", "4", "5", "6"].map((day) => ({
    day,
    enabled: enabledDays.includes(day),
    start: "08:00",
    end: "18:00",
    period: "integral",
  }));
}



function ClinicSettingsTab() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    clinicName: "",
    clinicPhone: "",
    clinicAddress: "",
    specialties: "",
    professionalName: "",
    professionalGender: "unspecified" as "male" | "female" | "unspecified",
    workingHoursStart: "08:00",
    workingHoursEnd: "18:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    autoConfirmAppointments: true,
    confirmDaysBefore: 1,
    aiName: "Secretária IA",
    aiPersonality: "",
    personalityType: "",
    acceptsInstallments: null as boolean | null,
    maxInstallments: 12,
    acceptsBoleto: null as boolean | null,
    paymentNotes: "",
  });

  const [schedule, setSchedule] = useState<ScheduleDay[]>(parseScheduleConfig(null, "1,2,3,4,5"));

  useEffect(() => {
    if (settings) {
      const s = settings as unknown as Record<string, unknown>;
      setForm((prev) => ({
        ...prev,
        clinicName: (s.clinicName as string) || "",
        clinicPhone: (s.clinicPhone as string) || "",
        clinicAddress: (s.clinicAddress as string) || "",
        specialties: (s.specialties as string) || "",
        professionalName: (s.professionalName as string) || "",
        professionalGender: ((s.professionalGender as string) === "male" || (s.professionalGender as string) === "female") ? (s.professionalGender as "male" | "female") : "unspecified",
        workingHoursStart: (s.workingHoursStart as string) || "08:00",
        workingHoursEnd: (s.workingHoursEnd as string) || "18:00",
        lunchStart: (s.lunchStart as string) || "12:00",
        lunchEnd: (s.lunchEnd as string) || "13:00",
        autoConfirmAppointments: s.autoConfirmAppointments !== false,
        confirmDaysBefore: (s.confirmDaysBefore as number) || 1,
        aiName: (s.aiName as string) || "Secretária IA",
        aiPersonality: (s.aiPersonality as string) || "",
        personalityType: (s.personalityType as string) || "",
        acceptsInstallments: s.acceptsInstallments === null || s.acceptsInstallments === undefined ? null : s.acceptsInstallments === true,
        maxInstallments: (s.maxInstallments as number) || 12,
        acceptsBoleto: s.acceptsBoleto === null || s.acceptsBoleto === undefined ? null : s.acceptsBoleto === true,
        paymentNotes: (s.paymentNotes as string) || "",
      }));
      setSchedule(parseScheduleConfig(s.scheduleConfig as string | null, (s.workingDays as string) || "1,2,3,4,5"));
    }
  }, [settings]);

  function updateScheduleDay(dayIndex: number, field: keyof ScheduleDay, value: string | boolean) {
    setSchedule((prev) => {
      const next = [...prev];
      next[dayIndex] = { ...next[dayIndex], [field]: value };
      if (field === "period") {
        if (value === "manha") {
          next[dayIndex].start = "08:00";
          next[dayIndex].end = "12:00";
        } else if (value === "tarde") {
          next[dayIndex].start = "13:00";
          next[dayIndex].end = "18:00";
        } else {
          next[dayIndex].start = "08:00";
          next[dayIndex].end = "18:00";
        }
      }
      return next;
    });
  }

  async function handleSave() {
    const workingDays = schedule.filter((d) => d.enabled).map((d) => d.day).join(",");
    try {
      await updateMut.mutateAsync({
        data: {
          ...form,
          professionalGender: form.professionalGender === "unspecified" ? null : form.professionalGender,
          workingDays,
          scheduleConfig: JSON.stringify(schedule),
        } as Record<string, unknown>,
      });
      toast({ title: "Configuracoes salvas" });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  if (isLoading) return <Skeleton className="h-[400px]" />;

  return (
    <div className="space-y-6">
      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-primary" />
            Dados da Clínica
          </CardTitle>
          <CardDescription className="text-xs">Informações gerais que a IA usará para responder os pacientes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-muted-foreground" /> Nome da Clínica</Label>
            <Input value={form.clinicName} onChange={(e) => setForm({ ...form, clinicName: e.target.value })} placeholder="Ex: Sorriso Perfeito" />
            <p className="text-xs text-muted-foreground">
              Coloque <strong>apenas o nome</strong>, sem a palavra "Clínica" — ela já é adicionada automaticamente pela IA na apresentação. Ex: digite <em>Sorriso Perfeito</em> e a IA dirá <em>"da clínica Sorriso Perfeito"</em>.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" /> Telefone da Clínica</Label>
              <Input value={form.clinicPhone} onChange={(e) => setForm({ ...form, clinicPhone: e.target.value })} placeholder="+55 11 99999-0000" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> Endereço Completo</Label>
            <Textarea
              value={form.clinicAddress}
              onChange={(e) => setForm({ ...form, clinicAddress: e.target.value })}
              placeholder="Ex: Rua das Flores, 123 - Sala 45, Centro, São Paulo - SP, 01234-000"
              rows={2}
            />
            <p className="text-[11px] text-muted-foreground">A IA enviará um link do Google Maps com a rota quando o paciente perguntar como chegar</p>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5 text-muted-foreground" /> Especialidades que atende</Label>
            <Input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="Ex: Implantodontia, Ortodontia, Endodontia" />
            <p className="text-[11px] text-muted-foreground">Separe as especialidades por vírgula</p>
          </div>
          <div className="pt-1 border-t border-border/40">
            <p className="text-xs font-medium text-foreground mb-3 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-primary" /> Personalidade da IA</p>
            <div className="space-y-1 mb-3">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">Nome da IA</Label>
              <Input
                value={form.aiName}
                onChange={(e) => setForm({ ...form, aiName: e.target.value })}
                placeholder="Ex: Sofia, Ana, Secretária..."
                maxLength={100}
              />
              <p className="text-[11px] text-muted-foreground">A IA se apresentará com esse nome aos pacientes</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { key: "warm", label: "Acolhedora", icon: "🤗" },
                { key: "professional", label: "Profissional", icon: "💼" },
                { key: "commercial", label: "Comercial", icon: "🚀" },
                { key: "custom", label: "Personalizada", icon: "✏️" },
              ].map((opt) => {
                const selected = form.personalityType === opt.key || (opt.key === "custom" && !["warm", "professional", "commercial"].includes(form.personalityType));
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setForm({ ...form, personalityType: opt.key })}
                    className={`text-left rounded-lg border p-2.5 transition-all cursor-pointer ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{opt.icon}</span>
                      <span className={`text-xs font-medium ${selected ? "text-primary" : ""}`}>{opt.label}</span>
                      {selected && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
            {(form.personalityType === "custom" || !["warm", "professional", "commercial"].includes(form.personalityType)) && (
              <div className="space-y-1 mt-3">
                <Label className="text-xs text-muted-foreground">Descrição da personalidade</Label>
                <Textarea
                  value={form.aiPersonality}
                  onChange={(e) => setForm({ ...form, aiPersonality: e.target.value })}
                  placeholder="Ex: Sou uma secretária simpática, uso linguagem informal e emojis para deixar a conversa leve..."
                  rows={3}
                />
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Formas de Pagamento</span>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Opções de pagamento que a IA informará aos pacientes quando perguntada</p>
            <div className="flex items-center justify-between">
              <div>
                <Label>Aceita cartão parcelado</Label>
                <p className="text-xs text-muted-foreground">A IA informará sobre parcelamento quando perguntada</p>
              </div>
              <Switch checked={form.acceptsInstallments === true} onCheckedChange={(v) => setForm({ ...form, acceptsInstallments: v })} />
            </div>
            {form.acceptsInstallments === true && (
              <div className="space-y-2">
                <Label>Máximo de parcelas</Label>
                <Select
                  value={String(form.maxInstallments)}
                  onValueChange={(v) => setForm({ ...form, maxInstallments: Number(v) })}
                >
                  <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2,3,4,5,6,7,8,9,10,11,12].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Número máximo de parcelas aceitas no cartão de crédito</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <Label>Aceita boleto bancário</Label>
                <p className="text-xs text-muted-foreground">A IA informará sobre boleto quando o paciente perguntar</p>
              </div>
              <Switch checked={form.acceptsBoleto === true} onCheckedChange={(v) => setForm({ ...form, acceptsBoleto: v })} />
            </div>
            <div className="space-y-2">
              <Label>Observações sobre pagamento</Label>
              <Textarea
                value={form.paymentNotes}
                onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })}
                placeholder="Ex: Parcelamento mínimo de R$100 por parcela. PIX à vista com 5% de desconto."
                rows={2}
              />
              <p className="text-[11px] text-muted-foreground">Informações adicionais que a IA poderá mencionar ao responder sobre pagamentos</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            Profissional Titular
          </CardTitle>
          <CardDescription className="text-xs">Nome e gênero usados pela IA para se referir ao responsável pela clínica</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-muted-foreground" /> Nome do Profissional</Label>
            <Input value={form.professionalName} onChange={(e) => setForm({ ...form, professionalName: e.target.value })} placeholder="Ex: Dr. João Silva" />
            <p className="text-[11px] text-muted-foreground">A IA se referirá ao profissional por esse nome</p>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-muted-foreground" /> Gênero do Titular</Label>
            <Select
              value={form.professionalGender}
              onValueChange={(v) => setForm({ ...form, professionalGender: v as "male" | "female" | "unspecified" })}
            >
              <SelectTrigger className="max-w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Masculino — Dr.</SelectItem>
                <SelectItem value="female">Feminino — Dra.</SelectItem>
                <SelectItem value="unspecified">Prefiro não informar</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">O Tutor IA usará "Dr." ou "Dra." conforme essa escolha. Se preferir não informar, o Tutor usa o nome cadastrado como está.</p>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 mt-2">
            <Users className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-foreground">CRO, especialidades, agenda, consulta e convênio</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Configure esses dados na aba <strong>Profissionais</strong> — assim tudo fica em um só lugar e a IA lê diretamente de lá.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full sm:w-auto">
        Salvar Configuracoes
      </Button>
    </div>
  );
}

function WhatsAppTab() {
  const [showQr, setShowQr] = useState(false);
  const [qrRefreshKey, setQrRefreshKey] = useState(0);
  const [showRecreateConfirm, setShowRecreateConfirm] = useState(false);
  const [freshQrCode, setFreshQrCode] = useState<string | null>(null);

  const { data: status, refetch: refetchStatus } = useGetWhatsappStatus({
    query: { queryKey: getGetWhatsappStatusQueryKey(), refetchInterval: showQr ? 3_000 : 10_000 },
  });
  const { data: qrData, refetch: refetchQr, isFetching: qrFetching } = useGetWhatsappQrCode({
    query: { queryKey: getGetWhatsappQrCodeQueryKey(), enabled: showQr && !freshQrCode, staleTime: 0, gcTime: 0 },
  });
  const disconnectMut = useDisconnectWhatsapp();
  const recreateMut = useRecreateWhatsapp();
  const { toast } = useToast();
  const qc = useQueryClient();

  const wsStatus = status as { connected?: boolean; status?: string; phone?: string } | undefined;
  const isConnected = wsStatus?.connected === true;

  useEffect(() => {
    if (isConnected && showQr) {
      setShowQr(false);
      setFreshQrCode(null);
      toast({ title: "WhatsApp conectado!", description: "Secretaria virtual pronta para uso." });
    }
  }, [isConnected, showQr]);

  useEffect(() => {
    if (!showQr || isConnected) return;
    const interval = setInterval(() => {
      setQrRefreshKey(k => k + 1);
      setFreshQrCode(null);
      qc.invalidateQueries({ queryKey: getGetWhatsappQrCodeQueryKey() });
      refetchQr();
    }, 15_000);
    return () => clearInterval(interval);
  }, [showQr, isConnected, qrRefreshKey]);

  async function handleConnect() {
    setShowQr(true);
    setFreshQrCode(null);
    setQrRefreshKey(k => k + 1);
    await qc.invalidateQueries({ queryKey: getGetWhatsappQrCodeQueryKey() });
    refetchQr();
  }

  async function handleDisconnect() {
    try {
      await disconnectMut.mutateAsync();
      toast({ title: "WhatsApp desconectado", description: "Sessao encerrada com sucesso." });
      await qc.invalidateQueries({ queryKey: getGetWhatsappStatusQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetWhatsappQrCodeQueryKey() });
      await refetchStatus();
    } catch (e) {
      toast({ title: "Erro ao desconectar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleRecreate() {
    try {
      const result = await recreateMut.mutateAsync();
      const data = result as { success?: boolean; qrCode?: string | null; instanceName?: string };
      setShowRecreateConfirm(false);
      toast({ title: "Instância recriada!", description: "Escaneie o novo QR Code para conectar." });
      await qc.invalidateQueries({ queryKey: getGetWhatsappStatusQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetWhatsappQrCodeQueryKey() });
      await refetchStatus();
      if (data.qrCode) {
        setFreshQrCode(data.qrCode);
      }
      setShowQr(true);
    } catch (e) {
      setShowRecreateConfirm(false);
      toast({ title: "Erro ao recriar instância", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  const qrImage = freshQrCode || (qrData as { qrCode?: string } | undefined)?.qrCode;

  return (
    <div className="space-y-6">
      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-500" />
            Status do WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isConnected ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
              {isConnected ? <Wifi className="w-6 h-6 text-emerald-500" /> : <WifiOff className="w-6 h-6 text-red-500" />}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{isConnected ? "Conectado" : "Desconectado"}</p>
              <p className="text-xs text-muted-foreground">
                {isConnected ? `Numero: ${wsStatus?.phone || "..."}` : "Conecte seu WhatsApp para usar a secretaria virtual"}
              </p>
            </div>
            {isConnected ? (
              <Button variant="destructive" size="sm" onClick={handleDisconnect}>Desconectar</Button>
            ) : (
              <Button onClick={handleConnect} className="gap-2"><QrCode className="w-4 h-4" /> Conectar</Button>
            )}
          </div>
        </CardContent>
      </Card>
      {showQr && !isConnected && (
        <Card className="border border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Escanear QR Code</CardTitle>
            <CardDescription className="text-xs">
              Abra o WhatsApp no celular → Dispositivos Conectados → Conectar dispositivo → Escaneie o codigo abaixo. O QR atualiza automaticamente a cada 15 segundos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {qrFetching && !qrImage ? (
              <div className="w-56 h-56 bg-muted rounded-xl flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
              </div>
            ) : qrImage ? (
              <div className="p-4 bg-white rounded-xl shadow-sm">
                <img src={qrImage} alt="QR Code WhatsApp" className="w-56 h-56" />
              </div>
            ) : (
              <div className="w-56 h-56 bg-muted rounded-xl flex flex-col items-center justify-center gap-2">
                <QrCode className="w-12 h-12 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Aguardando QR Code...</p>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Aguardando leitura do QR Code...
            </div>
            <Button variant="outline" size="sm" onClick={handleConnect} className="gap-2">
              <RefreshCw className="w-3 h-3" /> Gerar novo QR Code
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            Conexão com problema?
          </CardTitle>
          <CardDescription className="text-xs">
            Se o WhatsApp aparece como conectado mas a IA não responde, a sessão pode estar corrompida. Recriar a instância resolve o problema — você precisará escanear o QR Code novamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={() => setShowRecreateConfirm(true)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recriar Instância
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showRecreateConfirm} onOpenChange={setShowRecreateConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Recriar instância do WhatsApp?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>Isso vai <strong className="text-foreground">deletar completamente</strong> a sessão atual do WhatsApp e criar uma nova do zero.</p>
            <p>Após recriar, você precisará <strong className="text-foreground">escanear o QR Code novamente</strong> no celular da clínica.</p>
            <p className="text-xs">O histórico de conversas salvo no sistema não será afetado.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRecreateConfirm(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRecreate}
              disabled={recreateMut.isPending}
              className="gap-2"
            >
              {recreateMut.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Recriando...</>
              ) : (
                <><RefreshCw className="w-3.5 h-3.5" /> Sim, recriar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProceduresTab() {
  const { data: proceduresData, isLoading } = useListProcedures();
  const createMut = useCreateProcedure();
  const updateMut = useUpdateProcedure();
  const deleteMut = useDeleteProcedure();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "" });

  const procedures = (proceduresData as Array<{ id: number; name: string }>) || [];

  function openCreate() {
    setForm({ name: "" });
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(p: { id: number; name: string }) {
    setForm({ name: p.name });
    setEditId(p.id);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    const payload = { name: form.name, durationMinutes: 0, price: "0", active: "true" };
    try {
      if (editId) {
        await updateMut.mutateAsync({ procedureId: editId, data: payload });
        toast({ title: "Procedimento atualizado" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "Procedimento criado" });
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/dental/procedures"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este procedimento?")) return;
    try {
      await deleteMut.mutateAsync({ procedureId: id });
      toast({ title: "Procedimento excluido" });
      qc.invalidateQueries({ queryKey: ["/api/dental/procedures"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  if (isLoading) return <Skeleton className="h-[300px]" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{procedures.length} procedimentos</p>
        <Button onClick={openCreate} size="sm" className="gap-2"><Plus className="w-3.5 h-3.5" /> Novo</Button>
      </div>
      <Card className="border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Procedimento</TableHead>
              <TableHead className="font-semibold text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {procedures.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(p.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editId ? "Editar Procedimento" : "Novo Procedimento"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do procedimento" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.name}>{editId ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AudioTab() {
  const { data: settings } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { data: voicesData, isLoading: elVoicesLoading } = useListVoices();
  const { data: creditsData } = useGetAudioCredits();
  const { data: transactionsData } = useGetAudioTransactions();
  const previewMut = usePreviewVoice();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activePlan } = useSimulator();

  const s = settings as unknown as Record<string, unknown> | undefined;

  const [audioMode, setAudioMode] = useState<string>("off");
  const [ttsProvider, setTtsProvider] = useState<string>("cartesia");
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);

  const { data: cartesiaVoicesData, isLoading: cartesiaVoicesLoading } = useQuery({
    queryKey: ["/api/dental/audio/voices/cartesia"],
    queryFn: async () => {
      const res = await fetch("/api/dental/audio/voices/cartesia");
      return res.json() as Promise<{ voices: Array<{ id: string; name: string; description?: string; language: string; gender?: string }>; error: string | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const [paymentDialog, setPaymentDialog] = useState<{ url: string; packageName: string; chars: number; priceLabel: string } | null>(null);
  const [cpfDialog, setCpfDialog] = useState<{ packageId: string } | null>(null);
  const [cpfValue, setCpfValue] = useState<string>("");

  function formatCpfCnpj(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 11) {
      return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_m, a, b, c, d) => d ? `${a}.${b}.${c}-${d}` : digits.length > 6 ? `${a}.${b}.${c}` : digits.length > 3 ? `${a}.${b}` : a);
    }
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_m, a, b, c, d, e) => e ? `${a}.${b}.${c}/${d}-${e}` : digits.length > 12 ? `${a}.${b}.${c}/${d}` : digits.length > 8 ? `${a}.${b}.${c}` : digits.length > 5 ? `${a}.${b}` : a);
  }

  const purchaseMut = useMutation({
    mutationFn: async ({ packageId, taxId }: { packageId: string; taxId: string }) => {
      const res = await fetch("/api/dental/audio/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, taxId: taxId.replace(/\D/g, "") }),
      });
      const data = await res.json() as { orderId?: number; paymentUrl?: string; package?: { name: string; chars: number; priceLabel: string }; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Erro ao gerar cobrança");
      return data;
    },
    onSuccess: (data) => {
      setCpfDialog(null);
      if (data.paymentUrl && data.package) {
        setPaymentDialog({ url: data.paymentUrl, packageName: data.package.name, chars: data.package.chars, priceLabel: data.package.priceLabel });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao gerar cobrança", description: err.message, variant: "destructive" });
    },
  });

  const handlePurchase = useCallback((packageId: string) => {
    setCpfDialog({ packageId });
  }, []);

  const handleConfirmCpf = useCallback(() => {
    if (!cpfDialog) return;
    const digits = cpfValue.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) {
      toast({ title: "CPF/CNPJ inválido", description: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.", variant: "destructive" });
      return;
    }
    purchaseMut.mutate({ packageId: cpfDialog.packageId, taxId: digits });
  }, [cpfDialog, cpfValue, purchaseMut, toast]);

  useEffect(() => {
    if (s) {
      setAudioMode((s.audioMode as string) || "off");
      const savedProvider = (s.ttsProvider as string) || "cartesia";
      setTtsProvider(savedProvider);
      if (savedProvider === "elevenlabs") {
        setSelectedVoice((s.elevenLabsVoiceId as string) || "");
      } else {
        setSelectedVoice((s.cartesiaVoiceId as string) || "");
      }
    }
  }, [s]);

  const isCartesia = ttsProvider === "cartesia";
  const voicesLoading = isCartesia ? cartesiaVoicesLoading : elVoicesLoading;

  const cartesiaVoices = cartesiaVoicesData?.voices || [];
  const voicesResponse = voicesData as { voices: Array<{ voiceId: string; name: string; category: string; accent: string; gender: string; previewUrl: string }>; error: string | null } | Array<{ voiceId: string; name: string; category: string; accent: string; gender: string; previewUrl: string }> | undefined;
  const rawElVoices = Array.isArray(voicesResponse) ? voicesResponse : (voicesResponse?.voices || []);

  const isRecommended = (name: string) => {
    const n = name.toLowerCase();
    return n.includes("keren") || n.includes("karen") || n.includes("fernanda") || n.includes("ana");
  };

  const normalizedVoices: Array<{ id: string; name: string; gender?: string; description?: string; previewUrl?: string }> = isCartesia
    ? cartesiaVoices.map((v) => ({ id: v.id, name: v.name, gender: v.gender, description: v.description }))
    : rawElVoices.map((v) => ({ id: v.voiceId, name: v.name, gender: v.gender, description: (v as unknown as { description?: string }).description, previewUrl: v.previewUrl }));

  const voices = [...normalizedVoices].sort((a, b) => {
    const aR = isRecommended(a.name) ? -1 : 0;
    const bR = isRecommended(b.name) ? -1 : 0;
    return aR - bR;
  });
  const voicesError = isCartesia
    ? (cartesiaVoicesData?.error || null)
    : (Array.isArray(voicesResponse) ? null : (voicesResponse?.error || null));
  const credits = creditsData as { tenantId: number; balance: number; monthlyCharsRemaining: number; monthlyCharsUsed: number; monthlyQuota: number; totalAvailable: number } | undefined;
  const transactions = (transactionsData as Array<{ id: number; amount: number; type: string; description: string | null; createdAt: string }>) || [];

  async function handleSaveAudio() {
    try {
      await updateMut.mutateAsync({
        data: {
          audioMode,
          ttsProvider,
          elevenLabsVoiceId: ttsProvider === "elevenlabs" ? (selectedVoice || null) : null,
          cartesiaVoiceId: ttsProvider === "cartesia" ? (selectedVoice || null) : null,
        } as Record<string, unknown>,
      });
      toast({ title: "Configuracoes de audio salvas" });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handlePreview(voiceId: string, phrase: "short" | "long" = "short") {
    try {
      setPlayingVoice(voiceId);
      // Sempre passar pelo nosso pipeline humanizado (normalize + strip + rhythm + breath effect),
      // tanto para Cartesia quanto para ElevenLabs. Não usar mais previewUrl da CDN do provider
      // porque ela ignora a humanização aplicada às respostas reais do bot.
      const result = await previewMut.mutateAsync({ data: { voiceId, provider: ttsProvider, phrase } as Record<string, unknown> });
      const r = result as unknown as { audioBase64: string; mimeType: string };
      if (r?.audioBase64) {
        const audio = new Audio(`data:${r.mimeType};base64,${r.audioBase64}`);
        audio.onended = () => setPlayingVoice(null);
        audio.play();
      }
    } catch {
      toast({ title: "Erro ao reproduzir preview", variant: "destructive" });
      setPlayingVoice(null);
    }
  }

  const isLocked = isBasicPlan(activePlan);

  return (
    <PlanLockOverlay feature="Áudio IA" isLocked={isLocked}>
    <div className="space-y-6">

      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-primary" />
            Modo de Audio IA
          </CardTitle>
          <CardDescription className="text-xs">
            Configure quando a secretaria virtual deve responder com audio via WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={audioMode} onValueChange={setAudioMode}>
            <SelectTrigger className="max-w-[300px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Desativado (somente texto)</SelectItem>
              <SelectItem value="always">Sempre responder com audio</SelectItem>
              <SelectItem value="audio_reply_only">Somente quando paciente enviar audio</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {audioMode === "off" && "A IA responde somente com texto."}
            {audioMode === "always" && "Toda resposta sera enviada em texto + audio."}
            {audioMode === "audio_reply_only" && "Audio sera enviado apenas quando o paciente enviar um audio primeiro."}
          </p>
        </CardContent>
      </Card>

      {audioMode !== "off" && (
        <>
          <Card className="border border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-primary" />
                Voz da Secretaria
              </CardTitle>
              <CardDescription className="text-xs">
                Escolha a voz em português para as respostas em áudio — clique ▶ para ouvir
              </CardDescription>
            </CardHeader>
            <CardContent>
              {voicesLoading ? (
                <Skeleton className="h-[200px]" />
              ) : voicesError ? (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 space-y-2">
                  <p className="text-sm font-medium text-destructive">Erro ao carregar vozes</p>
                  <p className="text-xs text-muted-foreground">{voicesError}</p>
                </div>
              ) : voices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma voz disponível no momento. Entre em contato com o suporte.</p>
              ) : (
                <div className="grid gap-2 max-h-[300px] overflow-y-auto pr-2">
                  {voices.map((voice) => (
                    <div
                      key={voice.id}
                      onClick={() => setSelectedVoice(voice.id)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedVoice === voice.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border hover:border-border/80 hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{voice.name}</p>
                          {isRecommended(voice.name) && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">⭐ Recomendada</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {voice.gender === "female" ? "Feminina" : voice.gender === "male" ? "Masculina" : voice.gender}
                          {voice.description ? ` · ${voice.description}` : ""}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 gap-1 text-[11px]"
                        disabled={playingVoice === voice.id || previewMut.isPending}
                        title="Tocar saudação curta"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(voice.id, "short");
                        }}
                      >
                        <Play className={`w-3.5 h-3.5 ${playingVoice === voice.id ? "text-primary animate-pulse" : ""}`} />
                        Curta
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 gap-1 text-[11px]"
                        disabled={playingVoice === voice.id || previewMut.isPending}
                        title="Tocar frase longa real (oferta de horários) — ouve respiração e prosódia"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(voice.id, "long");
                        }}
                      >
                        <Play className={`w-3.5 h-3.5 ${playingVoice === voice.id ? "text-primary animate-pulse" : ""}`} />
                        Longa
                      </Button>
                      {selectedVoice === voice.id && (
                        <Badge className="text-[10px] shrink-0">Selecionada</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" />
                Minutos de Audio
              </CardTitle>
              <CardDescription className="text-xs">
                30 minutos de cortesia por mes + recargas adicionais via Pix
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <AudioCountdownWidget compact creditsData={credits as AudioCreditData | undefined} />

              {/* Monthly courtesy quota */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    Cortesia mensal
                  </span>
                  <span>
                    {Math.round((credits?.monthlyCharsRemaining ?? 27000) / 900)} min restantes
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(((credits?.monthlyCharsRemaining ?? 27000) / (credits?.monthlyQuota ?? 27000)) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-right">
                  {Math.round((credits?.monthlyCharsUsed ?? 0) / 900)} / 30 min usados este mes
                </p>
              </div>

              {/* Extra recharge balance */}
              {(credits?.balance ?? 0) > 0 && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-medium">Saldo extra</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-500">
                    +{Math.round((credits?.balance ?? 0) / 900)} min
                  </span>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-primary" />
                  Comprar minutos extras via Pix
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: "starter",  name: "Básico",  priceLabel: "R$ 25",  description: "+60 min" },
                    { id: "standard", name: "Padrão",  priceLabel: "R$ 40",  description: "+2 horas", highlight: true },
                    { id: "pro",      name: "Pro",     priceLabel: "R$ 90",  description: "+5 horas" },
                  ].map((pkg) => (
                    <div
                      key={pkg.id}
                      className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all ${pkg.highlight ? "border-primary bg-primary/5" : "border-border/50 bg-muted/20 hover:border-border"}`}
                    >
                      {pkg.highlight && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                          POPULAR
                        </span>
                      )}
                      <p className="text-xs font-semibold text-muted-foreground">{pkg.name}</p>
                      <p className="text-lg font-bold">{pkg.priceLabel}</p>
                      <p className="text-[11px] text-muted-foreground">{pkg.description}</p>
                      <Button
                        size="sm"
                        variant={pkg.highlight ? "default" : "outline"}
                        className="w-full text-xs mt-1"
                        onClick={() => handlePurchase(pkg.id)}
                        disabled={purchaseMut.isPending}
                      >
                        {purchaseMut.isPending && purchaseMut.variables?.packageId === pkg.id ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Gerando...</>
                        ) : (
                          <>
                            <QrCode className="w-3 h-3 mr-1" />
                            Pagar com Pix
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {transactions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Historico recente</p>
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {transactions.slice(0, 20).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{tx.description || (tx.type === "add" ? "Creditos adicionados" : "Consumo de audio")}</p>
                          <p className="text-[10px] text-muted-foreground">{new Date(tx.createdAt).toLocaleString("pt-BR")}</p>
                        </div>
                        <span className={`text-xs font-mono font-medium ${tx.type === "add" ? "text-emerald-500" : "text-red-400"}`}>
                          {tx.type === "add" ? "+" : "-"}{Math.abs(tx.amount).toLocaleString("pt-BR")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={!!cpfDialog} onOpenChange={(open) => { if (!open) { setCpfDialog(null); setCpfValue(""); } }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Informe seu CPF ou CNPJ</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Para gerar a cobranca Pix, precisamos do seu CPF ou CNPJ.
                </p>
                <Input
                  placeholder="000.000.000-00"
                  value={cpfValue}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 14);
                    setCpfValue(formatCpfCnpj(raw));
                  }}
                  maxLength={18}
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setCpfDialog(null); setCpfValue(""); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleConfirmCpf} disabled={purchaseMut.isPending}>
                    {purchaseMut.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Gerando...</>
                    ) : (
                      "Continuar"
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!paymentDialog} onOpenChange={(open) => { if (!open) setPaymentDialog(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-primary" />
                  Pagamento Pix Gerado
                </DialogTitle>
              </DialogHeader>
              {paymentDialog && (
                <div className="space-y-4 py-2">
                  <div className="p-4 rounded-xl bg-muted/30 text-center space-y-1">
                    <p className="text-sm text-muted-foreground">Pacote {paymentDialog.packageName}</p>
                    <p className="text-2xl font-bold text-primary">{paymentDialog.priceLabel}</p>
                    <p className="text-xs text-muted-foreground">{paymentDialog.chars.toLocaleString("pt-BR")} creditos apos confirmacao</p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      <p>Clique no botao abaixo para abrir a tela de pagamento Pix</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      <p>Creditos sao adicionados automaticamente apos confirmacao do pagamento</p>
                    </div>
                  </div>
                  <a
                    href={paymentDialog.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-3 font-medium text-sm transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Abrir Pagamento Pix
                  </a>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setPaymentDialog(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <Button onClick={handleSaveAudio} disabled={updateMut.isPending} className="w-full sm:w-auto">
        Salvar Configuracoes de Audio
      </Button>
    </div>
    </PlanLockOverlay>
  );
}

const REMARKETING_DAY_LABELS: Record<string, string> = {
  "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui", "5": "Sex", "6": "Sab",
};

function PlanLockBanner({ feature, href = "/subscription" }: { feature: string; href?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <Lock className="w-6 h-6 text-amber-400" />
      </div>
      <div>
        <p className="text-base font-bold text-foreground mb-1">{feature} não disponível no Plano Básico</p>
        <p className="text-sm text-muted-foreground">Faça upgrade para o Plano Essencial ou Pro para liberar este recurso.</p>
      </div>
      <a href={href} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 font-semibold text-sm transition-colors">
        <ChevronRight className="w-4 h-4" /> Ver planos
      </a>
    </div>
  );
}

function PlanLockOverlay({ feature, isLocked, children }: { feature: string; isLocked: boolean; children: ReactNode }) {
  if (!isLocked) return <>{children}</>;
  return (
    <div className="relative rounded-xl overflow-hidden">
      <div className="pointer-events-none select-none opacity-15 blur-sm max-h-[360px] overflow-hidden">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
        <PlanLockBanner feature={feature} />
      </div>
    </div>
  );
}

function RemarketingTab() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activePlan } = useSimulator();

  const [form, setForm] = useState({
    remarketingEnabled: true,
    remarketingHours: "10,15",
    remarketingDays: "1,2,3,4,5,6",
    remarketingMaxLeads: 10,
    remarketingIntervalHot: 2,
    remarketingIntervalWarm: 4,
    remarketingIntervalCold: 7,
    remarketingInstructionsHot: "",
    remarketingInstructionsWarm: "",
    remarketingInstructionsCold: "",
  });

  useEffect(() => {
    if (settings) {
      const s = settings as unknown as Record<string, unknown>;
      setForm({
        remarketingEnabled: s.remarketingEnabled !== false,
        remarketingHours: (s.remarketingHours as string) || "10,15",
        remarketingDays: (s.remarketingDays as string) || "1,2,3,4,5,6",
        remarketingMaxLeads: (s.remarketingMaxLeads as number) || 10,
        remarketingIntervalHot: (s.remarketingIntervalHot as number) || 2,
        remarketingIntervalWarm: (s.remarketingIntervalWarm as number) || 4,
        remarketingIntervalCold: (s.remarketingIntervalCold as number) || 7,
        remarketingInstructionsHot: (s.remarketingInstructionsHot as string) || "",
        remarketingInstructionsWarm: (s.remarketingInstructionsWarm as string) || "",
        remarketingInstructionsCold: (s.remarketingInstructionsCold as string) || "",
      });
    }
  }, [settings]);

  const selectedDays = form.remarketingDays.split(",").filter(Boolean);
  const selectedHours = form.remarketingHours.split(",").filter(Boolean);

  function toggleDay(day: string) {
    const days = new Set(selectedDays);
    if (days.has(day)) days.delete(day); else days.add(day);
    setForm({ ...form, remarketingDays: Array.from(days).sort().join(",") });
  }

  function toggleHour(hour: string) {
    const hours = new Set(selectedHours);
    if (hours.has(hour)) hours.delete(hour); else hours.add(hour);
    setForm({ ...form, remarketingHours: Array.from(hours).sort((a, b) => Number(a) - Number(b)).join(",") });
  }

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ data: form as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      toast({ title: "Configuracoes salvas!" });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  }

  if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
  const isLockedRmk = isBasicPlan(activePlan);

  return (
    <PlanLockOverlay feature="Remarketing de Leads" isLocked={isLockedRmk}>
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Unica secao personalizavel</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            As mensagens de remarketing sao as unicas que voce pode customizar. Aqui voce define as instrucoes que a IA usara para cada etapa do funil — a IA escreve e envia automaticamente com base nelas.
          </p>
        </div>
      </div>

      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Remarketing de Leads
          </CardTitle>
          <CardDescription className="text-xs">
            Envio automatico de mensagens personalizadas por IA para leads que nao responderam. As mensagens usam estrategias de venda otimizadas automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label>Remarketing ativo</Label>
              <p className="text-xs text-muted-foreground">Enviar mensagens automaticas para leads inativos</p>
            </div>
            <Switch checked={form.remarketingEnabled} onCheckedChange={(v) => setForm({ ...form, remarketingEnabled: v })} />
          </div>

          {form.remarketingEnabled && (
            <>
              <div className="space-y-3">
                <Label className="text-sm">Dias de envio</Label>
                <div className="flex flex-wrap gap-2">
                  {["0","1","2","3","4","5","6"].map((d) => (
                    <button
                      key={d}
                      onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        selectedDays.includes(d)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {REMARKETING_DAY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm">Horarios de envio</Label>
                <p className="text-[11px] text-muted-foreground -mt-1">Selecione os horarios em que o remarketing sera executado</p>
                <div className="flex flex-wrap gap-2">
                  {["8","9","10","11","12","13","14","15","16","17","18"].map((h) => (
                    <button
                      key={h}
                      onClick={() => toggleHour(h)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        selectedHours.includes(h)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Leads por execucao</Label>
                <p className="text-[11px] text-muted-foreground -mt-1">Maximo de leads contatados por horario</p>
                <Select value={String(form.remarketingMaxLeads)} onValueChange={(v) => setForm({ ...form, remarketingMaxLeads: Number(v) })}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 leads</SelectItem>
                    <SelectItem value="10">10 leads</SelectItem>
                    <SelectItem value="15">15 leads</SelectItem>
                    <SelectItem value="20">20 leads</SelectItem>
                    <SelectItem value="30">30 leads</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label className="text-sm">Intervalo por temperatura</Label>
                <p className="text-[11px] text-muted-foreground -mt-1">Tempo minimo entre mensagens para cada tipo de lead</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" /> Quente
                    </Label>
                    <Select value={String(form.remarketingIntervalHot)} onValueChange={(v) => setForm({ ...form, remarketingIntervalHot: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 dia</SelectItem>
                        <SelectItem value="2">2 dias</SelectItem>
                        <SelectItem value="3">3 dias</SelectItem>
                        <SelectItem value="5">5 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-yellow-500" /> Morno
                    </Label>
                    <Select value={String(form.remarketingIntervalWarm)} onValueChange={(v) => setForm({ ...form, remarketingIntervalWarm: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">2 dias</SelectItem>
                        <SelectItem value="3">3 dias</SelectItem>
                        <SelectItem value="4">4 dias</SelectItem>
                        <SelectItem value="5">5 dias</SelectItem>
                        <SelectItem value="7">7 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" /> Frio
                    </Label>
                    <Select value={String(form.remarketingIntervalCold)} onValueChange={(v) => setForm({ ...form, remarketingIntervalCold: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 dias</SelectItem>
                        <SelectItem value="7">7 dias</SelectItem>
                        <SelectItem value="10">10 dias</SelectItem>
                        <SelectItem value="14">14 dias</SelectItem>
                        <SelectItem value="21">21 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </>
          )}

          {form.remarketingEnabled && (
            <div className="space-y-5 pt-2 border-t border-border/30">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">🤖</span>
                  <Label className="text-sm font-medium">Instrucoes por Temperatura de Lead</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  A IA gera mensagens diferentes dependendo da temperatura do lead. Configure instrucoes especificas para cada perfil — quanto mais especifico, mais eficaz.
                </p>
              </div>
              {[
                {
                  key: "remarketingInstructionsHot" as const,
                  label: "Lead Quente 🔥",
                  badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  description: "Lead interessado e engajado, proximo de fechar. Seja mais direto e crie urgencia.",
                  placeholder: "Ex: Mencione que temos horarios disponiveis esta semana. Reforce a qualidade e o diferencial. Seja objetivo e convide para agendar.",
                },
                {
                  key: "remarketingInstructionsWarm" as const,
                  label: "Lead Morno 🌡️",
                  badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                  description: "Lead com interesse moderado. Mantenha o relacionamento e reative o interesse.",
                  placeholder: "Ex: Use um tom amigavel e relembre os beneficios. Pode mencionar que temos condicoes especiais. Evite pressionar demais.",
                },
                {
                  key: "remarketingInstructionsCold" as const,
                  label: "Lead Frio ❄️",
                  badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                  description: "Lead sem engajamento recente. Reative o interesse com uma abordagem suave.",
                  placeholder: "Ex: Seja muito gentil e nao pressione. Mencione novidades da clinica. Apenas reabra o dialogo sem falar em agendamento diretamente.",
                },
              ].map(({ key, label, badge, description, placeholder }) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>{label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{description}</p>
                  <Textarea
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="text-sm min-h-[70px] resize-none"
                    rows={3}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full sm:w-auto">
        Salvar Remarketing
      </Button>
    </div>
    </PlanLockOverlay>
  );
}

function ResetTab() {
  const { toast } = useToast();
  const [resetting, setResetting] = useState(false);
  const [step1Open, setStep1Open] = useState(false);
  const [step2Open, setStep2Open] = useState(false);

  const executeReset = async () => {
    const token = localStorage.getItem("authToken");
    if (!token) {
      toast({
        title: "Sessão expirada",
        description: "Faça login novamente para resetar os dados.",
        variant: "destructive",
      });
      return;
    }

    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

    setResetting(true);
    try {
      const res = await fetch(`${BASE}/api/dental/reset/reset-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        let detail = `Erro ${res.status}`;
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
          else if (body?.error) detail = body.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }
      toast({ title: "Sistema resetado com sucesso!", description: "Dados operacionais apagados. Configurações da clínica preservadas." });
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tente novamente.";
      toast({ title: "Erro ao resetar", description: message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1 — primeira confirmação */}
      <AlertDialog open={step1Open} onOpenChange={setStep1Open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Atenção: ação irreversível
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso apagará todos os dados operacionais — pacientes, agendamentos, leads, conversas do WhatsApp, áudios, memória e aprendizado da IA, atividades e logs de auditoria. As configurações da clínica serão preservadas. Tem certeza que deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => { setStep1Open(false); setStep2Open(true); }}
            >
              Sim, continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 2 — confirmação final */}
      <AlertDialog open={step2Open} onOpenChange={setStep2Open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Última confirmação</AlertDialogTitle>
            <AlertDialogDescription>
              Confirma a exclusão de todos os dados operacionais? Esta ação não pode ser desfeita. Nome da clínica, profissionais, procedimentos e conexão do WhatsApp continuarão intactos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => { setStep2Open(false); void executeReset(); }}
            >
              Sim, deletar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Resetar Sistema (Apenas para Testes)
          </CardTitle>
          <CardDescription>
            Esta funcionalidade é apenas para testes antes de ir para produção. Será removida em breve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-destructive mb-1">O que será apagado:</p>
              <ul className="text-xs text-destructive/90 space-y-1 list-disc list-inside">
                <li>Pacientes, tratamentos e leads</li>
                <li>Agendamentos e follow-ups</li>
                <li>Conversas e mensagens do WhatsApp</li>
                <li>Áudios processados</li>
                <li>Memória, objeções e aprendizado da IA</li>
                <li>Atividades, logs de auditoria e despesas</li>
                <li>Registros de consentimento e lista de espera</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">O que será preservado:</p>
              <ul className="text-xs text-green-700/90 dark:text-green-400/90 space-y-1 list-disc list-inside">
                <li>Nome, contato e configurações da clínica</li>
                <li>Profissionais e procedimentos cadastrados</li>
                <li>Horários de atendimento e conexão do WhatsApp</li>
                <li>Configurações da IA e planos/convênios</li>
                <li>Login e conta do tenant</li>
              </ul>
            </div>
          </div>
          <Button
            onClick={() => setStep1Open(true)}
            disabled={resetting}
            variant="destructive"
            className="w-full gap-2"
            size="lg"
          >
            {resetting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Resetando...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Resetar Tudo
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TelegramTab() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [validating, setValidating] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [chats, setChats] = useState<Array<{ chatId: string; name: string; lastMessage: string }>>([]);
  const [step, setStep] = useState<"token" | "chat" | "done">("token");

  useEffect(() => {
    if (settings) {
      const s = settings as unknown as Record<string, unknown>;
      const hasToken = !!s.telegramBotToken && s.telegramBotToken !== null;
      setChatId(s.telegramChatId as string || "");
      setEnabled(s.telegramEscalationEnabled as boolean || false);
      if (hasToken && s.telegramChatId) {
        setStep("done");
      } else if (hasToken) {
        setStep("chat");
      }
    }
  }, [settings]);

  const handleValidateBot = async () => {
    if (!botToken.trim()) return;
    setValidating(true);
    try {
      const res = await fetch("/api/dental/telegram/validate-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setBotName(data.botUsername || "Bot");
        await updateMut.mutateAsync({ data: { telegramBotToken: botToken.trim() } as never });
        qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
        setStep("chat");
        toast({ title: "Bot validado!", description: `Conectado ao @${data.botUsername}` });
      } else {
        toast({ title: "Token invalido", description: data.error || "Verifique o token", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao validar bot", variant: "destructive" });
    } finally {
      setValidating(false);
    }
  };

  const handleFindChat = async () => {
    setSearching(true);
    try {
      const res = await fetch("/api/dental/telegram/find-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      setChats(data.chats || []);
      if (!data.chats?.length) {
        toast({ title: "Nenhum chat encontrado", description: "Envie /start para o bot no Telegram e tente novamente" });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao buscar chats", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const handleSelectChat = async (selectedChatId: string) => {
    setChatId(selectedChatId);
    try {
      await updateMut.mutateAsync({ data: { telegramChatId: selectedChatId, telegramEscalationEnabled: true } as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      setEnabled(true);
      setStep("done");
      toast({ title: "Telegram configurado!", description: "Voce recebera alertas neste chat" });
    } catch {
      toast({ title: "Erro", description: "Falha ao salvar chat", variant: "destructive" });
    }
  };

  const handleManualChatId = async () => {
    if (!chatId.trim()) return;
    try {
      await updateMut.mutateAsync({ data: { telegramChatId: chatId.trim(), telegramEscalationEnabled: true } as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      setEnabled(true);
      setStep("done");
      toast({ title: "Chat ID salvo!" });
    } catch {
      toast({ title: "Erro", description: "Falha ao salvar chat ID", variant: "destructive" });
    }
  };


  const handleToggle = async (val: boolean) => {
    const prev = enabled;
    setEnabled(val);
    try {
      await updateMut.mutateAsync({ data: { telegramEscalationEnabled: val } as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      toast({ title: val ? "Alertas ativados" : "Alertas desativados" });
    } catch {
      setEnabled(prev);
      toast({ title: "Erro", description: "Falha ao atualizar", variant: "destructive" });
    }
  };

  const handleReset = async () => {
    try {
      await updateMut.mutateAsync({ data: { telegramBotToken: null, telegramChatId: null, telegramEscalationEnabled: false } as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      setBotToken("");
      setChatId("");
      setEnabled(false);
      setBotName(null);
      setChats([]);
      setStep("token");
      toast({ title: "Configuracao removida" });
    } catch {
      toast({ title: "Erro", description: "Falha ao remover configuracao", variant: "destructive" });
    }
  };

  const [testSuccess, setTestSuccess] = useState(false);

  const handleTestWithFeedback = async () => {
    setTesting(true);
    setTestSuccess(false);
    try {
      const res = await fetch("/api/dental/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        setTestSuccess(true);
        toast({ title: "Mensagem enviada!", description: "Verifique seu Telegram" });
      } else {
        toast({ title: "Erro no envio", description: data.error || "Tente novamente", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao enviar teste", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const steps = [
    { num: 1, label: "Criar Bot" },
    { num: 2, label: "Colar Token" },
    { num: 3, label: "Conectar Chat" },
    { num: 4, label: "Testar" },
  ];
  const currentStepNum = step === "token" ? (botToken.trim() ? 2 : 1) : step === "chat" ? 3 : 4;

  const s = settings as unknown as Record<string, unknown>;
  const clinicNameRaw = (s?.clinicName as string) || "";
  const clinicSlug = clinicNameRaw.replace(/[^a-zA-Z0-9]/g, "").substring(0, 18) || "MinhaClinica";
  const suggestedBotName = clinicNameRaw ? `Alertas ${clinicNameRaw}` : "Alertas da Clínica";
  const suggestedBotUsername = `${clinicSlug}AlertasBot`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-500" />
            Alertas via Telegram
          </CardTitle>
          <CardDescription>
            Receba alertas no seu Telegram quando a IA precisar da sua ajuda com algum paciente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {step !== "done" && (
            <div className="flex items-center justify-between mb-2">
              {steps.map((s, i) => (
                <div key={s.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                      s.num < currentStepNum
                        ? "bg-green-500 border-green-500 text-white"
                        : s.num === currentStepNum
                          ? "bg-blue-500 border-blue-500 text-white"
                          : "bg-muted border-muted-foreground/30 text-muted-foreground"
                    }`}>
                      {s.num < currentStepNum ? <Check className="w-4 h-4" /> : s.num}
                    </div>
                    <span className={`text-xs font-medium ${s.num === currentStepNum ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>{s.label}</span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 mt-[-18px] ${s.num < currentStepNum ? "bg-green-500" : "bg-muted-foreground/20"}`} />
                  )}
                </div>
              ))}
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4">
              <div className="p-5 bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-green-700 dark:text-green-400 text-lg">Telegram conectado!</p>
                    <p className="text-sm text-green-600 dark:text-green-500">Voce recebera alertas quando a IA precisar de voce</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <div className="flex items-center gap-2 bg-white dark:bg-green-900/30 px-3 py-2 rounded-lg border border-green-200 dark:border-green-700">
                    <Label htmlFor="tg-enabled" className="text-sm font-medium">Alertas</Label>
                    <Switch id="tg-enabled" checked={enabled} onCheckedChange={handleToggle} />
                  </div>
                  <Button variant="outline" size="sm" onClick={handleTestWithFeedback} disabled={testing}>
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Enviar teste
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                    Reconfigurar
                  </Button>
                </div>
              </div>

              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <h4 className="font-medium flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    Quando voce recebera alertas?
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2"><span className="text-orange-500 mt-0.5">•</span> Paciente pede para falar com um humano</li>
                    <li className="flex items-start gap-2"><span className="text-red-500 mt-0.5">•</span> Reclamacoes ou insatisfacao detectada</li>
                    <li className="flex items-start gap-2"><span className="text-yellow-500 mt-0.5">•</span> Questoes financeiras (reembolso, cobranca)</li>
                    <li className="flex items-start gap-2"><span className="text-red-600 mt-0.5">•</span> Emergencias medicas relatadas</li>
                    <li className="flex items-start gap-2"><span className="text-orange-600 mt-0.5">•</span> Paciente muito irritado ou agressivo</li>
                    <li className="flex items-start gap-2"><span className="text-blue-500 mt-0.5">•</span> Lead recusou agendamento 2 vezes</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <h4 className="font-medium flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-blue-500" />
                    Tempo de controle manual
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Quando voce responder pelo WhatsApp, a IA pausa automaticamente por este tempo.
                  </p>
                  <select
                    className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
                    value={(settings as unknown as Record<string, unknown>)?.humanTakeoverMinutes as number || 5}
                    onChange={async (e) => {
                      try {
                        await updateMut.mutateAsync({ data: { humanTakeoverMinutes: Number(e.target.value) } as never });
                        qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
                        toast({ title: "Tempo atualizado", description: `IA pausara por ${e.target.value} minutos quando voce responder.` });
                      } catch {
                        toast({ title: "Erro", description: "Falha ao atualizar", variant: "destructive" });
                      }
                    }}
                  >
                    <option value={1}>1 minuto</option>
                    <option value={3}>3 minutos</option>
                    <option value={5}>5 minutos (padrao)</option>
                    <option value={10}>10 minutos</option>
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                  </select>
                </CardContent>
              </Card>
            </div>
          )}

          {step === "token" && (
            <div className="space-y-5">
              <div className="p-5 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
                <h4 className="font-semibold text-blue-700 dark:text-blue-400 mb-3 text-base">Passo 1 — Crie seu bot no Telegram</h4>
                <div className="space-y-3 text-sm text-blue-700 dark:text-blue-300">
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
                    <span>
                      Abra o <strong>Telegram</strong> no celular ou computador —{" "}
                      <a href="https://t.me/BotFather?start=newbot" target="_blank" rel="noopener noreferrer" className="underline font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-800">
                        ou clique aqui para abrir o BotFather direto ↗
                      </a>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
                    <span>Na barra de busca, pesquise por <strong className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded">@BotFather</strong> (tem um selo azul de verificado)</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
                    <span>Toque nele e envie a mensagem: <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-mono">/newbot</code></span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</span>
                    <div>
                      <span>Ele vai pedir um <strong>nome</strong> para o bot</span>
                      <p className="text-blue-500 dark:text-blue-400 mt-0.5">Sugestao: <em>"{suggestedBotName}"</em></p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">5</span>
                    <div>
                      <span>Depois vai pedir um <strong>username</strong> (precisa terminar com "bot")</span>
                      <p className="text-blue-500 dark:text-blue-400 mt-0.5">Sugestao: <em>"{suggestedBotUsername}"</em></p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">6</span>
                    <div>
                      <span>O BotFather vai te enviar um <strong>token</strong> — e um codigo longo parecido com:</span>
                      <p className="font-mono text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded mt-1 break-all">1234567890:AAHvDkIab8CpctR1bM0KkGbpS4eGagwu8bM</p>
                      <p className="text-blue-500 dark:text-blue-400 mt-1 font-medium">Copie esse codigo inteiro e cole aqui embaixo</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span><strong>Dica:</strong> Se voce ja criou um bot antes, pode usar o mesmo token. Basta colar abaixo.</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-base font-medium">Passo 2 — Cole o token do bot aqui</Label>
                <p className="text-sm text-muted-foreground">Cole o token que o BotFather te enviou</p>
                <div className="flex gap-2">
                  <Input
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="Cole o token aqui (ex: 1234567890:AAHv...)"
                    className="font-mono text-sm"
                  />
                  <Button onClick={handleValidateBot} disabled={validating || !botToken.trim()} className="shrink-0">
                    {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Validar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === "chat" && (
            <div className="space-y-5">
              <div className="p-5 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Check className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">Bot validado com sucesso! {botName ? `(@${botName})` : ""}</span>
                </div>
              </div>

              <div className="p-5 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
                <h4 className="font-semibold text-blue-700 dark:text-blue-400 mb-3 text-base">Passo 3 — Conecte seu Telegram ao bot</h4>
                <div className="space-y-3 text-sm text-blue-700 dark:text-blue-300">
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
                    <span>
                      {botName ? (
                        <>
                          Abra o bot direto:{" "}
                          <a href={`https://t.me/${botName}`} target="_blank" rel="noopener noreferrer" className="underline font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-800">
                            clique aqui para abrir @{botName} ↗
                          </a>
                        </>
                      ) : (
                        <>Abra o <strong>Telegram</strong> e pesquise pelo bot que voce acabou de criar</>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
                    <span>Toque nele e envie a mensagem: <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-mono">/start</code></span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
                    <span>Volte aqui e clique no botao <strong>"Buscar meu chat"</strong> abaixo</span>
                  </div>
                </div>
              </div>

              <Button onClick={handleFindChat} disabled={searching} size="lg" className="w-full">
                {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                Buscar meu chat
              </Button>

              {chats.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-base font-medium">Selecione o seu chat:</Label>
                  <p className="text-sm text-muted-foreground mb-2">Clique no seu nome para conectar</p>
                  {chats.map((chat) => (
                    <button
                      key={chat.chatId}
                      onClick={() => handleSelectChat(chat.chatId)}
                      className="w-full flex items-center justify-between p-4 border-2 rounded-xl hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                          <span className="text-blue-600 dark:text-blue-400 font-bold">{chat.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-semibold">{chat.name}</p>
                          <p className="text-xs text-muted-foreground">Clique aqui para selecionar</p>
                        </div>
                      </div>
                      <Check className="w-5 h-5 text-blue-500" />
                    </button>
                  ))}
                </div>
              )}

              <div className="border-t pt-4 space-y-2">
                <button onClick={() => {
                  const el = document.getElementById("manual-chat-section");
                  if (el) el.classList.toggle("hidden");
                }} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" /> Inserir Chat ID manualmente (avancado)
                </button>
                <div id="manual-chat-section" className="hidden space-y-2 mt-2">
                  <div className="flex gap-2">
                    <Input
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      placeholder="Ex: 123456789"
                      className="font-mono"
                    />
                    <Button variant="outline" onClick={handleManualChatId} disabled={!chatId.trim()}>
                      Salvar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface BlockedPeriod {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  publicMessage?: string | null;
  isActive: boolean;
}

function VapiTab() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const { activePlan } = useSimulator();
  const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  const [form, setForm] = useState({
    vapiApiKey: "",
    vapiPhoneNumberId: "",
    vapiAssistantId: "",
    callsEnabled: false,
    callWindowStart: "09:00",
    callWindowEnd: "19:00",
    callTriggerHotLead: false,
    callTriggerConfirmation: false,
    callTriggerRecovery: false,
    callMaxPerDay: 5,
    callIntervalHoursAfterWhatsapp: 4,
    vapiInboundPhoneNumberId: "",
    vapiInboundAssistantId: "",
    inboundCallsEnabled: false,
    callVoiceId: "",
    useWhatsappVoiceForCalls: false,
  });
  const [inboundConfig, setInboundConfig] = useState<{ webhookUrl: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testingInbound, setTestingInbound] = useState(false);

  const { data: cartesiaVoices } = useQuery({
    queryKey: ["/api/dental/audio/voices/cartesia", "vapi-tab"],
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      const res = await fetch(`${BASE}/api/dental/audio/voices/cartesia`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { voices: [] };
      return res.json() as Promise<{ voices: { id: string; name: string; gender?: string }[] }>;
    },
  });

  useEffect(() => {
    if (!settings) return;
    const s = settings as Record<string, unknown>;
    setForm({
      vapiApiKey: (s.vapiApiKey as string) || "",
      vapiPhoneNumberId: (s.vapiPhoneNumberId as string) || "",
      vapiAssistantId: (s.vapiAssistantId as string) || "",
      callsEnabled: (s.callsEnabled as boolean) || false,
      callWindowStart: (s.callWindowStart as string) || "09:00",
      callWindowEnd: (s.callWindowEnd as string) || "19:00",
      callTriggerHotLead: (s.callTriggerHotLead as boolean) || false,
      callTriggerConfirmation: (s.callTriggerConfirmation as boolean) || false,
      callTriggerRecovery: (s.callTriggerRecovery as boolean) || false,
      callMaxPerDay: (s.callMaxPerDay as number) || 5,
      callIntervalHoursAfterWhatsapp: (s.callIntervalHoursAfterWhatsapp as number) || 4,
      vapiInboundPhoneNumberId: (s.vapiInboundPhoneNumberId as string) || "",
      vapiInboundAssistantId: (s.vapiInboundAssistantId as string) || "",
      inboundCallsEnabled: (s.inboundCallsEnabled as boolean) || false,
      callVoiceId: (s.callVoiceId as string) || "",
      useWhatsappVoiceForCalls: !s.callVoiceId,
    });
  }, [settings]);

  useEffect(() => {
    const token = localStorage.getItem("authToken");
    fetch(`${BASE}/api/dental/calls/vapi/inbound-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInboundConfig({ webhookUrl: d.webhookUrl }))
      .catch(() => {});
  }, [BASE]);

  const previewVoice = async () => {
    if (!form.callVoiceId) return;
    setPreviewLoading(true);
    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch(`${BASE}/api/dental/audio/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          provider: "cartesia",
          voiceId: form.callVoiceId,
          phrase: "long",
        }),
      });
      if (!res.ok) throw new Error("preview failed");
      const data = await res.json() as { audioBase64?: string; mimeType?: string };
      if (!data.audioBase64) throw new Error("no audio");
      const audio = new Audio(`data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`);
      await audio.play();
    } catch {
      toast({ title: "Erro ao reproduzir prévia da voz", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const testInbound = async () => {
    setTestingInbound(true);
    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch(`${BASE}/api/dental/calls/vapi/inbound-test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: `Número ${data.number} validado!`, description: "Tudo certo para receber ligações." });
      } else {
        toast({ title: data.error || "Erro ao validar", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão", variant: "destructive" });
    } finally {
      setTestingInbound(false);
    }
  };

  const copyWebhook = () => {
    if (!inboundConfig?.webhookUrl) return;
    navigator.clipboard.writeText(inboundConfig.webhookUrl);
    toast({ title: "URL copiada!" });
  };

  const handleSave = () => {
    const { useWhatsappVoiceForCalls, ...rest } = form;
    const payload = {
      ...rest,
      // Cleared callVoiceId means "fall back to the WhatsApp/Cartesia voice".
      callVoiceId: useWhatsappVoiceForCalls ? null : (rest.callVoiceId || null),
    };
    updateMut.mutate({ data: payload }, {
      onSuccess: () => toast({ title: "Configurações de ligações salvas!" }),
      onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
    });
  };

  const [phoneNumbers, setPhoneNumbers] = useState<{ id: string; number: string }[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);

  const fetchPhoneNumbers = async () => {
    setLoadingNumbers(true);
    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch(`${BASE}/api/dental/calls/vapi/phone-numbers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as { id: string; number: string }[];
        setPhoneNumbers(data);
      } else {
        toast({ title: "Erro ao buscar números Vapi. Verifique a chave API.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão com Vapi.", variant: "destructive" });
    } finally {
      setLoadingNumbers(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  const isLockedVapi = isBasicPlan(activePlan);

  return (
    <PlanLockOverlay feature="Ligações IA" isLocked={isLockedVapi}>
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-primary" />
            Ligações por IA (Vapi.ai)
          </CardTitle>
          <CardDescription>
            Configure ligações automáticas para leads quentes, confirmações de consulta e recuperação de pacientes.
            Crie sua conta em <a href="https://vapi.ai" target="_blank" rel="noopener noreferrer" className="underline text-primary">vapi.ai</a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div>
              <Label className="font-semibold">Ligações habilitadas</Label>
              <p className="text-xs text-muted-foreground">Ativa o motor de ligações automáticas</p>
            </div>
            <Switch
              checked={form.callsEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, callsEnabled: v }))}
            />
          </div>

          <div className="space-y-3">
            <Label className="font-semibold">Chave API Vapi</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={form.vapiApiKey}
              onChange={(e) => setForm((f) => ({ ...f, vapiApiKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Encontre em vapi.ai → Dashboard → API Keys</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">ID do Número de Telefone</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchPhoneNumbers}
                disabled={loadingNumbers || !form.vapiApiKey}
              >
                {loadingNumbers ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Buscar números
              </Button>
            </div>
            {phoneNumbers.length > 0 ? (
              <Select
                value={form.vapiPhoneNumberId}
                onValueChange={(v) => setForm((f) => ({ ...f, vapiPhoneNumberId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um número" />
                </SelectTrigger>
                <SelectContent>
                  {phoneNumbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.number} ({n.id.slice(0, 8)}...)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Informe o ID ou busque acima"
                value={form.vapiPhoneNumberId}
                onChange={(e) => setForm((f) => ({ ...f, vapiPhoneNumberId: e.target.value }))}
              />
            )}
            <p className="text-xs text-muted-foreground">ID do número comprado no Vapi. Clique em "Buscar números" para carregar os disponíveis.</p>
          </div>

          <div className="space-y-3">
            <Label className="font-semibold">ID do Assistente (opcional)</Label>
            <Input
              placeholder="Deixe vazio para usar o assistente padrão gerado automaticamente"
              value={form.vapiAssistantId}
              onChange={(e) => setForm((f) => ({ ...f, vapiAssistantId: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Janela de Horário
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Início</Label>
              <Input
                type="time"
                value={form.callWindowStart}
                onChange={(e) => setForm((f) => ({ ...f, callWindowStart: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Fim</Label>
              <Input
                type="time"
                value={form.callWindowEnd}
                onChange={(e) => setForm((f) => ({ ...f, callWindowEnd: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Máx. ligações/dia</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={form.callMaxPerDay}
                onChange={(e) => setForm((f) => ({ ...f, callMaxPerDay: parseInt(e.target.value) || 5 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Horas de intervalo após WhatsApp</Label>
              <Input
                type="number"
                min={1}
                max={72}
                value={form.callIntervalHoursAfterWhatsapp}
                onChange={(e) => setForm((f) => ({ ...f, callIntervalHoursAfterWhatsapp: parseInt(e.target.value) || 4 }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-primary rotate-180" />
            Receber Ligações (Inbound)
          </CardTitle>
          <CardDescription>
            Configure um número Vapi para que pacientes possam ligar para a clínica e serem atendidos pela IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div>
              <Label className="font-semibold">Atendimento de chamadas recebidas</Label>
              <p className="text-xs text-muted-foreground">A IA atende quando alguém liga para o número configurado</p>
            </div>
            <Switch
              checked={form.inboundCallsEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, inboundCallsEnabled: v }))}
            />
          </div>

          <div>
            <Label>ID do número Vapi para receber ligações</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Compre um número americano dentro da Vapi (~US$2/mês) e cole o ID aqui. Pode ser o mesmo do outbound.
            </p>
            <div className="flex gap-2">
              <Select
                value={form.vapiInboundPhoneNumberId || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, vapiInboundPhoneNumberId: v }))}
                disabled={phoneNumbers.length === 0}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={phoneNumbers.length === 0 ? "Carregue os números primeiro" : "Selecione um número"} />
                </SelectTrigger>
                <SelectContent>
                  {phoneNumbers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={fetchPhoneNumbers} disabled={loadingNumbers || !form.vapiApiKey}>
                {loadingNumbers ? <Loader2 className="w-4 h-4 animate-spin" /> : "Carregar"}
              </Button>
            </div>
            {form.vapiInboundPhoneNumberId && (
              <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">{form.vapiInboundPhoneNumberId}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <Label className="font-semibold">Usar a mesma voz do WhatsApp/áudios</Label>
                <p className="text-xs text-muted-foreground">
                  Reaproveita a voz Cartesia escolhida na aba Áudio. Desligue para escolher uma voz dedicada às ligações.
                </p>
              </div>
              <Switch
                checked={form.useWhatsappVoiceForCalls}
                onCheckedChange={(v) => setForm((f) => ({ ...f, useWhatsappVoiceForCalls: v }))}
              />
            </div>

            {!form.useWhatsappVoiceForCalls && (
              <div>
                <Label>Voz da IA nas ligações (Cartesia PT-BR)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  A mesma voz será usada nas ligações recebidas e nas realizadas pela IA.
                </p>
                <div className="flex gap-2">
                  <Select
                    value={form.callVoiceId || ""}
                    onValueChange={(v) => setForm((f) => ({ ...f, callVoiceId: v }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione uma voz" />
                    </SelectTrigger>
                    <SelectContent>
                      {(cartesiaVoices?.voices || []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name} {v.gender ? `· ${v.gender === "female" ? "Feminina" : "Masculina"}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={previewVoice} disabled={!form.callVoiceId || previewLoading}>
                    {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>ID do Assistente Vapi para inbound (opcional)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Se preenchido, esse assistente da Vapi será usado em vez do template padrão do DentalAI.
            </p>
            <Input
              value={form.vapiInboundAssistantId}
              onChange={(e) => setForm((f) => ({ ...f, vapiInboundAssistantId: e.target.value }))}
              placeholder="asst_..."
              className="font-mono text-xs"
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <Label className="text-xs">Webhook (cole na Vapi → Phone Number → Server URL)</Label>
            <div className="flex gap-2">
              <Input value={inboundConfig?.webhookUrl || ""} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={copyWebhook} disabled={!inboundConfig?.webhookUrl}>
                Copiar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Configure este URL como <strong>Server URL</strong> no número da Vapi para que ela peça ao DentalAI qual assistente usar em cada ligação recebida.
            </p>
          </div>

          <Button variant="secondary" onClick={testInbound} disabled={testingInbound || !form.vapiInboundPhoneNumberId} className="w-full">
            {testingInbound ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PhoneCall className="w-4 h-4 mr-2" />}
            Testar configuração inbound
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Gatilhos Automáticos
          </CardTitle>
          <CardDescription>Quando a IA deve ligar automaticamente (a cada 30 min)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: "callTriggerHotLead", label: "Lead Quente sem resposta", desc: "Liga para leads quentes que não responderam no WhatsApp após o intervalo configurado" },
            { key: "callTriggerConfirmation", label: "Confirmação de consulta", desc: "Liga para confirmar consultas agendadas para o dia seguinte" },
            { key: "callTriggerRecovery", label: "Recuperação de pacientes", desc: "Liga para pacientes inativos identificados pelo sistema de recuperação" },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div>
                <Label className="font-semibold">{label}</Label>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                checked={form[key as keyof typeof form] as boolean}
                onCheckedChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full">
        {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
        Salvar configurações de ligações
      </Button>
    </div>
    </PlanLockOverlay>
  );
}

function formatDate(d: string) {
  return d.split("-").reverse().join("/");
}

interface BlockedPeriod {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  publicMessage: string | null;
  isActive: boolean;
}

function AutomacoesTab() {
  const { data: settings, isLoading } = useGetSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    followUpConfirmation: true,
    confirmDaysBefore: 1,
    followUpReminder: true,
    reminderHoursBefore: 24,
    followUpPostAppointment: true,
    postAppointmentHoursAfter: 1,
    noShowEnabled: false,
    noShowPatientContactHoursAfter: 24,
    birthdayEnabled: false,
    birthdayHour: 9,
  });

  useEffect(() => {
    if (settings) {
      const s = settings as unknown as Record<string, unknown>;
      setForm({
        followUpConfirmation: s.followUpConfirmation !== false,
        confirmDaysBefore: (s.confirmDaysBefore as number) || 1,
        followUpReminder: s.followUpReminder !== false,
        reminderHoursBefore: (s.reminderHoursBefore as number) || 24,
        followUpPostAppointment: s.followUpPostAppointment !== false,
        postAppointmentHoursAfter: (s.postAppointmentHoursAfter as number) || 1,
        noShowEnabled: s.noShowEnabled === true,
        noShowPatientContactHoursAfter: (s.noShowPatientContactHoursAfter as number) || 24,
        birthdayEnabled: s.birthdayEnabled === true,
        birthdayHour: (s.birthdayHour as number) ?? 9,
      });
    }
  }, [settings]);

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ data: form as never });
      qc.invalidateQueries({ queryKey: ["/api/dental/settings"] });
      toast({ title: "Automacoes salvas!" });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  }

  const [periods, setPeriods] = useState<BlockedPeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlockedPeriod | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const emptyForm = { title: "", startDate: "", endDate: "", publicMessage: "", isActive: true };
  const [periodForm, setPeriodForm] = useState(emptyForm);
  const apiBase = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  async function fetchPeriods() {
    try {
      setPeriodsLoading(true);
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json() as BlockedPeriod[];
        setPeriods(data);
      }
    } finally {
      setPeriodsLoading(false);
    }
  }

  useEffect(() => { fetchPeriods(); }, []);

  function openCreate() {
    setEditing(null);
    setPeriodForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(p: BlockedPeriod) {
    setEditing(p);
    setPeriodForm({ title: p.title, startDate: p.startDate, endDate: p.endDate, publicMessage: p.publicMessage || "", isActive: p.isActive });
    setDialogOpen(true);
  }

  async function handleSavePeriod() {
    if (!periodForm.title || !periodForm.startDate || !periodForm.endDate) {
      toast({ title: "Preencha todos os campos obrigatorios", variant: "destructive" });
      return;
    }
    if (periodForm.startDate > periodForm.endDate) {
      toast({ title: "Data de inicio deve ser anterior ou igual a data de fim", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { title: periodForm.title, startDate: periodForm.startDate, endDate: periodForm.endDate, publicMessage: periodForm.publicMessage || null, isActive: periodForm.isActive };
      if (editing) {
        const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
        if (!resp.ok) throw new Error("Erro ao atualizar");
        toast({ title: "Periodo de bloqueio atualizado" });
      } else {
        const resp = await fetch(`${apiBase}/api/dental/blocked-periods`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
        if (!resp.ok) throw new Error("Erro ao criar");
        toast({ title: "Periodo de bloqueio criado" });
      }
      setDialogOpen(false);
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePeriod(p: BlockedPeriod) {
    try {
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isActive: !p.isActive }) });
      if (!resp.ok) throw new Error("Erro ao atualizar");
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDeletePeriod(id: number) {
    setDeleting(id);
    try {
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${id}`, { method: "DELETE", credentials: "include" });
      if (!resp.ok) throw new Error("Erro ao excluir");
      toast({ title: "Periodo de bloqueio removido" });
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  const today = new Date().toISOString().split("T")[0];

  function getPeriodStatus(p: BlockedPeriod) {
    if (!p.isActive) return { label: "Inativo", color: "secondary" as const };
    if (today >= p.startDate && today <= p.endDate) return { label: "Ativo Agora", color: "destructive" as const };
    if (today < p.startDate) return { label: "Agendado", color: "default" as const };
    return { label: "Encerrado", color: "secondary" as const };
  }

  function MensagemFixa({ texto }: { texto: string }) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Mensagem que sera enviada automaticamente</p>
        <p className="text-sm text-foreground leading-relaxed">{texto}</p>
      </div>
    );
  }

  if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg border border-primary/20 bg-primary/5">
        <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Mensagens gerenciadas automaticamente pela IA</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Todas as mensagens desta aba são fixas e aprimoradas continuamente pelo sistema com autoaprendizado. Você só precisa ativar/desativar cada automação e configurar os horários — a IA cuida do resto.
          </p>
        </div>
      </div>

      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                Confirmacao de Consulta
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Envia mensagem automatica via WhatsApp ao paciente solicitando confirmacao de presenca antes da consulta.
              </CardDescription>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
              <Sparkles className="w-3 h-3" /> Otimizada pela IA
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativar confirmacao automatica</Label>
              <p className="text-xs text-muted-foreground">Solicita confirmacao de presenca via WhatsApp</p>
            </div>
            <Switch checked={form.followUpConfirmation} onCheckedChange={(v) => setForm({ ...form, followUpConfirmation: v })} />
          </div>
          {form.followUpConfirmation && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Enviar</span>
                <Select value={String(form.confirmDaysBefore)} onValueChange={(v) => setForm({ ...form, confirmDaysBefore: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 7].map((d) => (
                      <SelectItem key={d} value={String(d)} className="text-xs">{d} {d === 1 ? "dia" : "dias"} antes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">da consulta</span>
              </div>
              <MensagemFixa texto="Ola [Nome]! Sua consulta esta confirmada para [data] as [horario]. Pode confirmar sua presenca respondendo SIM ou nos avisar se precisar remarcar. Ate logo!" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                Lembrete antes da Consulta
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Avisa o paciente com antecedencia configuravel via WhatsApp para reduzir faltas.
              </CardDescription>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
              <Sparkles className="w-3 h-3" /> Otimizada pela IA
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativar lembrete automatico</Label>
              <p className="text-xs text-muted-foreground">Avisa o paciente antes da consulta via WhatsApp</p>
            </div>
            <Switch checked={form.followUpReminder} onCheckedChange={(v) => setForm({ ...form, followUpReminder: v })} />
          </div>
          {form.followUpReminder && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Enviar</span>
                <Select value={String(form.reminderHoursBefore)} onValueChange={(v) => setForm({ ...form, reminderHoursBefore: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 6, 12, 24, 48].map((h) => (
                      <SelectItem key={h} value={String(h)} className="text-xs">{h}h antes</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">da consulta</span>
              </div>
              <MensagemFixa texto="Ola [Nome]! 😊 So passando para lembrar que voce tem uma consulta marcada para [data] as [horario]. Nos vemos la — qualquer duvida e so chamar!" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                Pos-Consulta
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Acompanha o paciente apos o atendimento com uma mensagem automatica de cuidado.
              </CardDescription>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
              <Sparkles className="w-3 h-3" /> Otimizada pela IA
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativar mensagem pos-consulta</Label>
              <p className="text-xs text-muted-foreground">Envia automaticamente apos a conclusao do atendimento</p>
            </div>
            <Switch checked={form.followUpPostAppointment} onCheckedChange={(v) => setForm({ ...form, followUpPostAppointment: v })} />
          </div>
          {form.followUpPostAppointment && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Enviar</span>
                <Select value={String(form.postAppointmentHoursAfter)} onValueChange={(v) => setForm({ ...form, postAppointmentHoursAfter: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 6, 12, 24].map((h) => (
                      <SelectItem key={h} value={String(h)} className="text-xs">{h}h apos a consulta</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <MensagemFixa texto="[Nome], esperamos que tenha gostado do atendimento! Se tiver alguma duvida ou precisar de algo, estamos a disposicao. 😊" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <UserX className="w-4 h-4 text-red-500" />
                Faltas & Reagendamento
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Quando um paciente nao comparece, o sistema envia automaticamente uma mensagem de reagendamento via WhatsApp.
              </CardDescription>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
              <Sparkles className="w-3 h-3" /> Otimizada pela IA
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Contato automatico apos falta</Label>
              <p className="text-xs text-muted-foreground">Enviar mensagem de reagendamento quando uma falta for registrada</p>
            </div>
            <Switch checked={form.noShowEnabled} onCheckedChange={(v) => setForm({ ...form, noShowEnabled: v })} />
          </div>
          {form.noShowEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Enviar</span>
                <Select value={String(form.noShowPatientContactHoursAfter)} onValueChange={(v) => setForm({ ...form, noShowPatientContactHoursAfter: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hora apos</SelectItem>
                    <SelectItem value="2">2 horas apos</SelectItem>
                    <SelectItem value="4">4 horas apos</SelectItem>
                    <SelectItem value="8">8 horas apos</SelectItem>
                    <SelectItem value="24">24 horas apos</SelectItem>
                    <SelectItem value="48">48 horas apos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <MensagemFixa texto="Ola [Nome]! Notamos que nao conseguiu comparecer a sua consulta de hoje. Sem problemas — quando quiser remarcar, e so nos chamar aqui pelo WhatsApp. Estamos a disposicao!" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Cake className="w-4 h-4 text-pink-500" />
                Mensagem de Aniversario
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Envia automaticamente uma mensagem de parabens via WhatsApp no dia do aniversario dos pacientes.
              </CardDescription>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
              <Sparkles className="w-3 h-3" /> Otimizada pela IA
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Ativar mensagem de aniversario</Label>
              <p className="text-xs text-muted-foreground">Envia automaticamente no dia do aniversario</p>
            </div>
            <Switch checked={form.birthdayEnabled} onCheckedChange={(v) => setForm({ ...form, birthdayEnabled: v })} />
          </div>
          {form.birthdayEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Horario de envio:</span>
                <Select value={String(form.birthdayHour)} onValueChange={(v) => setForm({ ...form, birthdayHour: Number(v) })}>
                  <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[7,8,9,10,11,12,13,14,15,16,17,18].map((h) => (
                      <SelectItem key={h} value={String(h)} className="text-xs">{h.toString().padStart(2,"0")}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <MensagemFixa texto="Feliz aniversario, [Nome]! 🎂🎉 Toda a equipe da clinica deseja um dia muito especial para voce. Que venham muitos anos de saude e sorrisos!" />
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMut.isPending} className="w-full sm:w-auto">
        {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
        Salvar Automacoes
      </Button>

      <div className="border-t border-border/40 pt-6">
        <Card className="border border-border/50">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarOff className="w-4 h-4 text-primary" />
                  Bloqueio de Agenda
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Bloqueie intervalos de datas (ferias, reforma, feriados). A IA comunicara automaticamente o bloqueio aos pacientes.
                </CardDescription>
              </div>
              <Button size="sm" onClick={openCreate} className="shrink-0 gap-1">
                <Plus className="w-3.5 h-3.5" /> Adicionar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {periodsLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
              </div>
            ) : periods.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Ban className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">Nenhum periodo de bloqueio configurado</p>
                <p className="text-xs mt-1">Adicione ferias, recessos ou qualquer periodo em que a clinica ficara fechada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {periods.map((p) => {
                  const status = getPeriodStatus(p);
                  return (
                    <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.title}</span>
                          <Badge variant={status.color} className="text-[10px] px-1.5 py-0">{status.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(p.startDate)} ate {formatDate(p.endDate)}
                        </p>
                        {p.publicMessage && (
                          <p className="text-xs text-muted-foreground mt-1 italic truncate max-w-md">
                            "{p.publicMessage}"
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch checked={p.isActive} onCheckedChange={() => handleTogglePeriod(p)} className="scale-75" />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeletePeriod(p.id)} disabled={deleting === p.id}>
                          {deleting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-orange-200/50 bg-orange-50/30 dark:border-orange-800/30 dark:bg-orange-950/10 mt-4">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">Alerta de Urgencia via Telegram</p>
                <p className="text-xs text-muted-foreground">
                  Se durante um periodo bloqueado um paciente demonstrar urgencia, a IA reagira com empatia e enviara automaticamente um alerta pelo Telegram ao profissional.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Periodo de Bloqueio" : "Novo Periodo de Bloqueio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Titulo <span className="text-destructive">*</span></Label>
              <Input value={periodForm.title} onChange={(e) => setPeriodForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ex: Recesso de Natal" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Data de Inicio <span className="text-destructive">*</span></Label>
                <Input type="date" value={periodForm.startDate} onChange={(e) => setPeriodForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Data de Fim <span className="text-destructive">*</span></Label>
                <Input type="date" value={periodForm.endDate} onChange={(e) => setPeriodForm((f) => ({ ...f, endDate: e.target.value }))} min={periodForm.startDate} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Mensagem Publica (opcional)</Label>
              <Textarea value={periodForm.publicMessage || ""} onChange={(e) => setPeriodForm((f) => ({ ...f, publicMessage: e.target.value }))} placeholder="Ex: A clinica estara em recesso de 23/12 a 02/01. Voltamos em 03/01!" className="text-xs min-h-[80px] resize-none" />
              <p className="text-[11px] text-muted-foreground">Se em branco, a IA usara uma mensagem padrao informando o periodo.</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Periodo ativo</Label>
              <Switch checked={periodForm.isActive} onCheckedChange={(v) => setPeriodForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSavePeriod} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BlockedPeriodsTab() {
  const { toast } = useToast();
  const [periods, setPeriods] = useState<BlockedPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlockedPeriod | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const emptyForm = { title: "", startDate: "", endDate: "", publicMessage: "", isActive: true };
  const [form, setForm] = useState(emptyForm);

  const apiBase = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  async function fetchPeriods() {
    try {
      setLoading(true);
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json() as BlockedPeriod[];
        setPeriods(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPeriods(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(p: BlockedPeriod) {
    setEditing(p);
    setForm({
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      publicMessage: p.publicMessage || "",
      isActive: p.isActive,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title || !form.startDate || !form.endDate) {
      toast({ title: "Preencha todos os campos obrigatorios", variant: "destructive" });
      return;
    }
    if (form.startDate > form.endDate) {
      toast({ title: "A data de inicio deve ser anterior ou igual a data de fim", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        startDate: form.startDate,
        endDate: form.endDate,
        publicMessage: form.publicMessage || null,
        isActive: form.isActive,
      };
      if (editing) {
        const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error("Erro ao atualizar");
        toast({ title: "Periodo de bloqueio atualizado" });
      } else {
        const resp = await fetch(`${apiBase}/api/dental/blocked-periods`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error("Erro ao criar");
        toast({ title: "Periodo de bloqueio criado" });
      }
      setDialogOpen(false);
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(p: BlockedPeriod) {
    try {
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      if (!resp.ok) throw new Error("Erro ao atualizar");
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      const resp = await fetch(`${apiBase}/api/dental/blocked-periods/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Erro ao excluir");
      toast({ title: "Periodo de bloqueio removido" });
      fetchPeriods();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  const today = new Date().toISOString().split("T")[0];

  function getPeriodStatus(p: BlockedPeriod) {
    if (!p.isActive) return { label: "Inativo", color: "secondary" as const };
    if (today >= p.startDate && today <= p.endDate) return { label: "Ativo Agora", color: "destructive" as const };
    if (today < p.startDate) return { label: "Agendado", color: "default" as const };
    return { label: "Encerrado", color: "secondary" as const };
  }

  return (
    <div className="space-y-6">
      <Card className="border border-border/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarOff className="w-4 h-4 text-primary" />
                Periodos de Bloqueio
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Bloqueie intervalos de datas (ferias, reforma, feriados). A IA comunicara automaticamente o bloqueio aos pacientes. Em caso de urgencia durante o periodo bloqueado, o profissional sera alertado via Telegram.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} className="shrink-0 gap-1">
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : periods.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Ban className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Nenhum periodo de bloqueio configurado</p>
              <p className="text-xs mt-1">Adicione ferias, recessos ou qualquer periodo em que a clinica ficara fechada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {periods.map((p) => {
                const status = getPeriodStatus(p);
                return (
                  <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.title}</span>
                        <Badge variant={status.color} className="text-[10px] px-1.5 py-0">{status.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(p.startDate)} ate {formatDate(p.endDate)}
                      </p>
                      {p.publicMessage && (
                        <p className="text-xs text-muted-foreground mt-1 italic truncate max-w-md">
                          "{p.publicMessage}"
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={p.isActive}
                        onCheckedChange={() => handleToggle(p)}
                        className="scale-75"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(p.id)}
                        disabled={deleting === p.id}
                      >
                        {deleting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-orange-200/50 bg-orange-50/30 dark:border-orange-800/30 dark:bg-orange-950/10">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-orange-700 dark:text-orange-400">Alerta de Urgencia via Telegram</p>
              <p className="text-xs text-muted-foreground">
                Se durante um periodo bloqueado um paciente demonstrar urgencia (dor intensa, sangramento, emergencia), a IA reagira com empatia e enviara automaticamente um alerta pelo Telegram ao profissional. Configure o Telegram na aba correspondente para receber esses alertas.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Periodo de Bloqueio" : "Novo Periodo de Bloqueio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Titulo <span className="text-destructive">*</span></Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex: Recesso de Natal"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Data de Inicio <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Data de Fim <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  min={form.startDate}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Mensagem Publica (opcional)</Label>
              <Textarea
                value={form.publicMessage || ""}
                onChange={(e) => setForm((f) => ({ ...f, publicMessage: e.target.value }))}
                placeholder="Ex: A clinica estara em recesso de 23/12 a 02/01. Estamos ansiosos para atende-lo a partir de 03/01!"
                className="text-xs min-h-[80px] resize-none"
              />
              <p className="text-[11px] text-muted-foreground">Se em branco, a IA usara uma mensagem padrao informando o periodo de bloqueio.</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Periodo ativo</Label>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editing ? "Salvar alteracoes" : "Criar periodo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TosAcceptanceRow {
  id: number;
  kind: "tos" | "subscription" | string;
  label: string;
  title: string | null;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  publishedAt: string | null;
}

function LegalDocumentsTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TosAcceptanceRow[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const baseUrl = `${import.meta.env.BASE_URL}api/dental/tos`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${baseUrl}/acceptances`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { acceptances: TosAcceptanceRow[] };
        if (!cancelled) setRows(data.acceptances ?? []);
      } catch (e) {
        if (!cancelled)
          toast({
            title: "Não foi possível carregar seus aceites",
            description: e instanceof Error ? e.message : "Tente novamente em instantes.",
            variant: "destructive",
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDownload(row: TosAcceptanceRow) {
    setDownloadingId(row.id);
    try {
      const token = getAuthToken();
      const r = await fetch(`${baseUrl}/acceptance/${row.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.label.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "Erro ao baixar PDF",
        description: e instanceof Error ? e.message : "Tente novamente em instantes.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });

  return (
    <div className="space-y-6">
      <Card className="border border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            Termos &amp; Contratos aceitos
          </CardTitle>
          <CardDescription className="text-xs">
            Baixe uma cópia em PDF dos documentos que você aceitou — útil para arquivo pessoal,
            auditoria interna e prova judicial (cláusula 11.3 do contrato de assinatura).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
              <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Nenhum aceite registrado ainda. Quando você aceitar um documento ele aparecerá aqui.
              </p>
            </div>
          ) : (
            <ul className="space-y-3" data-testid="tos-acceptance-list">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border/60 p-4 flex items-start justify-between gap-4 hover:border-primary/40 transition-colors"
                  data-testid={`tos-acceptance-${row.kind}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{row.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Aceito em {formatDate(row.acceptedAt)}
                      </p>
                      {row.ipAddress && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          IP de origem: <span className="font-mono">{row.ipAddress}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload(row)}
                    disabled={downloadingId === row.id}
                    data-testid={`button-download-tos-${row.id}`}
                    className="flex-shrink-0"
                  >
                    {downloadingId === row.id ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    Baixar PDF
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const VALID_TABS = ["clinic","whatsapp","professionals","procedures","automacoes","remarketing","audio","telegram","blocked","legal","reset"];

export default function SettingsPage() {
  const initialTab = (() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    return p && VALID_TABS.includes(p) ? p : "clinic";
  })();
  const { activePlan } = useSimulator();
  const isBasic = isBasicPlan(activePlan);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Configuracoes</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie sua clinica, WhatsApp e procedimentos</p>
      </div>
      <Tabs defaultValue={initialTab}>
        <div className="overflow-x-auto scrollbar-thin w-full pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          <TabsList className="h-auto gap-0.5 bg-muted/50 p-1 rounded-xl w-max">
            <TabsTrigger value="clinic" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <SettingsIcon className="w-3 h-3" /> Clinica
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <MessageSquare className="w-3 h-3" /> WhatsApp
            </TabsTrigger>
            <TabsTrigger value="professionals" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Users className="w-3 h-3" /> Profissionais
            </TabsTrigger>
            <TabsTrigger value="procedures" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Stethoscope className="w-3 h-3" /> Procedimentos
            </TabsTrigger>
            <TabsTrigger value="automacoes" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Bell className="w-3 h-3" /> Automações
            </TabsTrigger>
            <TabsTrigger value="remarketing" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Target className="w-3 h-3" /> Remarketing {isBasic && <Lock className="w-2.5 h-2.5 opacity-50" />}
            </TabsTrigger>
            <TabsTrigger value="audio" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Volume2 className="w-3 h-3" /> Audio IA {isBasic && <Lock className="w-2.5 h-2.5 opacity-50" />}
            </TabsTrigger>
            <TabsTrigger value="telegram" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <Send className="w-3 h-3" /> Telegram
            </TabsTrigger>
            <TabsTrigger value="blocked" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <CalendarOff className="w-3 h-3" /> Bloqueios
            </TabsTrigger>
            <TabsTrigger value="calls" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <PhoneCall className="w-3 h-3" /> Ligações IA {isBasic && <Lock className="w-2.5 h-2.5 opacity-50" />}
            </TabsTrigger>
            <TabsTrigger value="legal" className="shrink-0 text-[11px] gap-1 px-2 py-1">
              <ScrollText className="w-3 h-3" /> Termos &amp; Contratos
            </TabsTrigger>
            <TabsTrigger value="reset" className="shrink-0 text-[11px] gap-1 px-2 py-1 text-destructive hover:text-destructive">
              <AlertTriangle className="w-3 h-3" /> Reset
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="clinic" className="mt-6"><ClinicSettingsTab /></TabsContent>
        <TabsContent value="whatsapp" className="mt-6"><WhatsAppTab /></TabsContent>
        <TabsContent value="professionals" className="mt-6"><ProfessionalsTab /></TabsContent>
        <TabsContent value="procedures" className="mt-6"><ProceduresTab /></TabsContent>
        <TabsContent value="automacoes" className="mt-6"><AutomacoesTab /></TabsContent>
        <TabsContent value="remarketing" className="mt-6"><RemarketingTab /></TabsContent>
        <TabsContent value="audio" className="mt-6"><AudioTab /></TabsContent>
        <TabsContent value="telegram" className="mt-6"><TelegramTab /></TabsContent>
        <TabsContent value="blocked" className="mt-6"><BlockedPeriodsTab /></TabsContent>
        <TabsContent value="calls" className="mt-6"><VapiTab /></TabsContent>
        <TabsContent value="legal" className="mt-6"><LegalDocumentsTab /></TabsContent>
        <TabsContent value="reset" className="mt-6"><ResetTab /></TabsContent>
      </Tabs>
    </div>
  );
}
