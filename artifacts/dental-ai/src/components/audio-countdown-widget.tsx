import { useGetAudioCredits } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Volume2, AlertTriangle, Mic } from "lucide-react";

const CHARS_PER_MINUTE = 750;
const LOW_MINUTES_THRESHOLD = 5;

export interface AudioCreditData {
  totalAvailable?: number;
  monthlyCharsRemaining?: number;
  monthlyQuota?: number;
  balance?: number;
}

interface AudioCountdownWidgetProps {
  compact?: boolean;
  creditsData?: AudioCreditData;
}

export function AudioCountdownWidget({ compact = false, creditsData: externalCredits }: AudioCountdownWidgetProps) {
  const { data: fetchedData } = useGetAudioCredits({ query: { enabled: externalCredits === undefined } });
  const [, navigate] = useLocation();

  const credits = (externalCredits ?? fetchedData) as AudioCreditData | undefined;

  const totalChars = credits?.totalAvailable ?? 0;
  const monthlyQuota = credits?.monthlyQuota ?? 27000;
  const maxTotalChars = monthlyQuota + (credits?.balance ?? 0);
  const minutesRemaining = Math.floor(totalChars / CHARS_PER_MINUTE);
  const isLow = minutesRemaining <= LOW_MINUTES_THRESHOLD;
  const pct = maxTotalChars > 0 ? Math.min(100, Math.round((totalChars / maxTotalChars) * 100)) : 0;

  const barColor = isLow
    ? "bg-red-500"
    : pct > 50
    ? "bg-emerald-500"
    : "bg-amber-500";

  const formatTime = (mins: number) => {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}min` : `${h}h`;
    }
    return `${mins} min`;
  };

  if (compact) {
    return (
      <div className="space-y-2">
        {isLow && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-red-600 dark:text-red-400 leading-snug">
                Áudio quase esgotado — {formatTime(minutesRemaining)} restantes
              </p>
              <button
                onClick={() => navigate("/settings?tab=audio")}
                className="text-[10px] font-semibold text-red-500 hover:text-red-600 underline underline-offset-2 mt-0.5 transition-colors"
              >
                Recarregar agora →
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs mb-1">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Mic className="w-3 h-3 text-primary" />
            Áudio restante
          </span>
          <span className={`font-bold tabular-nums ${isLow ? "text-red-500" : "text-foreground"}`}>
            {formatTime(minutesRemaining)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isLow && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-red-600 dark:text-red-400 leading-snug">
              Créditos de áudio quase esgotados
            </p>
            <p className="text-[11px] text-red-500/80 mt-0.5">
              Restam apenas {formatTime(minutesRemaining)} de áudio. Recarregue para não interromper o atendimento.
            </p>
            <button
              onClick={() => navigate("/settings?tab=audio")}
              className="text-[11px] font-bold text-red-500 hover:text-red-600 underline underline-offset-2 mt-1.5 transition-colors"
            >
              Ir para Recargas →
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Volume2 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground">Tempo de Áudio Restante</p>
            <p className="text-[10px] text-muted-foreground/60">Cota mensal + saldo de recarga</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[22px] font-extrabold tracking-tighter number-display leading-none ${isLow ? "text-red-500" : ""}`}>
            {formatTime(minutesRemaining)}
          </p>
          <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mt-0.5">
            estimado
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground/50">{pct}% disponível</p>
          <p className="text-[10px] text-muted-foreground/50 tabular-nums">
            {(totalChars).toLocaleString("pt-BR")} chars
          </p>
        </div>
      </div>
    </div>
  );
}
