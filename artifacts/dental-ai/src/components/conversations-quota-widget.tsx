import { useGetConversationQuota } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { MessageSquare, AlertTriangle } from "lucide-react";

export interface ConversationQuotaData {
  monthlyConversationsUsed?: number;
  monthlyLimit?: number;
  monthlyRemaining?: number;
  rechargeBalance?: number;
  totalAvailable?: number;
  percentUsed?: number;
  isExhausted?: boolean;
}

interface ConversationsQuotaWidgetProps {
  compact?: boolean;
  quotaData?: ConversationQuotaData;
}

export function ConversationsQuotaWidget({ compact = false, quotaData: externalData }: ConversationsQuotaWidgetProps) {
  const { data: fetchedData } = useGetConversationQuota({ query: { enabled: externalData === undefined } });
  const [, navigate] = useLocation();

  const quota = (externalData ?? fetchedData) as ConversationQuotaData | undefined;

  const used = quota?.monthlyConversationsUsed ?? 0;
  const limit = quota?.monthlyLimit ?? 400;
  const rechargeBalance = quota?.rechargeBalance ?? 0;
  const isExhausted = quota?.isExhausted ?? false;
  const percentUsed = quota?.percentUsed ?? (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  const remaining = quota?.monthlyRemaining ?? Math.max(0, limit - used);

  const isWarning = percentUsed >= 80 && !isExhausted;
  const barColor = isExhausted
    ? "bg-red-500"
    : isWarning
    ? "bg-amber-500"
    : "bg-emerald-500";

  if (compact) {
    return (
      <div className="space-y-2">
        {(isWarning || isExhausted) && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border ${
            isExhausted
              ? "bg-red-500/10 border-red-500/30"
              : "bg-amber-500/10 border-amber-500/30"
          }`}>
            <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isExhausted ? "text-red-500" : "text-amber-500"}`} />
            <div className="min-w-0">
              <p className={`text-[11px] font-bold leading-snug ${isExhausted ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                {isExhausted
                  ? "Conversas esgotadas — IA pausada"
                  : `Conversas quase no limite — ${remaining} restantes`}
              </p>
              <button
                onClick={() => navigate("/subscription")}
                className={`text-[10px] font-semibold underline underline-offset-2 mt-0.5 transition-colors ${isExhausted ? "text-red-500 hover:text-red-600" : "text-amber-500 hover:text-amber-600"}`}
              >
                Recarregar agora →
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs mb-1">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <MessageSquare className="w-3 h-3 text-primary" />
            Conversas restantes
          </span>
          <span className={`font-bold tabular-nums ${isExhausted ? "text-red-500" : isWarning ? "text-amber-500" : "text-foreground"}`}>
            {remaining}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.max(2, 100 - percentUsed)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(isWarning || isExhausted) && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
          isExhausted
            ? "bg-red-500/10 border-red-500/30"
            : "bg-amber-500/10 border-amber-500/30"
        }`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isExhausted ? "bg-red-500/15" : "bg-amber-500/15"
          }`}>
            <AlertTriangle className={`w-4 h-4 ${isExhausted ? "text-red-500" : "text-amber-500"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[13px] font-bold leading-snug ${isExhausted ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
              {isExhausted ? "Conversas de IA esgotadas" : "80% das conversas usadas"}
            </p>
            <p className={`text-[11px] mt-0.5 ${isExhausted ? "text-red-500/80" : "text-amber-500/80"}`}>
              {isExhausted
                ? "A IA está pausada para novos pacientes. Recarregue para reativar."
                : `Restam apenas ${remaining} conversas. Recarregue para não interromper o atendimento.`}
            </p>
            <button
              onClick={() => navigate("/subscription")}
              className={`text-[11px] font-bold underline underline-offset-2 mt-1.5 transition-colors ${isExhausted ? "text-red-500 hover:text-red-600" : "text-amber-500 hover:text-amber-600"}`}
            >
              Ir para Recargas →
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground">Conversas de IA Restantes</p>
            <p className="text-[10px] text-muted-foreground/60">Cota mensal + saldo de recarga</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[22px] font-extrabold tracking-tighter number-display leading-none ${isExhausted ? "text-red-500" : isWarning ? "text-amber-500" : ""}`}>
            {remaining + rechargeBalance}
          </p>
          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mt-0.5">
            disponíveis
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.max(2, 100 - percentUsed)}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground/50">{percentUsed}% utilizado</p>
          <p className="text-[10px] text-muted-foreground/50 tabular-nums">
            {used} de {limit} conversas/mês
          </p>
        </div>
      </div>
    </div>
  );
}
