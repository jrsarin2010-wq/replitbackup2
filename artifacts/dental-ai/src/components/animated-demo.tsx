import { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  CalendarDays,
  Target,
  BarChart3,
  Phone,
  Flame,
  Thermometer,
  Snowflake,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Zap,
  Users,
  DollarSign,
  TrendingUp,
  Activity,
} from "lucide-react";

const SCENE_DURATION = 8500;
const TRANSITION_DURATION = 600;
const TOTAL_SCENES = 4;

function useAnimatedValue(start: number, end: number, duration: number, trigger: boolean) {
  const [value, setValue] = useState(start);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!trigger) { setValue(start); return; }
    let startTime: number | null = null;
    const raf = (ts: number) => {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(raf);
      }
    };
    rafRef.current = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(rafRef.current);
  }, [trigger, start, end, duration]);
  return value;
}

function SceneWhatsApp({ active }: { active: boolean }) {
  const [visibleMessages, setVisibleMessages] = useState(0);

  const messages = [
    { from: "patient", text: "Olá! Gostaria de agendar uma limpeza 😊", time: "14:32" },
    { from: "ai", text: "Oi, Maria! 😄 Tenho horários amanhã às 9h, 14h ou 16h. Qual prefere?", time: "14:32" },
    { from: "patient", text: "14h seria ótimo!", time: "14:33" },
    { from: "ai", text: "✅ Agendado! Limpeza amanhã, 14h, com Dr. Rafael. Enviarei lembrete 1h antes!", time: "14:33" },
  ];

  useEffect(() => {
    if (!active) { setVisibleMessages(0); return; }
    setVisibleMessages(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const delays = [600, 1800, 3200, 4600];
    delays.forEach((delay, i) => {
      timers.push(setTimeout(() => setVisibleMessages(i + 1), delay));
    });
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return (
    <div className="w-full h-full flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10">
          <div className="bg-emerald-600 px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[11px] font-bold">OF</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[13px] font-semibold">OdontoFlow IA</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                <p className="text-emerald-100 text-[10px]">online agora</p>
              </div>
            </div>
            <Phone className="w-4 h-4 text-white/60" />
          </div>

          <div className="p-3 space-y-2.5 min-h-[240px] bg-[#e5ddd5] dark:bg-[#0b141a]">
            {messages.slice(0, visibleMessages).map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.from === "patient" ? "justify-end" : "justify-start"}`}
                style={{ animation: "msgFadeIn 0.3s ease-out" }}
              >
                <div
                  className={`max-w-[82%] rounded-lg px-3 py-2 shadow-sm ${
                    msg.from === "patient"
                      ? "bg-[#dcf8c6] dark:bg-emerald-800 text-gray-800 dark:text-gray-100"
                      : "bg-white dark:bg-[#1f2c34] text-gray-800 dark:text-gray-100"
                  }`}
                >
                  <p className="text-[12px] leading-relaxed">{msg.text}</p>
                  <p className="text-[9px] mt-1 text-right text-gray-400">{msg.time}</p>
                </div>
              </div>
            ))}

            {active && visibleMessages < messages.length && visibleMessages > 0 && (
              <div className="flex justify-start" style={{ animation: "msgFadeIn 0.3s ease-out" }}>
                <div className="bg-white dark:bg-[#1f2c34] rounded-lg px-4 py-2.5 shadow-sm">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((delay, i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] px-3 py-2 flex items-center gap-2 border-t border-black/5 dark:border-white/5">
            <div className="flex-1 bg-white dark:bg-[#2a3942] rounded-full px-3 py-1.5">
              <p className="text-[11px] text-gray-400">Mensagem</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 px-2 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Zap className="w-3.5 h-3.5 text-emerald-500" />
          <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            IA respondeu em menos de 3 segundos
          </p>
        </div>
      </div>
    </div>
  );
}

function SceneDashboard({ active }: { active: boolean }) {
  const appointments = useAnimatedValue(0, 24, 1800, active);
  const patients = useAnimatedValue(0, 312, 2000, active);
  const revenue = useAnimatedValue(0, 18400, 2200, active);
  const conversion = useAnimatedValue(0, 78, 1600, active);

  const barHeights = [45, 72, 55, 88, 60, 95, 82];
  const barLabels = ["S", "T", "Q", "Q", "S", "S", "D"];

  return (
    <div className="w-full h-full flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-[16px] font-bold">Dashboard</p>
            <p className="text-[11px] text-muted-foreground/60">Clínica Dr. Rafael</p>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Ao vivo</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: CalendarDays, label: "Consultas Hoje", value: appointments, color: "text-primary", bg: "bg-primary/10", suffix: "" },
            { icon: Users, label: "Total Pacientes", value: patients, color: "text-sky-500", bg: "bg-sky-500/10", suffix: "" },
            { icon: DollarSign, label: "Receita Mensal", value: `R$ ${revenue.toLocaleString("pt-BR")}`, color: "text-emerald-500", bg: "bg-emerald-500/10", suffix: "" },
            { icon: TrendingUp, label: "Taxa de Conversão", value: conversion, color: "text-amber-500", bg: "bg-amber-500/10", suffix: "%" },
          ].map((card, i) => (
            <div
              key={i}
              className="rounded-xl p-3 border border-border/40 bg-card/80 backdrop-blur-sm"
              style={{ animation: active ? `fadeSlideUp 0.4s ease-out ${i * 100}ms both` : "none" }}
            >
              <div className={`w-7 h-7 rounded-lg ${card.bg} flex items-center justify-center mb-2`}>
                <card.icon className={`w-3.5 h-3.5 ${card.color}`} />
              </div>
              <p className="text-[18px] font-extrabold tracking-tight leading-none">
                {typeof card.value === "number" ? `${card.value}${card.suffix}` : card.value}
              </p>
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">{card.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-3 border border-border/40 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              <p className="text-[11px] font-bold">Consultas — Últimos 7 dias</p>
            </div>
            <span className="text-[10px] font-semibold text-emerald-500 flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3" /> +18%
            </span>
          </div>
          <div className="flex items-end gap-1.5 h-16">
            {barHeights.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-sm bg-primary/70 transition-all duration-700"
                  style={{
                    height: active ? `${h}%` : "0%",
                    transitionDelay: `${i * 80}ms`,
                    opacity: h === 95 ? 1 : 0.65,
                    background: h === 95 ? "hsl(var(--primary))" : undefined,
                  }}
                />
                <p className="text-[8px] text-muted-foreground/50">{barLabels[i]}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneAgenda({ active }: { active: boolean }) {
  const appointments = [
    { time: "08:30", name: "Ana Ribeiro", procedure: "Limpeza", status: "completed" },
    { time: "09:30", name: "Carlos Mendes", procedure: "Clareamento", status: "completed" },
    { time: "11:00", name: "Fernanda Lima", procedure: "Canal", status: "in_progress" },
    { time: "14:00", name: "Roberto Alves", procedure: "Extração", status: "scheduled" },
    { time: "15:30", name: "Patricia Costa", procedure: "Implante", status: "scheduled" },
    { time: "17:00", name: "Lucas Santos", procedure: "Bruxismo", status: "scheduled" },
  ];

  return (
    <div className="w-full h-full flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[16px] font-bold">Agenda de Hoje</p>
            <p className="text-[11px] text-muted-foreground/60">Quinta-feira, 10 de Abril</p>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-[11px] font-bold text-primary">6 consultas</p>
          </div>
        </div>

        <div className="space-y-1.5">
          {appointments.map((apt, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300 ${
                apt.status === "in_progress"
                  ? "bg-primary/5 border-primary/25 ring-1 ring-primary/15"
                  : apt.status === "completed"
                  ? "bg-muted/20 border-border/20 opacity-60"
                  : "bg-card/80 border-border/30"
              }`}
              style={{ animation: active ? `fadeSlideUp 0.4s ease-out ${i * 80}ms both` : "none" }}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  apt.status === "completed"
                    ? "bg-emerald-500/10"
                    : apt.status === "in_progress"
                    ? "bg-primary/15"
                    : "bg-muted/50"
                }`}
              >
                {apt.status === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : apt.status === "in_progress" ? (
                  <Activity className="w-4 h-4 text-primary animate-pulse" />
                ) : (
                  <Clock className="w-4 h-4 text-muted-foreground/50" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate">{apt.name}</p>
                <p className="text-[10px] text-muted-foreground/60">{apt.procedure}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[13px] font-bold tabular-nums">{apt.time}</p>
                {apt.status === "in_progress" && (
                  <p className="text-[9px] font-bold text-primary">Em andamento</p>
                )}
                {apt.status === "scheduled" && (
                  <p className="text-[9px] text-muted-foreground/50">Agendado</p>
                )}
                {apt.status === "completed" && (
                  <p className="text-[9px] text-emerald-600 dark:text-emerald-400">Realizado</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <Zap className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
            IA enviou lembretes para 4 pacientes de hoje
          </p>
        </div>
      </div>
    </div>
  );
}

function SceneCRM({ active }: { active: boolean }) {
  const leads = [
    { name: "Beatriz Souza", source: "Meta Ads", temperature: "hot", interest: "Clareamento", score: 92, time: "2min" },
    { name: "Thiago Ferreira", source: "Google Ads", temperature: "warm", interest: "Implante", score: 67, time: "18min" },
    { name: "Juliana Neves", source: "Meta Ads", temperature: "hot", interest: "Ortodontia", score: 88, time: "45min" },
    { name: "Rafael Costa", source: "Instagram", temperature: "cold", interest: "Consulta", score: 31, time: "2h" },
    { name: "Amanda Rocha", source: "Meta Ads", temperature: "warm", interest: "Limpeza", score: 54, time: "3h" },
  ];

  const tempConfig = {
    hot: { icon: Flame, color: "text-red-500", bg: "bg-red-500/10", label: "Quente", border: "border-red-500/20" },
    warm: { icon: Thermometer, color: "text-amber-500", bg: "bg-amber-500/10", label: "Morno", border: "border-amber-500/20" },
    cold: { icon: Snowflake, color: "text-sky-500", bg: "bg-sky-500/10", label: "Frio", border: "border-sky-500/20" },
  };

  const hotCount = leads.filter((l) => l.temperature === "hot").length;
  const warmCount = leads.filter((l) => l.temperature === "warm").length;
  const coldCount = leads.filter((l) => l.temperature === "cold").length;

  return (
    <div className="w-full h-full flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[16px] font-bold">CRM de Leads</p>
            <p className="text-[11px] text-muted-foreground/60">Classificação por IA em tempo real</p>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Target className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-bold text-primary">{leads.length} leads</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { ...tempConfig.hot, count: hotCount },
            { ...tempConfig.warm, count: warmCount },
            { ...tempConfig.cold, count: coldCount },
          ].map((item, i) => (
            <div
              key={i}
              className={`rounded-xl p-2.5 border ${item.border} ${item.bg} text-center`}
              style={{ animation: active ? `fadeSlideUp 0.4s ease-out ${i * 80}ms both` : "none" }}
            >
              <item.icon className={`w-4 h-4 ${item.color} mx-auto mb-1`} />
              <p className="text-[18px] font-extrabold leading-none">{item.count}</p>
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          {leads.map((lead, i) => {
            const temp = tempConfig[lead.temperature as keyof typeof tempConfig];
            const TempIcon = temp.icon;
            return (
              <div
                key={i}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border/30 bg-card/80 backdrop-blur-sm"
                style={{ animation: active ? `fadeSlideUp 0.4s ease-out ${i * 70 + 200}ms both` : "none" }}
              >
                <div className={`w-7 h-7 rounded-lg ${temp.bg} flex items-center justify-center flex-shrink-0`}>
                  <TempIcon className={`w-3.5 h-3.5 ${temp.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{lead.name}</p>
                  <p className="text-[10px] text-muted-foreground/60">{lead.interest} · {lead.source}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${
                          lead.score >= 75 ? "bg-red-500" : lead.score >= 50 ? "bg-amber-500" : "bg-sky-500"
                        }`}
                        style={{ width: active ? `${lead.score}%` : "0%", transitionDelay: `${i * 100 + 400}ms` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold tabular-nums">{lead.score}</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground/40 mt-0.5">{lead.time} atrás</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const sceneConfig = [
  {
    id: 0,
    label: "WhatsApp IA",
    icon: MessageSquare,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    activeBg: "bg-emerald-500",
    title: "Atendimento 24h no WhatsApp",
    subtitle: "IA responde, agenda e confirma sozinha",
  },
  {
    id: 1,
    label: "Dashboard",
    icon: BarChart3,
    color: "text-sky-500",
    bg: "bg-sky-500/10",
    activeBg: "bg-sky-500",
    title: "Dashboard com métricas em tempo real",
    subtitle: "Visão completa da performance da clínica",
  },
  {
    id: 2,
    label: "Agenda",
    icon: CalendarDays,
    color: "text-primary",
    bg: "bg-primary/10",
    activeBg: "bg-primary",
    title: "Agenda inteligente do dia",
    subtitle: "Consultas organizadas com lembretes automáticos",
  },
  {
    id: 3,
    label: "CRM Leads",
    icon: Target,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    activeBg: "bg-orange-500",
    title: "CRM com classificação de temperatura",
    subtitle: "IA classifica leads por prioridade de conversão",
  },
];

export default function AnimatedDemo() {
  const [currentScene, setCurrentScene] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const sceneRef = useRef(currentScene);
  const pausedRef = useRef(isPaused);
  sceneRef.current = currentScene;
  pausedRef.current = isPaused;

  useEffect(() => {
    let startTime: number | null = null;
    let rafId: number;

    const tick = (ts: number) => {
      if (!startTime) startTime = ts;
      if (pausedRef.current) {
        startTime = ts - progress * SCENE_DURATION;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const elapsed = ts - startTime;
      const pct = Math.min(elapsed / SCENE_DURATION, 1);
      setProgress(pct);

      if (pct >= 1) {
        setTransitioning(true);
        setTimeout(() => {
          setCurrentScene((s) => (s + 1) % TOTAL_SCENES);
          setProgress(0);
          startTime = null;
          setTransitioning(false);
        }, TRANSITION_DURATION);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [currentScene]);

  const scene = sceneConfig[currentScene];

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-border/30 bg-background shadow-2xl shadow-primary/5"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-card/80 backdrop-blur-sm border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg ${scene.bg} flex items-center justify-center`}>
            <scene.icon className={`w-3.5 h-3.5 ${scene.color}`} />
          </div>
          <div>
            <p className="text-[12px] font-bold leading-tight">{scene.title}</p>
            <p className="text-[10px] text-muted-foreground/60">{scene.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {sceneConfig.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                if (s.id !== currentScene) {
                  setTransitioning(true);
                  setTimeout(() => {
                    setCurrentScene(s.id);
                    setProgress(0);
                    setTransitioning(false);
                  }, TRANSITION_DURATION);
                }
              }}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                s.id === currentScene ? `w-4 ${s.activeBg}` : "bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>
      </div>

      <div
        className="relative min-h-[440px] sm:min-h-[480px] transition-opacity duration-500"
        style={{ opacity: transitioning ? 0 : 1 }}
      >
        {currentScene === 0 && <SceneWhatsApp active={!transitioning} />}
        {currentScene === 1 && <SceneDashboard active={!transitioning} />}
        {currentScene === 2 && <SceneAgenda active={!transitioning} />}
        {currentScene === 3 && <SceneCRM active={!transitioning} />}
      </div>

      <div className="px-4 py-3 bg-card/50 backdrop-blur-sm border-t border-border/20">
        <div className="flex items-center gap-3 mb-2">
          {sceneConfig.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                if (s.id !== currentScene) {
                  setTransitioning(true);
                  setTimeout(() => {
                    setCurrentScene(s.id);
                    setProgress(0);
                    setTransitioning(false);
                  }, TRANSITION_DURATION);
                }
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-300 ${
                s.id === currentScene
                  ? `${s.bg} ${s.color} border border-current/20`
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <s.icon className="w-3 h-3" />
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="w-full h-0.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-none ${scene.activeBg}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <style>{`
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
