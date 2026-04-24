import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getTenantPlan } from "@/lib/api-config";

export type SimulatedPlan = "basic" | "essencial" | "pro" | null;
export type ActiveSimulatedPlan = Exclude<SimulatedPlan, null>;

interface SimulatorContextValue {
  simulatedPlan: SimulatedPlan;
  isSimulating: boolean;
  activePlan: string | null;
  startSimulation: (plan: ActiveSimulatedPlan) => void;
  stopSimulation: () => void;
}

const SimulatorContext = createContext<SimulatorContextValue | null>(null);
const STORAGE_KEY = "simulatedPlan";

function readStoredPlan(): SimulatedPlan {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "basic" || v === "essencial" || v === "pro") return v;
  } catch {}
  return null;
}

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const [simulatedPlan, setSimulatedPlan] = useState<SimulatedPlan>(() => readStoredPlan());

  useEffect(() => {
    try {
      if (simulatedPlan) window.localStorage.setItem(STORAGE_KEY, simulatedPlan);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [simulatedPlan]);

  const isSimulating = simulatedPlan !== null;

  const activePlan = isSimulating ? simulatedPlan : getTenantPlan();

  function startSimulation(plan: ActiveSimulatedPlan) {
    setSimulatedPlan(plan);
  }

  function stopSimulation() {
    setSimulatedPlan(null);
  }

  return (
    <SimulatorContext.Provider value={{ simulatedPlan, isSimulating, activePlan, startSimulation, stopSimulation }}>
      {children}
    </SimulatorContext.Provider>
  );
}

export function useSimulator(): SimulatorContextValue {
  const ctx = useContext(SimulatorContext);
  if (!ctx) throw new Error("useSimulator must be used within SimulatorProvider");
  return ctx;
}

export function useActivePlan(): string | null {
  const ctx = useContext(SimulatorContext);
  if (!ctx) return getTenantPlan();
  return ctx.activePlan;
}
