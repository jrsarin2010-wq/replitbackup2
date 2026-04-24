/**
 * Task #15 — Card de dashboard com agendamentos não confirmados para amanhã.
 *
 * Lê `/api/dental/activity/unconfirmed-alert/latest` e exibe se houver
 * alerta nas últimas 36h. Botão "Tratado" registra que o dentista
 * processou as confirmações (proteção jurídica).
 */

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AlertItem {
  appointmentId: number;
  patientName: string;
  professionalName: string | null;
  startsAtLocal: string;
  contactPhone: string | null;
}

interface AlertPayload {
  id: number;
  createdAt: string;
  targetDate: string;
  itemCount: number;
  items: AlertItem[];
  handled: boolean;
}

const API_BASE = `${import.meta.env.BASE_URL}api/dental/activity`;

export function UnconfirmedAlertCard() {
  const [alert, setAlert] = useState<AlertPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/unconfirmed-alert/latest`);
      if (!r.ok) return;
      const data = (await r.json()) as { alert: AlertPayload | null };
      setAlert(data.alert);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAck() {
    if (!alert) return;
    setAcking(true);
    try {
      const r = await fetch(`${API_BASE}/unconfirmed-alert/${alert.id}/handle`, { method: "POST" });
      if (!r.ok) throw new Error("fail");
      toast({ title: "Marcado como tratado", description: "Registrado para auditoria." });
      await load();
    } catch {
      toast({ title: "Erro", description: "Não foi possível marcar como tratado.", variant: "destructive" });
    } finally {
      setAcking(false);
    }
  }

  if (loading) return null;
  if (!alert || alert.itemCount === 0) return null;

  return (
    <Card
      className={`mb-6 border-2 ${alert.handled ? "border-emerald-500/40" : "border-amber-500/60"}`}
      data-testid="card-unconfirmed-alert"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {alert.handled ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          )}
          Agendamentos não confirmados — amanhã ({alert.targetDate})
          <Badge variant={alert.handled ? "secondary" : "destructive"} className="ml-auto">
            {alert.itemCount} pendente{alert.itemCount === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          A IA não conseguiu confirmar estes pacientes. Ligue ou envie WhatsApp manualmente
          para evitar faltas. Marque como tratado depois de processar.
        </p>
        <div className="max-h-64 overflow-y-auto divide-y divide-border/50 border border-border rounded-md mb-4">
          {alert.items.slice(0, 50).map((it) => (
            <div
              key={it.appointmentId}
              className="px-3 py-2 text-sm flex items-center justify-between"
              data-testid={`row-unconfirmed-${it.appointmentId}`}
            >
              <div>
                <div className="font-medium">{it.patientName}</div>
                <div className="text-xs text-muted-foreground">
                  {it.professionalName ? `${it.professionalName} • ` : ""}
                  {it.contactPhone ?? "(sem telefone)"}
                </div>
              </div>
              <div className="font-mono text-sm">{it.startsAtLocal}</div>
            </div>
          ))}
          {alert.items.length > 50 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              …e mais {alert.items.length - 50} agendamento(s).
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={alert.handled || acking}
            onClick={handleAck}
            data-testid="button-mark-alert-handled"
          >
            {acking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {alert.handled ? "Já tratado" : "Marcar como tratado"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default UnconfirmedAlertCard;
