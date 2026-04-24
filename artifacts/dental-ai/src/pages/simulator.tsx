import { CheckCircle2, XCircle, Zap, Crown, Star } from "lucide-react";
import { useSimulator, SimulatedPlan, ActiveSimulatedPlan } from "@/contexts/simulator-context";
import { Button } from "@/components/ui/button";
import {
  getMonthlyConversationsLabel,
  EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE,
  CONVERSATION_RECHARGE_NOTE,
} from "@/lib/plan-features";

type PlanFeatureItem = { text: string; included: boolean; highlight?: boolean };

const simulatorPlans: Array<{
  id: ActiveSimulatedPlan;
  name: string;
  label: string;
  price: string;
  originalPrice?: string;
  priceNote: string;
  promoLabel?: string;
  desc: string;
  badge: string;
  badgeColor: string;
  cardColor: string;
  popular?: boolean;
  features: PlanFeatureItem[];
}> = [
  {
    id: "basic",
    name: "Básico",
    label: "OdontoFlow Básico",
    price: "R$ 97",
    originalPrice: "R$197",
    priceNote: "/mês",
    promoLabel: "Promoção válida por 3 meses — após isso, R$197/mês",
    desc: "Oferta especial: R$197 por R$97/mês nos primeiros 3 meses.",
    badge: "BÁSICO",
    badgeColor: "from-emerald-500 to-teal-600",
    cardColor: "border-emerald-500/30",
    features: [
      { text: getMonthlyConversationsLabel("basic"), included: true, highlight: true },
      { text: "Apenas o profissional titular (1 agenda)", included: true, highlight: true },
      { text: "IA no WhatsApp 24h com respostas humanizadas", included: true },
      { text: "Agendamento inteligente", included: true },
      { text: "Confirmação automática de consulta", included: true },
      { text: "Lembretes antes da consulta para pacientes", included: true },
      { text: "Mensagem de aniversário para pacientes", included: true },
      { text: "Bloqueio de agenda (férias e feriados)", included: true },
      { text: "Gestão de Conversas", included: true },
      { text: "Suporte e Tutor IA", included: true },
      { text: "Notificações Telegram", included: true },
      { text: "IA aprende com as conversas para melhorar conversão", included: true },
      { text: "21 técnicas de venda com IA", included: false },
      { text: "CRM de Leads", included: false },
      { text: "Recuperação de Pacientes", included: false },
      { text: "Áudio humanizado", included: false },
      { text: "Relatórios", included: false },
      { text: "Financeiro", included: false },
      { text: "Ligações IA", included: false },
    ],
  },
  {
    id: "essencial",
    name: "Essencial",
    label: "OdontoFlow Essencial",
    price: "R$ 197",
    originalPrice: "R$297",
    priceNote: "/mês",
    desc: "Oferta especial: R$297 por R$197/mês nos primeiros 3 meses.",
    badge: "ESSENCIAL",
    badgeColor: "from-teal-600 to-emerald-600",
    cardColor: "border-teal-500/40",
    promoLabel: "Promoção válida por 3 meses — após isso, R$297/mês",
    features: [
      { text: getMonthlyConversationsLabel("essencial"), included: true, highlight: true },
      { text: "Apenas o profissional titular (1 agenda)", included: true, highlight: true },
      { text: "Tudo do Básico", included: true, highlight: true },
      { text: "Notificações Telegram", included: true },
      { text: "Automação de pós-consulta", included: true },
      { text: "21 técnicas de venda com IA", included: true },
      { text: "CRM de Leads", included: true },
      { text: "Remarketing de Leads", included: true },
      { text: "Áudio humanizado (30 min inclusos)", included: true },
      { text: "Controle de Risco (proteção anti-banimento WhatsApp)", included: true },
      { text: "Recuperação de Pacientes", included: false },
      { text: "Relatórios", included: false },
      { text: "Financeiro", included: false },
      { text: "Ligações IA", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    label: "OdontoFlow Pro",
    price: "R$ 447",
    priceNote: "/mês",
    desc: "Tudo do Essencial + funcionalidades premium exclusivas.",
    badge: "PRO",
    badgeColor: "from-violet-600 to-fuchsia-600",
    cardColor: "border-violet-500/40",
    popular: true,
    features: [
      { text: getMonthlyConversationsLabel("pro"), included: true, highlight: true },
      { text: "Titular + 1 profissional extra incluso — adicione +1 por R$97/mês", included: true, highlight: true },
      { text: "Tudo do Essencial", included: true, highlight: true },
      { text: "Recuperação de Pacientes", included: true, highlight: true },
      { text: "Relatórios completos", included: true, highlight: true },
      { text: "Financeiro Completo", included: true, highlight: true },
      { text: "Áudio Humanizado (60 min incluso)", included: true, highlight: true },
      { text: "Ligação IA com Voz Natural (em breve)", included: false, highlight: false },
    ],
  },
];

function planIcon(id: SimulatedPlan) {
  if (id === "basic") return <Star className="w-4 h-4" />;
  if (id === "essencial") return <Zap className="w-4 h-4" />;
  return <Crown className="w-4 h-4" />;
}

export default function SimulatorPage() {
  const { simulatedPlan, startSimulation, stopSimulation } = useSimulator();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Simulador de Planos</h1>
        <p className="text-sm text-muted-foreground">
          Selecione um plano para ver como a interface se comporta para cada nível de acesso. A simulação é 100% local e não altera nenhum dado real.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {simulatorPlans.map((plan) => {
          const isActive = simulatedPlan === plan.id;
          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl border bg-card transition-all duration-200 overflow-hidden ${plan.cardColor} ${
                isActive ? "ring-2 ring-primary shadow-lg shadow-primary/10" : "hover:border-primary/30"
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-bl-xl tracking-wider">
                  MAIS POPULAR
                </div>
              )}

              <div className="p-5">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold text-white bg-gradient-to-r ${plan.badgeColor} mb-3`}>
                  {planIcon(plan.id)}
                  {plan.badge}
                </div>

                <h2 className="text-lg font-bold text-foreground mb-0.5">{plan.name}</h2>
                <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">{plan.desc}</p>

                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    {plan.originalPrice && (
                      <span className="text-sm text-muted-foreground/60 line-through mr-1">{plan.originalPrice}</span>
                    )}
                    <span className="text-2xl font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-xs text-muted-foreground">{plan.priceNote}</span>
                  </div>
                  {plan.promoLabel && (
                    <p className="text-[10px] text-emerald-500 font-medium mt-0.5">{plan.promoLabel}</p>
                  )}
                </div>

                <Button
                  className={`w-full text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-primary/10 text-foreground hover:text-primary"
                  }`}
                  onClick={() => isActive ? stopSimulation() : startSimulation(plan.id)}
                >
                  {isActive ? "✓ Simulando este plano" : `Simular Plano ${plan.name}`}
                </Button>
              </div>

              <div className="border-t border-border/40 px-5 py-4 space-y-2.5">
                {plan.features.map((feat, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    {feat.included ? (
                      <CheckCircle2 className={`w-4 h-4 flex-shrink-0 mt-0.5 ${feat.highlight ? "text-primary" : "text-emerald-500"}`} />
                    ) : (
                      <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground/30" />
                    )}
                    <span className={`text-[12px] leading-relaxed ${
                      !feat.included
                        ? "text-muted-foreground/40 line-through"
                        : feat.highlight
                          ? "text-foreground font-semibold"
                          : "text-foreground/80"
                    }`}>
                      {feat.text}
                    </span>
                  </div>
                ))}
                <div className="mt-3 pt-3 border-t border-border/40 space-y-1">
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {CONVERSATION_RECHARGE_NOTE}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground/50 text-center">
        ℹ️ A simulação é apenas visual e local. Nenhuma alteração é feita no banco de dados ou na assinatura real.
      </p>
    </div>
  );
}
