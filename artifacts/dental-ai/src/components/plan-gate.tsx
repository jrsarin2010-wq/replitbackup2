import { Link } from "wouter";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSimulator } from "@/contexts/simulator-context";
import { getPlanFeatures } from "@/lib/plan-features";

interface PlanGateProps {
  feature: keyof ReturnType<typeof getPlanFeatures>;
  children: React.ReactNode;
  featureLabel?: string;
  requiredPlan?: string;
}

export default function PlanGate({ feature, children, featureLabel, requiredPlan = "Essencial" }: PlanGateProps) {
  const { activePlan } = useSimulator();
  const features = getPlanFeatures(activePlan);

  if (features[feature]) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-5">
        <Lock className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-2">
        {featureLabel ? `${featureLabel} não disponível` : "Recurso bloqueado"}
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm leading-relaxed">
        Este recurso está disponível a partir do plano <strong>{requiredPlan}</strong>.
        Faça upgrade para desbloquear.
      </p>
      <Link href="/subscription">
        <Button className="gap-2">
          Ver planos
        </Button>
      </Link>
    </div>
  );
}
