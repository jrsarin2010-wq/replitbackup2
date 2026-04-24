import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Alert, AlertDescription,
} from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, Calendar, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Crown, Sparkles, Shield, Undo2,
  Mic, Zap, Star, Tag, MessageSquare, ArrowUpCircle, ArrowDownCircle, Clock,
} from "lucide-react";
import {
  getPlanLabel,
  getPlanOriginalPrice,
  getPlanPromoLabel,
  getMonthlyConversationsLabel,
  getMonthlyConversationsLimit,
  EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE,
} from "@/lib/plan-features";
import {
  useGetSubscription, useCancelSubscription, useReactivateSubscription,
  getGetSubscriptionQueryKey,
  useGetAudioCredits,
  useGetConversationQuota,
  getGetConversationQuotaQueryKey,
} from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL || "/";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

interface AudioCredits {
  balance: number;
  monthlyCharsUsed?: number;
  monthlyQuota?: number;
  monthlyCharsRemaining?: number;
  rechargeBalance?: number;
  totalAvailable?: number;
}

const MONTHLY_QUOTA_CHARS = 27_000;
const CHARS_PER_MINUTE = 900;

function charsToMinutes(chars: number): number {
  return Math.round(chars / CHARS_PER_MINUTE);
}

interface RechargePackage {
  id: string;
  name: string;
  chars: number;
  priceLabel: string;
  description: string;
  highlight?: boolean;
}

function RechargeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [taxId, setTaxId] = useState("");
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [pkgsLoaded, setPkgsLoaded] = useState(false);

  const loadPackages = async () => {
    if (pkgsLoaded) return;
    try {
      const res = await fetch(`${BASE}api/dental/audio/credits/packages`);
      if (res.ok) {
        const data = await res.json() as RechargePackage[];
        setPackages(data);
        if (data.length > 0) setSelectedPkg(data.find((p) => p.highlight)?.id || data[0].id);
      }
    } catch { /* ignore */ }
    setPkgsLoaded(true);
  };

  const handleOpen = () => {
    loadPackages();
  };

  const handlePurchase = async () => {
    if (!selectedPkg || !taxId.trim()) {
      toast({ title: "Preencha o CPF/CNPJ", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/audio/credits/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selectedPkg, taxId }),
      });
      const data = await res.json() as { paymentUrl?: string; error?: string };
      if (!res.ok || data.error) {
        toast({ title: "Erro", description: data.error || "Erro ao gerar cobrança", variant: "destructive" });
      } else if (data.paymentUrl) {
        window.open(data.paymentUrl, "_blank");
        onClose();
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao gerar cobrança", variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else handleOpen(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-500" />
            Recarregar Minutos de Áudio
          </DialogTitle>
          <DialogDescription>
            Escolha um pacote de recarga para continuar usando respostas em áudio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {!pkgsLoaded ? (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          ) : (
            packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg.id)}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                  selectedPkg === pkg.id
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20"
                    : "border-border hover:border-violet-200 dark:hover:border-violet-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{pkg.name}</span>
                      {pkg.highlight && (
                        <Badge className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                          Popular
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{pkg.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{pkg.priceLabel}</p>
                    {selectedPkg === pkg.id && (
                      <CheckCircle2 className="w-4 h-4 text-violet-500 ml-auto mt-1" />
                    )}
                  </div>
                </div>
              </button>
            ))
          )}

          <div className="space-y-1.5 pt-2">
            <Label htmlFor="taxId" className="text-xs font-medium">CPF ou CNPJ *</Label>
            <Input
              id="taxId"
              placeholder="000.000.000-00"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground">Necessário para emissão do comprovante de pagamento PIX.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            onClick={handlePurchase}
            disabled={loading || !selectedPkg || !taxId.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
            Gerar PIX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConversationRechargeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [taxId, setTaxId] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePurchase = async () => {
    if (!taxId.trim()) {
      toast({ title: "Preencha o CPF/CNPJ", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/conversations-quota/recharge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxId }),
      });
      const data = await res.json() as { paymentUrl?: string; error?: string };
      if (!res.ok || data.error) {
        toast({ title: "Erro", description: data.error || "Erro ao gerar cobrança", variant: "destructive" });
      } else if (data.paymentUrl) {
        window.open(data.paymentUrl, "_blank");
        queryClient.invalidateQueries({ queryKey: getGetConversationQuotaQueryKey() });
        onClose();
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao gerar cobrança", variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-500" />
            Recarregar Conversas de IA
          </DialogTitle>
          <DialogDescription>
            Adicione 400 conversas extras por R$&nbsp;47,00 via PIX.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Pacote Padrão</p>
                <p className="text-xs text-muted-foreground mt-0.5">400 conversas de IA extras</p>
                <p className="text-xs text-muted-foreground mt-0.5">1 conversa = 1 contato único em 24h</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-xl">R$&nbsp;47</p>
                <p className="text-xs text-muted-foreground">via PIX</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conv-taxId" className="text-xs font-medium">CPF ou CNPJ *</Label>
            <Input
              id="conv-taxId"
              placeholder="000.000.000-00"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground">Necessário para o comprovante de pagamento PIX.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            onClick={handlePurchase}
            disabled={loading || !taxId.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
            Gerar PIX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PlanId = "basic" | "essencial" | "pro";

interface PlanInfo {
  id: PlanId;
  label: string;
  priceInCents: number;
  monthlyConversationsBase?: number;
  extraConversationsPerProfessional?: number;
}

interface PlansResponse {
  plans: PlanInfo[];
  currentPlan: PlanId | null;
}

interface PlanChangePreview {
  changeType: "upgrade" | "downgrade";
  fromPlan: PlanId;
  fromPlanLabel: string;
  targetPlan: PlanId;
  targetPlanLabel: string;
  targetPriceInCents: number;
  // Upgrade only
  currentDailyPriceInCents?: number;
  daysRemaining?: number;
  creditInCents?: number;
  finalChargeInCents?: number;
  // Downgrade only
  effectiveAt?: string | null;
  noRefund?: boolean;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PlanChangeSection({
  currentPlan,
  scheduledPlan,
  scheduledPlanEffectiveAt,
  expiresAt,
}: {
  currentPlan: PlanId;
  scheduledPlan: string | null;
  scheduledPlanEffectiveAt: string | null;
  expiresAt: string | null | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pixModal, setPixModal] = useState<{ paymentUrl?: string; finalChargeInCents?: number } | null>(null);
  const [taxIdInput, setTaxIdInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}api/dental/subscription/plans`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as PlansResponse;
          if (!cancelled) setPlans(Array.isArray(data?.plans) ? data.plans : []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setPlansLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const openPreview = async (target: PlanId) => {
    setPreviewLoading(true);
    setPreview(null);
    setTaxIdInput("");
    setPreviewOpen(true);
    try {
      const res = await fetch(`${BASE}api/dental/subscription/plan-change/preview?targetPlan=${target}`, {
        credentials: "include",
      });
      const data = await res.json() as PlanChangePreview & { error?: string };
      if (!res.ok || data.error) {
        toast({ title: "Erro", description: data.error || "Não foi possível calcular.", variant: "destructive" });
        setPreviewOpen(false);
      } else {
        setPreview(data);
      }
    } catch {
      toast({ title: "Erro", description: "Não foi possível calcular a mudança.", variant: "destructive" });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmUpgrade = async () => {
    if (!preview) return;
    const cleanTaxId = taxIdInput.replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      toast({ title: "CPF ou CNPJ obrigatório", description: "Digite um CPF (11 dígitos) ou CNPJ (14 dígitos).", variant: "destructive" });
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/subscription/plan-change/upgrade`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan: preview.targetPlan, taxId: cleanTaxId }),
      });
      const data = await res.json() as { paymentUrl?: string; finalChargeInCents?: number; error?: string };
      if (!res.ok || data.error) {
        toast({ title: "Erro", description: data.error || "Não foi possível gerar o PIX.", variant: "destructive" });
      } else {
        setPreviewOpen(false);
        setPixModal({ paymentUrl: data.paymentUrl, finalChargeInCents: data.finalChargeInCents });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao processar upgrade.", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDowngrade = async () => {
    if (!preview) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/subscription/plan-change/schedule-downgrade`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan: preview.targetPlan }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) {
        toast({ title: "Erro", description: data.error || "Não foi possível agendar.", variant: "destructive" });
      } else {
        toast({ title: "Downgrade agendado", description: "Será aplicado na próxima renovação." });
        setPreviewOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao agendar downgrade.", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const cancelScheduledDowngrade = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/subscription/plan-change/schedule-downgrade`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        toast({ title: "Erro", description: "Não foi possível cancelar.", variant: "destructive" });
      } else {
        toast({ title: "Downgrade cancelado", description: "Seu plano atual será mantido." });
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao cancelar.", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const otherPlans = (plans ?? []).filter((p) => p.id !== currentPlan);
  const currentPlanInfo = (plans ?? []).find((x) => x.id === currentPlan);

  return (
    <>
      {scheduledPlan && scheduledPlanEffectiveAt && (
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50">
          <Clock className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 dark:text-blue-300 flex items-center justify-between gap-3">
            <span>
              Downgrade agendado para <strong>{getPlanLabel(scheduledPlan)}</strong> em <strong>{formatDateShort(scheduledPlanEffectiveAt)}</strong>.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelScheduledDowngrade}
              disabled={actionLoading}
              className="border-blue-300 text-blue-700 hover:bg-blue-100/60 dark:text-blue-300 dark:border-blue-800"
            >
              Cancelar agendamento
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-emerald-500" />
            <CardTitle className="text-lg">Trocar de plano</CardTitle>
          </div>
          <CardDescription>
            Upgrade aplicado na hora (paga só a diferença via PIX). Downgrade vale na próxima renovação — sem reembolso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!plansLoaded ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : otherPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum outro plano disponível.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {otherPlans.map((p) => {
                const isUpgrade = p.priceInCents > (currentPlanInfo?.priceInCents ?? 0);
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border-2 border-border p-4 flex flex-col gap-3 bg-white/60 dark:bg-zinc-800/40"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-sm">{p.label}</p>
                        <p className="text-2xl font-bold mt-1">{formatBRL(p.priceInCents)}<span className="text-xs text-muted-foreground font-normal">/mês</span></p>
                      </div>
                      <Badge variant="outline" className={isUpgrade ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400" : "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"}>
                        {isUpgrade ? "Upgrade" : "Downgrade"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300 font-semibold">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {(p.monthlyConversationsBase ?? getMonthlyConversationsLimit(p.id, 1)).toLocaleString("pt-BR")} conversas/mês incluídas
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => openPreview(p.id)}
                      disabled={scheduledPlan === p.id}
                      className={isUpgrade ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-amber-600 hover:bg-amber-700 text-white"}
                    >
                      {isUpgrade ? <ArrowUpCircle className="w-4 h-4 mr-2" /> : <ArrowDownCircle className="w-4 h-4 mr-2" />}
                      {scheduledPlan === p.id ? "Já agendado" : (isUpgrade ? "Fazer upgrade" : "Agendar downgrade")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={(o) => { if (!o) { setPreviewOpen(false); setPreview(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview?.changeType === "upgrade" ? <ArrowUpCircle className="w-5 h-5 text-emerald-600" /> : <ArrowDownCircle className="w-5 h-5 text-amber-600" />}
              {preview?.changeType === "upgrade" ? "Confirmar upgrade" : "Agendar downgrade"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 space-y-3">
                {previewLoading || !preview ? (
                  <Skeleton className="h-32 w-full" />
                ) : preview.changeType === "upgrade" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Você está mudando para <strong>{preview.targetPlanLabel}</strong>. O upgrade é aplicado imediatamente após a confirmação do pagamento via PIX.
                    </p>
                    <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Plano novo</span><span>{formatBRL(preview.targetPriceInCents)}/mês</span></div>
                      {typeof preview.creditInCents === "number" && preview.creditInCents > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Crédito do plano atual ({preview.daysRemaining ?? 0} dias restantes)</span><span>− {formatBRL(preview.creditInCents)}</span></div>
                      )}
                      <Separator className="my-1.5" />
                      <div className="flex justify-between font-bold text-base"><span>Total a pagar agora</span><span className="text-emerald-700 dark:text-emerald-400">{formatBRL(Math.max(100, preview.finalChargeInCents ?? preview.targetPriceInCents))}</span></div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="upgrade-taxid" className="text-xs">CPF ou CNPJ do responsável pelo pagamento</Label>
                      <Input
                        id="upgrade-taxid"
                        placeholder="Somente números"
                        value={taxIdInput}
                        onChange={(e) => setTaxIdInput(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A nova mensalidade começa a contar a partir de hoje pelos próximos 30 dias.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Você está agendando o downgrade para <strong>{preview.targetPlanLabel}</strong>.
                    </p>
                    <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                        Seu plano atual fica ativo até <strong>{formatDateShort(preview.effectiveAt ?? expiresAt)}</strong>. Não há reembolso pelo período já pago. Após essa data, você passa para o plano {preview.targetPlanLabel} e os limites/quotas serão ajustados.
                      </AlertDescription>
                    </Alert>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={actionLoading}>Cancelar</Button>
            {preview?.changeType === "upgrade" ? (
              <Button onClick={confirmUpgrade} disabled={actionLoading || previewLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {actionLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                Gerar PIX
              </Button>
            ) : (
              <Button onClick={confirmDowngrade} disabled={actionLoading || previewLoading} className="bg-amber-600 hover:bg-amber-700 text-white">
                {actionLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ArrowDownCircle className="w-4 h-4 mr-2" />}
                Confirmar agendamento
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pixModal} onOpenChange={(o) => { if (!o) setPixModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pague o upgrade via PIX</DialogTitle>
            <DialogDescription>
              Após a confirmação do pagamento, seu plano é trocado automaticamente em segundos.
              {typeof pixModal?.finalChargeInCents === "number" && (
                <> Valor: <strong>{formatBRL(pixModal.finalChargeInCents)}</strong>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {pixModal?.paymentUrl ? (
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => window.open(pixModal.paymentUrl, "_blank")}>
                <Zap className="w-4 h-4 mr-2" />
                Abrir página de pagamento PIX
              </Button>
            ) : (
              <Alert>
                <AlertDescription>Cobrança gerada — verifique sua área de pagamentos.</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => { setPixModal(null); queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() }); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SubscriptionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [convRechargeOpen, setConvRechargeOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundEligibility, setRefundEligibility] = useState<{
    eligible: boolean;
    daysSinceReference?: number;
    daysRemaining?: number;
    referenceDate?: string;
    plan?: string;
    amountBrl?: string;
    reason?: string;
    hasOpenRequest?: boolean;
    existingRequestStatus?: string | null;
  } | null>(null);

  const openRefundDialog = async () => {
    setRefundLoading(true);
    setRefundReason("");
    setRefundEligibility(null);
    try {
      const res = await fetch(`${BASE}api/dental/refund/eligibility`, { credentials: "include" });
      const data = await res.json();
      setRefundEligibility(data);
      setRefundDialogOpen(true);
    } catch {
      toast({ title: "Erro", description: "Não foi possível verificar a elegibilidade.", variant: "destructive" });
    } finally {
      setRefundLoading(false);
    }
  };

  const submitRefund = async () => {
    setRefundLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/refund/request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonText: refundReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Não foi possível solicitar", description: data?.error || "Erro ao registrar solicitação.", variant: "destructive" });
      } else {
        toast({ title: "Solicitação enviada!", description: "Nossa equipe vai processar o reembolso em breve." });
        setRefundDialogOpen(false);
      }
    } catch {
      toast({ title: "Erro", description: "Erro ao enviar solicitação.", variant: "destructive" });
    } finally {
      setRefundLoading(false);
    }
  };

  const { data: sub, isLoading } = useGetSubscription();
  const { data: creditsRaw } = useGetAudioCredits();
  const { data: convQuotaRaw } = useGetConversationQuota();
  const credits = creditsRaw as AudioCredits | undefined;

  const cancelMutation = useCancelSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
        setCancelDialogOpen(false);
        toast({ title: "Assinatura cancelada", description: "Seu plano continua ativo até a data de vencimento." });
      },
      onError: () => {
        toast({ title: "Erro", description: "Não foi possível cancelar a assinatura.", variant: "destructive" });
      },
    },
  });
  const reactivateMutation = useReactivateSubscription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
        toast({ title: "Assinatura reativada!", description: "Seu plano foi reativado com sucesso." });
      },
      onError: () => {
        toast({ title: "Erro", description: "Não foi possível reativar a assinatura.", variant: "destructive" });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const isCancelled = sub?.subscriptionStatus === "cancelled";
  const subscribedAt = sub?.subscribedAt as string | null | undefined;
  const expiresAt = sub?.subscriptionExpiresAt as string | null | undefined;

  const monthlyQuota = credits?.monthlyQuota ?? MONTHLY_QUOTA_CHARS;
  const monthlyUsed = credits?.monthlyCharsUsed ?? 0;
  const monthlyRemaining = credits?.monthlyCharsRemaining ?? Math.max(0, monthlyQuota - monthlyUsed);
  const rechargeBalance = credits?.rechargeBalance ?? credits?.balance ?? 0;

  const monthlyUsedMin = charsToMinutes(monthlyUsed);
  const monthlyTotalMin = charsToMinutes(monthlyQuota);
  const monthlyRemainingMin = charsToMinutes(monthlyRemaining);
  const rechargeMin = charsToMinutes(rechargeBalance);

  const usagePercent = Math.min(100, Math.round((monthlyUsed / monthlyQuota) * 100));
  const isMonthlyEmpty = monthlyRemaining <= 0;
  const isAllEmpty = monthlyRemaining <= 0 && rechargeBalance <= 0;

  interface ConvQuota {
    monthlyConversationsUsed?: number;
    monthlyLimit?: number;
    monthlyRemaining?: number;
    rechargeBalance?: number;
    totalAvailable?: number;
    percentUsed?: number;
    isExhausted?: boolean;
    nextResetDate?: string | Date | null;
  }
  const convQuota = convQuotaRaw as ConvQuota | undefined;
  const convUsed = convQuota?.monthlyConversationsUsed ?? 0;
  const convLimit = convQuota?.monthlyLimit ?? 400;
  const convRemaining = convQuota?.monthlyRemaining ?? Math.max(0, convLimit - convUsed);
  const convRechargeBalance = convQuota?.rechargeBalance ?? 0;
  const convPercentUsed = convQuota?.percentUsed ?? Math.min(100, Math.round((convUsed / convLimit) * 100));
  const convIsExhausted = convQuota?.isExhausted ?? false;
  const convIsWarning = convPercentUsed >= 80 && !convIsExhausted;
  const convNextReset = convQuota?.nextResetDate ? new Date(convQuota.nextResetDate) : null;
  const convNextResetLabel = convNextReset
    ? convNextReset.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  const currentPlan = (sub?.plan ?? "essencial") as PlanId;
  const scheduledPlan = (sub as unknown as { scheduledPlan?: string | null })?.scheduledPlan ?? null;
  const scheduledPlanEffectiveAt = (sub as unknown as { scheduledPlanEffectiveAt?: string | null })?.scheduledPlanEffectiveAt ?? null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assinatura</h1>
          <p className="text-sm text-muted-foreground">Gerencie seu plano, conversas e minutos de áudio</p>
        </div>
      </div>

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-lg">Plano Atual</CardTitle>
            </div>
            <Badge className="text-sm px-3 py-1 font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {getPlanLabel(sub?.plan)}
            </Badge>
          </div>
          <CardDescription>
            {sub?.clinicName}
          </CardDescription>
          {getPlanPromoLabel(sub?.plan) && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
              <Tag className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <div>
                <span className="text-xs text-muted-foreground line-through mr-2">{getPlanOriginalPrice(sub?.plan)}/mês</span>
                <span className="text-xs font-bold text-amber-700 dark:text-amber-400">R$97,00/mês por 3 meses</span>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-white/60 dark:bg-zinc-800/40 border border-gray-100 dark:border-zinc-700/50">
              <Calendar className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground font-medium">Contratado em</p>
                <p className="text-sm font-semibold mt-0.5">{formatDate(subscribedAt)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-white/60 dark:bg-zinc-800/40 border border-gray-100 dark:border-zinc-700/50">
              <Shield className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground font-medium">Vencimento</p>
                <p className="text-sm font-semibold mt-0.5">{formatDate(expiresAt)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-white/60 dark:bg-zinc-800/40 border border-gray-100 dark:border-zinc-700/50">
              {isCancelled ? (
                <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-xs text-muted-foreground font-medium">Status</p>
                <p className={`text-sm font-semibold mt-0.5 ${isCancelled ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {isCancelled ? "Cancelado" : "Ativo"}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-800/30">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm shrink-0">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">{getMonthlyConversationsLabel(sub?.plan)}</p>
                <p className="text-xs text-muted-foreground">{EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-800/30">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm shrink-0">
                <Mic className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">30 min de áudio/mês inclusos</p>
                <p className="text-xs text-muted-foreground">27.000 créditos de voz renovados todo mês automaticamente</p>
              </div>
            </div>
          </div>

          {isCancelled && expiresAt && (
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                Sua assinatura foi cancelada, mas <strong>permanece válida até {formatDateShort(expiresAt)}</strong>.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <PlanChangeSection
        currentPlan={currentPlan}
        scheduledPlan={scheduledPlan}
        scheduledPlanEffectiveAt={scheduledPlanEffectiveAt}
        expiresAt={expiresAt}
      />

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Mic className="w-5 h-5 text-violet-500" />
            <CardTitle className="text-lg">Minutos de Áudio</CardTitle>
          </div>
          <CardDescription>Uso mensal incluído no plano + recargas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="p-5 rounded-xl bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border border-violet-100 dark:border-violet-800/30 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cota mensal</p>
                <p className="text-2xl font-bold text-violet-700 dark:text-violet-300 mt-0.5">
                  {monthlyUsedMin} <span className="text-base font-medium">de {monthlyTotalMin} min usados</span>
                </p>
              </div>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                isMonthlyEmpty
                  ? "bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/20"
                  : "bg-gradient-to-br from-violet-500 to-purple-600 shadow-violet-500/20"
              }`}>
                <Sparkles className="w-6 h-6 text-white" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Progress
                value={usagePercent}
                className="h-2.5"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{usagePercent}% utilizado</span>
                <span>{monthlyRemainingMin} min restantes</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Renovado automaticamente no início de cada mês. 1 minuto ≈ 1.000 caracteres de áudio.
            </p>
          </div>

          {rechargeBalance > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  +{rechargeMin} min extras disponíveis
                </p>
                <p className="text-xs text-muted-foreground">Créditos de recarga — usados após a cota mensal esgotar</p>
              </div>
            </div>
          )}

          {isAllEmpty && (
            <Alert className="border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 dark:text-red-300">
                <strong>Seus minutos acabaram</strong> — recarregue para continuar enviando respostas em áudio.
              </AlertDescription>
            </Alert>
          )}

          {isMonthlyEmpty && !isAllEmpty && (
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                Cota mensal esgotada — consumindo créditos de recarga.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-500" />
            <CardTitle className="text-lg">Recarregar Minutos</CardTitle>
          </div>
          <CardDescription>Minutos extras além dos 30 min incluídos no seu plano</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border-2 border-border p-4 text-center">
              <p className="font-bold text-sm text-muted-foreground">Básico</p>
              <p className="text-2xl font-bold mt-1">R$&nbsp;25</p>
              <p className="text-xs text-muted-foreground mt-1">+60 minutos de áudio</p>
            </div>
            <div className="relative rounded-xl border-2 border-violet-200 dark:border-violet-800 p-4 bg-violet-50/50 dark:bg-violet-950/10 text-center">
              <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                <Badge className="bg-violet-600 text-white text-[10px] px-2 py-0.5 shadow-sm">
                  <Star className="w-2.5 h-2.5 mr-1" />
                  Popular
                </Badge>
              </div>
              <p className="font-bold text-sm mt-1 text-muted-foreground">Padrão</p>
              <p className="text-2xl font-bold mt-1">R$&nbsp;40</p>
              <p className="text-xs text-muted-foreground mt-1">+2 horas de áudio</p>
            </div>
            <div className="rounded-xl border-2 border-border p-4 text-center">
              <p className="font-bold text-sm text-muted-foreground">Pro</p>
              <p className="text-2xl font-bold mt-1">R$&nbsp;90</p>
              <p className="text-xs text-muted-foreground mt-1">+5 horas de áudio</p>
            </div>
          </div>
          <Button
            onClick={() => setRechargeOpen(true)}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Zap className="w-4 h-4 mr-2" />
            Comprar Recarga via PIX
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Pagamento via PIX — créditos liberados em instantes após confirmação.
          </p>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-lg">Conversas de IA</CardTitle>
          </div>
          <CardDescription>Cota mensal de atendimentos automáticos pelo WhatsApp</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {(convIsWarning || convIsExhausted) && (
            <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
              convIsExhausted
                ? "bg-red-500/10 border-red-500/30"
                : "bg-amber-500/10 border-amber-500/30"
            }`}>
              <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${convIsExhausted ? "text-red-500" : "text-amber-500"}`} />
              <div>
                <p className={`text-sm font-bold ${convIsExhausted ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {convIsExhausted ? "Conversas esgotadas — IA pausada" : `80% das conversas utilizadas`}
                </p>
                <p className={`text-xs mt-0.5 ${convIsExhausted ? "text-red-500/80" : "text-amber-500/80"}`}>
                  {convIsExhausted
                    ? "Novos pacientes recebem a mensagem de encaminhamento. Recarregue para reativar a IA."
                    : `Restam apenas ${convRemaining} conversas este mês. Recarregue para não interromper o atendimento.`}
                </p>
              </div>
            </div>
          )}

          <div className="p-5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-100 dark:border-blue-800/30 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cota mensal</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">
                  {convUsed} <span className="text-base font-medium">de {convLimit} conversas</span>
                </p>
              </div>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                convIsExhausted
                  ? "bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/20"
                  : "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/20"
              }`}>
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="h-2.5 rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    convIsExhausted ? "bg-red-500" : convIsWarning ? "bg-amber-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${Math.min(100, convPercentUsed)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{convPercentUsed}% utilizado</span>
                <span>{convRemaining} conversas restantes</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>1 conversa = 1 contato único nas últimas 24h.</span>
              {convNextResetLabel && (
                <span className="font-medium">
                  Renova em {convNextResetLabel}
                </span>
              )}
            </div>
          </div>

          {convRechargeBalance > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  +{convRechargeBalance} conversas extras disponíveis
                </p>
                <p className="text-xs text-muted-foreground">Saldo de recarga — usado após a cota mensal esgotar</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg bg-gradient-to-br from-white to-gray-50/80 dark:from-zinc-900 dark:to-zinc-900/80">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">Recarregar Conversas</CardTitle>
          </div>
          <CardDescription>Conversas extras além das inclusas no seu plano</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-sm">Pacote Padrão</p>
                <p className="text-xs text-muted-foreground mt-0.5">400 conversas de IA extras</p>
                <p className="text-xs text-muted-foreground">1 conversa = 1 contato único em 24h</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">R$&nbsp;47</p>
                <p className="text-xs text-muted-foreground">via PIX</p>
              </div>
            </div>
          </div>
          <Button
            onClick={() => setConvRechargeOpen(true)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Zap className="w-4 h-4 mr-2" />
            Comprar Recarga via PIX
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Pagamento via PIX — conversas liberadas em instantes após confirmação.
          </p>
        </CardContent>
      </Card>

      <Separator />

      <Card className="border-0 shadow-md">
        <CardContent className="pt-6 space-y-3">
          {!isCancelled ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Cancelar assinatura</p>
                <p className="text-xs text-muted-foreground mt-1">Seu plano continuará ativo até o vencimento</p>
              </div>
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:hover:bg-red-950/30"
                onClick={() => setCancelDialogOpen(true)}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancelar Plano
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Reativar assinatura</p>
                <p className="text-xs text-muted-foreground mt-1">Retome o acesso completo ao seu plano</p>
              </div>
              <Button
                variant="outline"
                className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
                onClick={() => reactivateMutation.mutate()}
                disabled={reactivateMutation.isPending}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${reactivateMutation.isPending ? "animate-spin" : ""}`} />
                Reativar Plano
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-xl border bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/40 p-4">
        <div className="flex-1">
          <p className="font-medium text-sm flex items-center gap-2">
            <Undo2 className="w-4 h-4 text-amber-600" />
            Solicitar reembolso
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Direito de arrependimento (CDC art. 49) — disponível até 7 dias depois da assinatura.
          </p>
        </div>
        <Button
          variant="outline"
          className="text-amber-700 border-amber-300 hover:bg-amber-100/60 dark:text-amber-300 dark:border-amber-800"
          onClick={openRefundDialog}
          disabled={refundLoading}
        >
          <Undo2 className="w-4 h-4 mr-2" />
          Solicitar reembolso
        </Button>
      </div>

      <RechargeDialog open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
      <ConversationRechargeDialog open={convRechargeOpen} onClose={() => setConvRechargeOpen(false)} />

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Cancelar assinatura
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tem certeza que deseja cancelar sua assinatura do plano <strong>Premium</strong>?
                </p>
                {expiresAt && (
                  <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                      Seu plano permanecerá <strong>válido até {formatDateShort(expiresAt)}</strong>.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Manter plano</Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelando..." : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="w-5 h-5 text-amber-500" />
              Solicitar reembolso
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 space-y-3">
                {refundEligibility && (
                  <>
                    {refundEligibility.eligible ? (
                      <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800 dark:text-emerald-300 text-sm">
                          Você está dentro da janela de 7 dias (CDC art. 49). Restam <strong>{refundEligibility.daysRemaining} dia(s)</strong>.
                          {refundEligibility.amountBrl && <> Valor estimado: <strong>R$ {refundEligibility.amountBrl}</strong>.</>}
                        </AlertDescription>
                      </Alert>
                    ) : refundEligibility.hasOpenRequest ? (
                      <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/50">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                          Já existe uma solicitação em aberto (status: {refundEligibility.existingRequestStatus}). Aguarde nossa equipe processar.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40">
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                        <AlertDescription className="text-red-800 dark:text-red-300 text-sm">
                          Fora da janela de 7 dias. {refundEligibility.daysSinceReference !== undefined && <>Já se passaram <strong>{refundEligibility.daysSinceReference} dia(s)</strong> desde o início da assinatura.</>}{" "}
                          Você ainda pode enviar o pedido — nossa equipe vai analisar caso a caso.
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="refund-reason">Motivo (opcional)</Label>
                  <Input
                    id="refund-reason"
                    placeholder="Conte brevemente o motivo"
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRefundDialogOpen(false)} disabled={refundLoading}>Cancelar</Button>
            <Button
              onClick={submitRefund}
              disabled={refundLoading || refundEligibility?.hasOpenRequest}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {refundLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Undo2 className="w-4 h-4 mr-2" />}
              Enviar solicitação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
