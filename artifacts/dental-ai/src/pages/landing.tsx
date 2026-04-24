import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import OdontoFlowLogo from "@/components/odonto-flow-logo";
import AnimatedDemo from "@/components/animated-demo";
import {
  getMonthlyConversationsLabel,
  CONVERSATION_DEFINITION_NOTE,
  EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE,
  CONVERSATION_RECHARGE_NOTE,
} from "@/lib/plan-features";
import {
  Sparkles,
  MessageSquare,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Sun,
  Moon,
  Star,
  Clock,
  Brain,
  Menu,
  X,
  Bell,
  TrendingUp,
  BarChart3,
  Mic,
  ShieldCheck,
  HeartPulse,
  GraduationCap,
  Mail,
  CalendarCheck,
  XCircle,
  CheckCircle,
  Phone,
  Award,
  Wallet,
  ShieldAlert,
  Target,
  BrainCircuit,
  UserRoundSearch,
  ListOrdered,
  Zap,
  RefreshCw,
  DollarSign,
  QrCode,
  PhoneCall,
  LineChart,
  UserCheck,
  Crown,
  CalendarOff,
} from "lucide-react";

interface LandingPageProps {
  onLogin: () => void;
  onRegister: () => void;
  onRegisterFree?: () => void;
}

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

function RevealSection({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useScrollReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const duration = 2000;
    const steps = 60;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [started, target]);

  return (
    <span ref={ref} className="number-display">
      {prefix}{count.toLocaleString("pt-BR")}{suffix}
    </span>
  );
}

function WhatsAppSimulation() {
  const [visibleMessages, setVisibleMessages] = useState(0);

  const messages = [
    { from: "patient", text: "Olá! Gostaria de agendar uma limpeza 😊", time: "10:32" },
    { from: "ai", text: "Olá, Maria! 😄 Claro! Temos horários disponíveis amanhã às 9h, 14h ou 16h. Qual prefere?", time: "10:32" },
    { from: "patient", text: "14h seria perfeito!", time: "10:33" },
    { from: "ai", text: "Perfeito! ✅ Agendei sua limpeza para amanhã, 14h, com o Dr. Rafael. Enviarei um lembrete 1h antes. Até lá!", time: "10:33" },
  ];

  useEffect(() => {
    if (visibleMessages >= messages.length) return;
    const timer = setTimeout(() => {
      setVisibleMessages((v) => v + 1);
    }, visibleMessages === 0 ? 800 : 1200);
    return () => clearTimeout(timer);
  }, [visibleMessages, messages.length]);

  return (
    <div className="premium-card rounded-2xl p-1 shadow-2xl max-w-md mx-auto lg:mx-0">
      <div className="rounded-xl bg-gradient-to-br from-card to-muted/30 overflow-hidden">
        <div className="bg-emerald-600 dark:bg-emerald-700 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-white text-[12px] font-bold">OF</span>
          </div>
          <div className="flex-1">
            <p className="text-white text-[13px] font-semibold">OdontoFlow IA</p>
            <p className="text-emerald-100 text-[10px]">online</p>
          </div>
          <Phone className="w-4 h-4 text-white/70" />
        </div>
        <div className="p-4 space-y-3 min-h-[220px] bg-[#e5ddd5] dark:bg-[#0b141a]">
          {messages.slice(0, visibleMessages).map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.from === "patient" ? "justify-end" : "justify-start"} whatsapp-msg-enter`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 shadow-sm ${
                  msg.from === "patient"
                    ? "bg-[#dcf8c6] dark:bg-emerald-800 text-gray-800 dark:text-gray-100"
                    : "bg-white dark:bg-[#1f2c34] text-gray-800 dark:text-gray-100"
                }`}
              >
                <p className="text-[12px] leading-relaxed">{msg.text}</p>
                <p className={`text-[9px] mt-1 text-right ${msg.from === "patient" ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"}`}>{msg.time}</p>
              </div>
            </div>
          ))}
          {visibleMessages < messages.length && visibleMessages > 0 && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-[#1f2c34] rounded-lg px-4 py-2 shadow-sm">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const diferenciais = [
  {
    icon: Target,
    title: "CRM de Leads Inteligente",
    desc: "A IA recebe leads do seu tráfego pago (Meta Ads, Google Ads) e classifica automaticamente por temperatura — quente, morno ou frio. Você tem visibilidade total do funil de vendas da clínica e nunca mais perde um lead.",
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    size: "featured" as const,
  },
  {
    icon: BrainCircuit,
    title: "21 Técnicas de Venda com IA",
    desc: "A secretária IA vai muito além do SPIN Selling. Ela domina 21 estratégias de venda — Future Pacing, Storytelling, Ancoragem de Preço, Aversão à Perda, Micro Compromisso, Posicionamento de Autoridade e muito mais. A IA aprende quais técnicas convertem melhor para cada clínica e as prioriza automaticamente.",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    size: "featured" as const,
  },
  {
    icon: Bell,
    title: "Notificações Telegram",
    desc: "A IA avisa o dentista em tempo real pelo Telegram sobre novos agendamentos, cancelamentos e eventos importantes.",
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
    size: "normal" as const,
  },
  {
    icon: TrendingUp,
    title: "Autoaprendizado da IA",
    desc: "A IA melhora suas conversões automaticamente conforme aprende com cada interação. Quanto mais usa, melhor ela fica.",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    size: "featured" as const,
  },
  {
    icon: CalendarCheck,
    title: "Automações do Essencial",
    desc: "Confirmação automática de consulta, lembretes antes da consulta, automação de pós-consulta, mensagem de aniversário e bloqueio de agenda deixam a operação rodando no automático.",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    size: "featured" as const,
  },
  {
    icon: ShieldAlert,
    title: "Controle de Risco WhatsApp",
    desc: "Monitore o volume de mensagens automáticas e pause automações com um clique. Evite que o WhatsApp (Meta) bloqueie seu número por excesso de envios — proteção essencial para quem usa automações.",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    size: "normal" as const,
  },
  {
    icon: MessageSquare,
    title: "Respostas em Áudio Humanizado",
    desc: "O Essencial inclui resposta em áudio humanizado com 30 minutos inclusos, aproximando a experiência da clínica de uma secretária real.",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    size: "normal" as const,
  },
  {
    icon: BarChart3,
    title: "Relatórios de evolução",
    desc: "Dashboards completos para acompanhar a evolução da clínica, taxa de conversão e desempenho da IA.",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    size: "normal" as const,
  },
  {
    icon: Mic,
    title: "Voz em áudio perfeito",
    desc: "Atendimento por áudio com voz natural e humana. Seus pacientes nem percebem que estão falando com uma IA. Incluso 30 min de conversa com possibilidade de comprar créditos de recarga.",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    size: "normal" as const,
  },
  {
    icon: Clock,
    title: "Trabalha 24 horas",
    desc: "Secretária que nunca dorme. Atende de madrugada, feriados e fins de semana. Nunca perde um paciente por falta de resposta.",
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    size: "normal" as const,
  },
  {
    icon: ShieldCheck,
    title: "Bloqueio inteligente de agenda",
    desc: "Controle total dos horários disponíveis. Defina bloqueios, intervalos e regras personalizadas para cada profissional.",
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
    size: "normal" as const,
  },
  {
    icon: HeartPulse,
    title: "IA emocional",
    desc: "Entende o sentimento do paciente e sabe quando chamar o dentista ou como conduzir a conversa com empatia.",
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    size: "featured" as const,
  },
  {
    icon: GraduationCap,
    title: "IA Tutor e suporte 24h",
    desc: "IA de suporte dentro do sistema que ajuda o dentista a usar a plataforma, tirar dúvidas e configurar tudo sozinho.",
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
    size: "normal" as const,
  },
  {
    icon: Mail,
    title: "Suporte por email",
    desc: "Canal de suporte humano disponível para quando você precisar de ajuda personalizada.",
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    size: "normal" as const,
  },
  {
    icon: ListOrdered,
    title: "Fila de Espera Inteligente",
    desc: "A IA gerencia automaticamente uma fila de espera para cancelamentos de última hora, preenchendo horários vagos com pacientes que aguardam — sem nenhuma ação manual da clínica.",
    color: "text-lime-600 dark:text-lime-400",
    bg: "bg-lime-500/10",
    border: "border-lime-500/20",
    size: "featured" as const,
  },
  {
    icon: UserRoundSearch,
    title: "Recuperação de Leads e Pacientes",
    desc: "A IA identifica leads que pararam de responder e pacientes inativos, e retoma o contato automaticamente com mensagens personalizadas para reconquistar e remarcar consultas.",
    color: "text-fuchsia-600 dark:text-fuchsia-400",
    bg: "bg-fuchsia-500/10",
    border: "border-fuchsia-500/20",
    size: "featured" as const,
  },
  {
    icon: CalendarDays,
    title: "Gestão completa de agenda",
    desc: "Agenda, cancela, remarca e lembra o paciente para agendar. Gestão completa sem intervenção manual.",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    size: "normal" as const,
  },
  {
    icon: Wallet,
    title: "Financeiro (básico)",
    desc: "Controle financeiro integrado para acompanhar receitas e faturamento da clínica de forma simples e prática.",
    color: "text-lime-600 dark:text-lime-400",
    bg: "bg-lime-500/10",
    border: "border-lime-500/20",
    size: "normal" as const,
  },
];

const stats = [
  { value: 24, suffix: "h", label: "Atendimento sem parar", color: "text-primary" },
  { value: 80, suffix: "%", label: "Menos faltas na agenda", color: "text-sky-500" },
  { value: 3, suffix: "x", label: "Mais conversões", color: "text-amber-500" },
  { value: 2, suffix: "min", label: "Para começar a usar", color: "text-emerald-500" },
];

const steps = [
  {
    num: "01",
    title: "Cadastre sua clínica",
    desc: "Crie sua conta em 2 minutos. Sem contrato, sem fidelização.",
    icon: Sparkles,
  },
  {
    num: "02",
    title: "Conecte o WhatsApp",
    desc: "Vincule seu número comercial e a IA já começa a entender o perfil da sua clínica.",
    icon: MessageSquare,
  },
  {
    num: "03",
    title: "A IA assume o atendimento",
    desc: "Ela responde, agenda, lembra e resgata pacientes — 24 horas, 7 dias por semana.",
    icon: Brain,
  },
];

const testimonials = [
  {
    name: "Dra. Marina Costa",
    role: "Ortodontista — São Paulo",
    photo: "/testimonials/marina.png",
    quote: "Antes eu perdia pacientes que mandavam mensagem fora do horário. Agora a IA responde na hora e agenda sozinha. Meus agendamentos triplicaram no primeiro mês.",
    stars: 5,
    metric: "3x mais agendamentos",
  },
  {
    name: "Dr. Rafael Oliveira",
    role: "Implantodontista — Rio de Janeiro",
    photo: "/testimonials/rafael.png",
    quote: "Recebo tudo no Telegram: novos agendamentos, cancelamentos, pacientes nervosos. Mesmo em cirurgia, sei o que acontece na recepção. A IA sabe quando me chamar.",
    stars: 5,
    metric: "Zero pacientes perdidos",
  },
  {
    name: "Dra. Camila Santos",
    role: "Clínica Geral — Belo Horizonte",
    photo: "/testimonials/camila.png",
    quote: "Minhas faltas caíram 80% depois dos lembretes automáticos. E a IA ainda resgatou pacientes antigos que eu nem lembrava mais. Voltaram a agendar sozinhos.",
    stars: 5,
    metric: "80% menos faltas",
  },
];

type PlanFeatureItem = { text: string; included: boolean; highlight?: boolean };

const plans: Array<{
  name: string;
  price: string;
  originalPrice: string;
  desc: string;
  popular?: boolean;
  badge: string;
  badgeColor: string;
  cardColor: string;
  promoText?: string;
  hasTrial?: boolean;
  features: PlanFeatureItem[];
}> = [
  {
    name: "OdontoFlow Básico",
    price: "97",
    originalPrice: "197",
    desc: "Oferta especial: R$197 por R$97/mês nos primeiros 3 meses.",
    popular: false,
    hasTrial: true,
    badge: "BÁSICO",
    badgeColor: "from-emerald-500 to-teal-600",
    cardColor: "border-emerald-500/30",
    promoText: "Promoção válida por 3 meses — após isso, R$197/mês",
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
      { text: "Vídeo ou áudio de boas-vindas personalizado", included: true },
      { text: "Portfólio enviado automaticamente pela IA", included: true },
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
    name: "OdontoFlow Essencial",
    price: "197",
    originalPrice: "297",
    desc: "Oferta especial: R$297 por R$197/mês nos primeiros 3 meses.",
    popular: false,
    badge: "ESSENCIAL",
    badgeColor: "from-teal-600 to-emerald-600",
    cardColor: "border-teal-500/40",
    promoText: "Promoção válida por 3 meses — após isso, R$297/mês",
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
    name: "OdontoFlow Pro",
    price: "447",
    originalPrice: "447",
    desc: "Tudo do Essencial + funcionalidades premium exclusivas.",
    popular: true,
    badge: "PRO",
    badgeColor: "from-violet-600 to-fuchsia-600",
    cardColor: "border-violet-500/40",
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

const beforeAfter = [
  { before: "Paciente manda mensagem às 23h — ninguém responde", after: "IA responde e agenda na hora, qualquer horário" },
  { before: "Metade dos pacientes falta sem avisar", after: "Lembretes automáticos reduzem faltas em até 80%" },
  { before: "Pacientes antigos somem para sempre", after: "Resgate automático traz de volta quem parou de vir" },
  { before: "Não faz ideia de quantos leads perdeu", after: "Dashboard mostra cada oportunidade e conversão" },
  { before: "Secretária gasta o dia inteiro no WhatsApp", after: "IA responde, agenda e confirma sozinha" },
  { before: "Secretária faltou — clínica parada", after: "IA trabalha 24h, 365 dias, sem folga" },
  { before: "Leads do tráfego pago caem no WhatsApp e ninguém responde", after: "IA classifica por temperatura e aplica 21 técnicas de venda para converter" },
  { before: "IA responde como robô — paciente percebe na hora", after: "Delay de digitação natural: o paciente sente que está falando com uma humana" },
];

const faqs = [
  {
    q: "Como funciona a IA no WhatsApp?",
    a: "Nossa IA se conecta ao seu WhatsApp Business e responde automaticamente às mensagens dos pacientes. Ela consegue agendar consultas, tirar dúvidas sobre procedimentos, enviar lembretes e fazer follow-up, tudo de forma natural e personalizada para o perfil da sua clínica.",
  },
  {
    q: "O que são as notificações pelo Telegram?",
    a: "A IA envia notificações em tempo real para o seu Telegram pessoal sobre eventos importantes: novos agendamentos, cancelamentos, pacientes aguardando resposta humana e mais. Você fica por dentro de tudo sem precisar abrir o sistema.",
  },
  {
    q: "Como funciona o autoaprendizado da IA?",
    a: "A IA analisa cada interação com pacientes e aprende padrões de conversão. Com o tempo, ela melhora automaticamente suas respostas para converter mais leads em agendamentos, sem que você precise configurar nada.",
  },
  {
    q: "Como funciona o atendimento por áudio?",
    a: "A IA pode responder pacientes com áudios em voz natural e humana, criando uma experiência mais próxima e personalizada. Seu plano já inclui 30 minutos de conversa por áudio, com possibilidade de comprar créditos de recarga quando precisar.",
  },
  {
    q: "O que é a IA emocional?",
    a: "Nossa IA analisa o tom e sentimento das mensagens do paciente. Se detecta frustração, ansiedade ou urgência, ela adapta a abordagem e pode transferir automaticamente para o dentista quando necessário.",
  },
  {
    q: "O que é o CRM de Leads e como funciona a classificação por temperatura?",
    a: "O CRM de Leads do OdontoFlow recebe automaticamente todos os leads que chegam do seu tráfego pago (Meta Ads, Google Ads) e os classifica por temperatura: quente (prontos para agendar), morno (precisam de mais informação) e frio (ainda estão pesquisando). Isso permite que a IA priorize os leads com maior chance de conversão e você tenha visibilidade total do funil de vendas da clínica.",
  },
  {
    q: "Quais técnicas de venda a IA usa?",
    a: "A IA domina 21 estratégias de venda no total — o SPIN Selling (Situação, Problema, Implicação e Necessidade) como base, mais 17 técnicas complementares: Future Pacing, Storytelling, Ancoragem de Preço, Aversão à Perda, Micro Compromisso, Posicionamento de Autoridade, Confiança Educacional, Prova Social, Escassez, Urgência e muito mais. O diferencial é que a IA aprende quais técnicas geram mais conversões para cada clínica e passa a priorizá-las automaticamente.",
  },
  {
    q: "Preciso de conhecimento técnico para usar?",
    a: "Não! O OdontoFlow foi projetado para ser simples e intuitivo. Em poucos minutos você cria sua conta, conecta o WhatsApp e a IA já começa a funcionar. Além disso, temos uma IA Tutor dentro do sistema que te ajuda a configurar tudo.",
  },
  {
    q: "E se eu não gostar?",
    a: "Você tem 7 dias para testar o OdontoFlow com acesso a todas as funcionalidades. Se não ficar satisfeito, devolvemos 100% do seu dinheiro — sem burocracia.",
  },
  {
    q: "Meus dados estão seguros?",
    a: "Sim. Utilizamos criptografia de ponta a ponta, servidores seguros e estamos em total conformidade com a LGPD (Lei Geral de Proteção de Dados). Seus dados e os de seus pacientes estão sempre protegidos.",
  },
  {
    q: "O que é a Cobrança PIX do plano Pro?",
    a: "No plano Pro, a IA envia a chave PIX diretamente pelo WhatsApp para o paciente, aguarda o comprovante de pagamento, valida e confirma o agendamento automaticamente — tudo sem intervenção humana.",
  },
  {
    q: "Como funcionam as Ligações IA do plano Pro?",
    a: "A IA do plano Pro realiza chamadas telefônicas com voz 100% natural em situações como confirmação de consulta, resgate de pacientes inativos e pós-consulta. Importante: os créditos de voz para as ligações não estão inclusos no plano Pro e precisam ser adquiridos separadamente.",
  },
  {
    q: "O que inclui o plano Pro?",
    a: "O plano Pro oferece um painel financeiro completo com registro e acompanhamento de receitas e despesas da clínica, visão mensal consolidada e relatórios detalhados — muito além do financeiro básico do plano Essencial.",
  },
  {
    q: "Qual a diferença entre os planos Essencial e Pro?",
    a: "O Essencial (R$197/mês) inclui: CRM de Leads, Remarketing, Follow-up, Áudio Humanizado (30 min), Telegram, IA de Venda e <strong>Controle de Risco WhatsApp</strong>. O Pro (R$447/mês) adiciona: <strong>Recuperação de Pacientes</strong>, Relatórios completos, Financeiro Completo, titular + 1 profissional extra incluso (com opção de mais 1 por R$97/mês) e Áudio Humanizado (60 min). Ligação IA com Voz Natural chegará em breve como plano separado.",
  },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export default function LandingPage({ onLogin, onRegister, onRegisterFree }: LandingPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadForm, setLeadForm] = useState({ nome: "", email: "", whatsapp: "" });
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState(false);
  const [leadError, setLeadError] = useState("");

  const BASE = import.meta.env.BASE_URL || "/";

  function formatWhatsapp(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLeadSubmitting(true);
    setLeadError("");
    try {
      const res = await fetch(`${BASE}api/dental/leads/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: leadForm.nome.trim(),
          email: leadForm.email.trim(),
          whatsapp: leadForm.whatsapp.replace(/\D/g, ""),
          origem: "landing_free_plan",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLeadError(data.error || "Ocorreu um erro. Tente novamente.");
      } else {
        setLeadSuccess(true);
      }
    } catch {
      setLeadError("Erro de conexão. Tente novamente.");
    } finally {
      setLeadSubmitting(false);
    }
  }

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Como Funciona", id: "como-funciona-trafego" },
    { label: "Poderes da IA", id: "poderes-da-ia" },
    { label: "Diferenciais", id: "diferenciais" },
    { label: "Resultados", id: "depoimentos" },
    { label: "Preços", id: "precos" },
    { label: "FAQ", id: "faq" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-background/80 glass border-b border-border/40 shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <OdontoFlowLogo
              size="xl"
              textClassName="text-foreground"
              subtextClassName="text-muted-foreground/50"
            />

            <nav className="hidden lg:flex items-center gap-1">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => scrollToSection(link.id)}
                  className="px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/50"
                >
                  {link.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-9 w-9 rounded-lg"
                aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
              >
                {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </Button>

              <Button
                variant="ghost"
                onClick={onLogin}
                className="hidden sm:inline-flex text-[13px] font-medium h-9 px-4"
              >
                Login
              </Button>
              <Button
                onClick={onRegister}
                className="hidden sm:inline-flex premium-badge border-0 text-[13px] font-semibold h-9 px-5 shadow-lg shadow-primary/20"
              >
                Cadastrar
              </Button>

              <button
                className="lg:hidden p-2 rounded-lg hover:bg-muted/50 transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden bg-background/95 glass border-b border-border/40 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-4 py-4 space-y-1">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => {
                    scrollToSection(link.id);
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left px-4 py-2.5 text-[14px] font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {link.label}
                </button>
              ))}
              <div className="pt-3 flex flex-col gap-2">
                <Button variant="outline" onClick={onLogin} className="w-full h-10">
                  Login
                </Button>
                <Button onClick={onRegister} className="w-full h-10 premium-badge border-0">
                  Cadastrar
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <img
            src={`${import.meta.env.BASE_URL}hero-bg.jpg`}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover opacity-[0.06] dark:opacity-[0.04]"
          />
          <div className="absolute top-[-20%] right-[-10%] w-[700px] h-[700px] rounded-full bg-gradient-to-br from-primary/10 to-sky-500/5 blur-3xl" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-violet-500/8 to-emerald-500/5 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-dot-pattern opacity-40" />
          <div className="absolute top-[30%] left-[10%] w-3 h-3 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: "0ms" }} />
          <div className="absolute top-[20%] right-[20%] w-2 h-2 rounded-full bg-sky-400/50 animate-pulse" style={{ animationDelay: "600ms" }} />
          <div className="absolute bottom-[30%] right-[15%] w-2.5 h-2.5 rounded-full bg-emerald-400/40 animate-pulse" style={{ animationDelay: "1200ms" }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="text-center lg:text-left">
              <RevealSection>
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-primary/15 to-sky-500/10 border border-primary/25 text-primary text-[12px] font-bold mb-6 shadow-sm">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>IA que Vende por Você — 24h, 7 dias por semana</span>
                </div>
              </RevealSection>

              <RevealSection delay={100}>
                <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-extrabold tracking-tight leading-[1.1] mb-6">
                  Receba seus Pacientes do{" "}
                  <span className="gradient-text">Tráfego Pago</span>
                  {" "}e Deixe Que Nossa{" "}
                  <span className="relative">
                    <span className="gradient-text">IA Faça</span>
                  </span>
                  {" "}Todo o Trabalho
                </h1>
              </RevealSection>

              <RevealSection delay={180}>
                <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0 mb-6">
                  Enquanto você atende na cadeira, a IA converte seus leads do Meta Ads e Google Ads em pacientes agendados — usando inteligência emocional, SPIN Selling e 21 técnicas de venda.
                </p>
              </RevealSection>

              <RevealSection delay={240}>
                <div className="grid grid-cols-2 gap-2 mb-8 max-w-md mx-auto lg:mx-0">
                  {[
                    { icon: HeartPulse, text: "Inteligência Emocional" },
                    { icon: Target, text: "Gatilhos Mentais" },
                    { icon: Brain, text: "SPIN Selling" },
                    { icon: UserRoundSearch, text: "Resgate de Inativos" },
                    { icon: Clock, text: "Resposta em Segundos 24/7" },
                    { icon: MessageSquare, text: "Tom Humanizado" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <item.icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </RevealSection>

              <RevealSection delay={300}>
                <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                  <Button
                    onClick={onRegister}
                    size="lg"
                    className="premium-badge border-0 text-[15px] font-bold h-14 px-8 shadow-xl shadow-primary/30 hover:shadow-primary/40 transition-all gap-2 w-full sm:w-auto"
                  >
                    Ativar Minha IA Agora
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => scrollToSection("como-funciona-trafego")}
                    className="text-[15px] font-medium h-14 px-8 w-full sm:w-auto gap-2 border-primary/30 hover:border-primary/50"
                  >
                    Ver como funciona
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground/60 mt-4 text-center lg:text-left">
                  7 dias de garantia — não gostou, devolvemos 100%
                </p>
              </RevealSection>
            </div>

            <RevealSection delay={400}>
              <WhatsAppSimulation />
            </RevealSection>
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-28 relative overflow-hidden bg-background">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
          <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-emerald-500/6 to-transparent blur-3xl" />
          <div className="absolute bottom-[-15%] right-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-tl from-primary/6 to-transparent blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <RevealSection>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/15 to-sky-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[12px] font-bold mb-5 shadow-sm">
                <Award className="w-3.5 h-3.5" />
                <span>Pioneiro no mercado</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Plug &amp; Play de verdade.{" "}
                <span className="gradient-text">Do zero ao ar em minutos.</span>
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Enquanto o mercado pede que você ligue para o comercial e espera 7 dias para configurar, o OdontoFlow te coloca no ar agora.
              </p>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-3 gap-6 mb-14">
            {[
              {
                icon: Zap,
                title: "Plug & Play",
                subtitle: "Sua IA no ar em minutos",
                desc: "Crie sua conta, conecte o WhatsApp e a IA já está atendendo — sem esperar dias, sem reunião com vendedor, sem onboarding complicado.",
                color: "text-amber-500",
                bg: "bg-amber-500/10",
                border: "border-amber-500/20",
              },
              {
                icon: RefreshCw,
                title: "Personalização sua, agora",
                subtitle: "Ajuste em menos de 5 minutos",
                desc: "Defina o nome, a personalidade e o tom da sua IA direto no painel — sem precisar chamar suporte técnico ou aguardar qualquer aprovação.",
                color: "text-primary",
                bg: "bg-primary/10",
                border: "border-primary/20",
              },
              {
                icon: DollarSign,
                title: "Preço transparente",
                subtitle: "Veja, escolha e assine agora",
                desc: "Sem ligar para vendedor. Sem orçamento escondido. O preço está aqui, na tela, e você assina com dois cliques.",
                color: "text-emerald-500",
                bg: "bg-emerald-500/10",
                border: "border-emerald-500/20",
              },
            ].map((pillar, i) => (
              <RevealSection key={pillar.title} delay={i * 120}>
                <div className={`premium-card rounded-2xl p-7 h-full flex flex-col gap-4 group ring-1 ${pillar.border.replace("border-", "ring-").replace("/20", "/15")}`}>
                  <div className={`w-12 h-12 rounded-xl ${pillar.bg} ${pillar.border} border flex items-center justify-center transition-transform duration-300 group-hover:scale-110 flex-shrink-0`}>
                    <pillar.icon className={`w-6 h-6 ${pillar.color}`} />
                  </div>
                  <div>
                    <h3 className="text-[17px] font-bold mb-0.5">{pillar.title}</h3>
                    <p className={`text-[12px] font-semibold mb-3 ${pillar.color}`}>{pillar.subtitle}</p>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{pillar.desc}</p>
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>

          <RevealSection delay={200}>
            <div className="rounded-2xl border border-border/50 bg-muted/30 overflow-hidden">
              <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40">
                <div className="p-8">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-5">Como o mercado costuma funcionar</p>
                  <ul className="space-y-3">
                    {[
                      "Você liga para o comercial e aguarda retorno",
                      "Recebe uma proposta em PDF com preço oculto",
                      "Espera 7+ dias para onboarding e configuração",
                      "Depende de suporte técnico para qualquer ajuste",
                      "Preso em contrato longo sem teste real",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                        <XCircle className="w-4 h-4 text-red-500/70 flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-8 bg-gradient-to-br from-emerald-500/5 to-sky-500/5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-5">Com o OdontoFlow</p>
                  <ul className="space-y-3">
                    {[
                      "Crie sua conta agora mesmo, sem falar com ninguém",
                      "Preço claro na tela — assine com dois cliques",
                      "IA no ar em minutos, não em dias",
                      "Personalize você mesmo em menos de 5 minutos",
                      "7 dias de garantia — não gostou, 100% de reembolso",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13px] text-foreground font-medium">
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-10 lg:py-12 relative overflow-hidden bg-gradient-to-r from-primary/5 via-sky-500/5 to-violet-500/5 border-y border-primary/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <p className="text-center text-[12px] font-semibold text-muted-foreground uppercase tracking-widest mb-6">O que a IA faz pelo seu tráfego pago</p>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                "Responde o lead em segundos",
                "Identifica o estado emocional",
                "Aplica SPIN Selling",
                "Usa gatilhos de urgência e escassez",
                "Agenda sem intervenção humana",
                "Resgata leads que pararam de responder",
                "Funciona 24h todos os dias",
                "Nunca parece robô",
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border/50 text-[12px] font-medium shadow-sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-14 lg:py-16 relative border-y border-border/30 bg-muted/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {stats.map((stat, i) => (
              <RevealSection key={stat.label} delay={i * 100}>
                <div className="text-center">
                  <p className={`text-3xl sm:text-4xl lg:text-5xl font-extrabold ${stat.color} mb-2`}>
                    <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                  </p>
                  <p className="text-[12px] sm:text-[13px] text-muted-foreground font-medium">{stat.label}</p>
                </div>
              </RevealSection>
            ))}
          </div>
          <p className="text-center text-[10px] text-muted-foreground/40 mt-8 italic">
            ⓘ Resultados podem variar. A IA é uma ferramenta de apoio e pode cometer erros.
          </p>
        </div>
      </section>

      <section id="diferenciais" className="py-20 lg:py-28 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Diferenciais Exclusivos</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                O que só o OdontoFlow oferece
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Funcionalidades que vão além do básico. Cada diferencial foi pensado para maximizar seus resultados.
              </p>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {diferenciais.map((d, i) => (
              <RevealSection
                key={d.title}
                delay={i * 60}
                className={d.size === "featured" ? "lg:col-span-2 md:col-span-2" : ""}
              >
                <div className={`premium-card rounded-2xl h-full group ${d.size === "featured" ? "ring-1 ring-primary/10 p-6 md:p-8 md:flex md:items-start md:gap-6" : "p-6"}`}>
                  <div className={`${d.size === "featured" ? "w-14 h-14 md:w-16 md:h-16" : "w-12 h-12"} rounded-xl ${d.bg} ${d.border} border flex items-center justify-center mb-4 md:mb-0 flex-shrink-0 transition-transform duration-300 group-hover:scale-110`}>
                    <d.icon className={`${d.size === "featured" ? "w-7 h-7 md:w-8 md:h-8" : "w-6 h-6"} ${d.color}`} />
                  </div>
                  <div className={d.size === "featured" ? "flex-1" : ""}>
                    <h3 className={`${d.size === "featured" ? "text-[17px] md:text-[18px]" : "text-[16px]"} font-bold mb-2`}>{d.title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{d.desc}</p>
                    {d.size === "featured" && (
                      <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <Award className="w-3.5 h-3.5" />
                        Exclusivo OdontoFlow
                      </div>
                    )}
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>

          <p className="text-center text-[10px] text-muted-foreground/40 mt-10 italic">
            ⓘ Resultados podem variar. A IA é uma ferramenta de apoio e pode cometer erros. As técnicas de venda e funcionalidades descritas dependem do uso e configuração de cada clínica.
          </p>

          <RevealSection delay={400}>
            <div className="text-center mt-8">
              <Button
                onClick={onRegister}
                size="lg"
                className="premium-badge border-0 text-[15px] font-bold h-14 px-10 shadow-xl shadow-primary/25 gap-2"
              >
                Quero Ativar Minha IA Agora
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 lg:py-28 bg-muted/30 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Comparativo</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Com ou sem OdontoFlow
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Reconhece alguma dessas situações? Veja o que muda quando a IA assume.
              </p>
            </div>
          </RevealSection>

          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 gap-3">
              <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-2 px-4">
                <p className="text-[13px] font-bold text-rose-500 dark:text-rose-400 text-center">Sem OdontoFlow</p>
                <div className="w-8" />
                <p className="text-[13px] font-bold text-primary text-center">Com OdontoFlow</p>
              </div>
              {beforeAfter.map((item, i) => (
                <RevealSection key={i} delay={i * 80}>
                  <div className="premium-card rounded-xl p-4">
                    <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                        <span className="text-[13px] text-muted-foreground">{item.before}</span>
                      </div>
                      <div className="w-8 flex justify-center">
                        <ArrowRight className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-[13px] font-medium">{item.after}</span>
                      </div>
                    </div>
                    <div className="md:hidden space-y-2">
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                        <span className="text-[13px] text-muted-foreground line-through decoration-rose-300 dark:decoration-rose-700">{item.before}</span>
                      </div>
                      <div className="flex items-start gap-2 pl-1">
                        <CheckCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-[13px] font-medium">{item.after}</span>
                      </div>
                    </div>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona-trafego" className="py-20 lg:py-28 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
          <div className="absolute top-[-5%] right-[-5%] w-[400px] h-[400px] rounded-full bg-gradient-to-br from-sky-500/6 to-transparent blur-3xl" />
          <div className="absolute bottom-[-5%] left-[-5%] w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-primary/6 to-transparent blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Como Funciona</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Do Lead ao Faturamento — <span className="gradient-text">Tudo Automático</span>
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Veja como a IA transforma cada lead do seu tráfego pago em paciente agendado e receita para a clínica.
              </p>
            </div>
          </RevealSection>

          <div className="max-w-5xl mx-auto">
            <div className="relative">
              <div className="hidden lg:block absolute left-1/2 top-8 bottom-8 w-0.5 bg-gradient-to-b from-primary/0 via-primary/30 to-primary/0 -translate-x-1/2" />
              <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-1 lg:gap-4">
                {[
                  {
                    step: "01",
                    icon: Target,
                    title: "Lead Chega",
                    desc: "Um potencial paciente clica no seu anúncio do Meta Ads ou Google Ads e entra em contato pelo WhatsApp. A IA detecta imediatamente o lead e classifica sua temperatura.",
                    color: "text-orange-500",
                    bg: "bg-orange-500/10",
                    border: "border-orange-500/20",
                    side: "left",
                    badge: "Lead Recebido",
                    badgeColor: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
                  },
                  {
                    step: "02",
                    icon: HeartPulse,
                    title: "IA Identifica e Aborda",
                    desc: "A IA lê o estado emocional do lead, entende se ele está ansioso, curioso ou decidido, e adapta o tom e a linguagem automaticamente para criar conexão genuína.",
                    color: "text-pink-500",
                    bg: "bg-pink-500/10",
                    border: "border-pink-500/20",
                    side: "right",
                    badge: "IA Emocional Ativa",
                    badgeColor: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
                  },
                  {
                    step: "03",
                    icon: Brain,
                    title: "IA Convence com SPIN Selling",
                    desc: "A IA conduz a conversa pela metodologia SPIN: Situação → Problema → Implicação → Necessidade. Ela aplica gatilhos de urgência, escassez e prova social até o lead estar pronto para agendar.",
                    color: "text-violet-500",
                    bg: "bg-violet-500/10",
                    border: "border-violet-500/20",
                    side: "left",
                    badge: "21 Técnicas de Venda",
                    badgeColor: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
                  },
                  {
                    step: "04",
                    icon: CalendarCheck,
                    title: "Paciente Agenda",
                    desc: "Sem intervenção humana, a IA agenda a consulta no horário disponível, confirma com o paciente, e envia lembretes automáticos para garantir que ele apareça.",
                    color: "text-primary",
                    bg: "bg-primary/10",
                    border: "border-primary/20",
                    side: "right",
                    badge: "Agendamento Automático",
                    badgeColor: "bg-primary/10 text-primary border-primary/20",
                  },
                  {
                    step: "05",
                    icon: DollarSign,
                    title: "Clínica Lucra",
                    desc: "O dentista foca 100% em atender. A clínica cresce com mais pacientes convertidos, menos faltas e um funil de vendas trabalhando 24 horas — sem contratar mais ninguém.",
                    color: "text-emerald-500",
                    bg: "bg-emerald-500/10",
                    border: "border-emerald-500/20",
                    side: "left",
                    badge: "Resultado Real",
                    badgeColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                  },
                ].map((item, i) => (
                  <RevealSection key={item.step} delay={i * 100}>
                    <div className={`flex flex-col lg:flex-row items-start gap-4 lg:gap-8 ${item.side === "right" ? "lg:flex-row-reverse" : ""}`}>
                      <div className={`flex-1 ${item.side === "right" ? "lg:text-right" : ""}`}>
                        <div className={`premium-card rounded-2xl p-6 group hover:border-primary/20 transition-all`}>
                          <div className={`flex items-start gap-4 ${item.side === "right" ? "lg:flex-row-reverse" : ""}`}>
                            <div className={`w-12 h-12 rounded-xl ${item.bg} ${item.border} border flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110`}>
                              <item.icon className={`w-6 h-6 ${item.color}`} />
                            </div>
                            <div className="flex-1">
                              <div className={`flex items-center gap-3 mb-2 ${item.side === "right" ? "lg:flex-row-reverse" : ""}`}>
                                <div className={`w-7 h-7 rounded-lg bg-foreground/5 border border-border/50 flex items-center justify-center text-[11px] font-extrabold text-foreground/40`}>
                                  {item.step}
                                </div>
                                <h3 className="text-[17px] font-bold">{item.title}</h3>
                              </div>
                              <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">{item.desc}</p>
                              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold ${item.badgeColor}`}>
                                <CheckCircle2 className="w-3 h-3" />
                                {item.badge}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="hidden lg:flex w-12 h-12 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 items-center justify-center flex-shrink-0 mt-4 shadow-sm">
                        <ArrowRight className={`w-5 h-5 text-primary ${i < 4 ? "rotate-90" : ""}`} />
                      </div>
                      <div className="flex-1 hidden lg:block" />
                    </div>
                  </RevealSection>
                ))}
              </div>
            </div>
          </div>

          <RevealSection delay={600}>
            <div className="text-center mt-14">
              <p className="text-muted-foreground text-[14px] mb-5">Tudo isso acontece automaticamente, enquanto você foca em atender</p>
              <Button
                onClick={onRegister}
                size="lg"
                className="premium-badge border-0 text-[15px] font-bold h-14 px-10 shadow-xl shadow-primary/25 gap-2"
              >
                Quero Pacientes Convertidos no Automático
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </RevealSection>
        </div>
      </section>

      <section id="poderes-da-ia" className="py-20 lg:py-28 bg-gradient-to-br from-background via-primary/3 to-sky-500/3 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-violet-500/8 to-transparent blur-3xl" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-primary/8 to-transparent blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Poderes da IA</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                O Arsenal da IA que{" "}
                <span className="gradient-text">Converte Leads</span>
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Cada poder foi desenvolvido especificamente para converter leads de tráfego pago em pacientes — sem esforço humano.
              </p>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: HeartPulse,
                title: "Inteligência Emocional",
                desc: "Identifica o estado emocional do lead — ansioso, curioso ou decidido — e adapta automaticamente o tom, a cadência e a abordagem para criar conexão real e humana.",
                color: "text-pink-500",
                bg: "bg-gradient-to-br from-pink-500/15 to-rose-500/5",
                border: "border-pink-500/20",
                hoverClass: "hover:shadow-pink-500/10",
                tag: "Exclusivo",
                tagColor: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
              },
              {
                icon: Zap,
                title: "Gatilhos Mentais",
                desc: "Urgência, escassez, prova social e autoridade aplicados no momento exato da conversa. A IA sabe quando e como usar cada gatilho para acelerar a decisão do paciente.",
                color: "text-amber-500",
                bg: "bg-gradient-to-br from-amber-500/15 to-orange-500/5",
                border: "border-amber-500/20",
                hoverClass: "hover:shadow-amber-500/10",
                tag: "Alta Conversão",
                tagColor: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              },
              {
                icon: Brain,
                title: "SPIN Selling",
                desc: "Conduz a conversa pela metodologia comprovada: Situação → Problema → Implicação → Necessidade. A IA guia o lead naturalmente até o fechamento do agendamento.",
                color: "text-violet-500",
                bg: "bg-gradient-to-br from-violet-500/15 to-purple-500/5",
                border: "border-violet-500/20",
                hoverClass: "hover:shadow-violet-500/10",
                tag: "Metodologia Comprovada",
                tagColor: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              },
              {
                icon: RefreshCw,
                title: "Resgate de Pacientes Inativos",
                desc: "Reativa silenciosamente leads que pararam de responder e pacientes que sumiram. A IA retoma o contato com mensagens personalizadas no momento certo para reconquistar cada um.",
                color: "text-sky-500",
                bg: "bg-gradient-to-br from-sky-500/15 to-cyan-500/5",
                border: "border-sky-500/20",
                hoverClass: "hover:shadow-sky-500/10",
                tag: "Recuperação Automática",
                tagColor: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
              },
              {
                icon: Clock,
                title: "Disponível 24/7",
                desc: "Responde instantaneamente a qualquer hora — de madrugada, feriados e fins de semana. Nenhum lead é perdido por falta de resposta, sem custo adicional de funcionário.",
                color: "text-emerald-500",
                bg: "bg-gradient-to-br from-emerald-500/15 to-green-500/5",
                border: "border-emerald-500/20",
                hoverClass: "hover:shadow-emerald-500/10",
                tag: "Sem Folgas",
                tagColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              },
              {
                icon: MessageSquare,
                title: "Humanizado de Verdade",
                desc: "Usa linguagem natural, divisão de mensagens e pausas de digitação (8-15 segundos) proportional ao texto. O paciente tem a certeza de que está falando com uma secretária humana.",
                color: "text-primary",
                bg: "bg-gradient-to-br from-primary/15 to-teal-500/5",
                border: "border-primary/20",
                hoverClass: "hover:shadow-primary/10",
                tag: "Parece Humano",
                tagColor: "bg-primary/10 text-primary",
              },
            ].map((power, i) => (
              <RevealSection key={power.title} delay={i * 80}>
                <div className={`premium-card-shine rounded-2xl p-7 h-full group hover:shadow-lg ${power.hoverClass} transition-all duration-500`}>
                  <div className={`w-14 h-14 rounded-2xl ${power.bg} ${power.border} border flex items-center justify-center mb-5 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3 shadow-sm`}>
                    <power.icon className={`w-7 h-7 ${power.color}`} />
                  </div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="text-[17px] font-bold leading-tight">{power.title}</h3>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${power.tagColor}`}>
                      {power.tag}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{power.desc}</p>
                  <div className="mt-5 flex items-center gap-1.5 text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <power.icon className="w-3.5 h-3.5" />
                    Ativo em todos os planos
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>

          <RevealSection delay={600}>
            <div className="text-center mt-14">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-[12px] font-semibold mb-6">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Todos os 6 poderes ativos simultaneamente, 24 horas por dia</span>
              </div>
              <br />
              <Button
                onClick={onRegister}
                size="lg"
                className="premium-badge border-0 text-[15px] font-bold h-14 px-10 shadow-xl shadow-primary/25 gap-2"
              >
                Ativar Minha IA Agora
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </RevealSection>
        </div>
      </section>

      <section id="como-funciona" className="py-20 lg:py-28 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Configuração</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Comece em 3 passos simples
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Configure sua clínica virtual em minutos e deixe a IA trabalhar por você.
              </p>
            </div>
          </RevealSection>

          <div className="max-w-4xl mx-auto relative">
            <div className="hidden md:block absolute top-16 left-[16.6%] right-[16.6%] h-0.5 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20" />
            <div className="grid md:grid-cols-3 gap-8">
              {steps.map((step, i) => (
                <RevealSection key={step.num} delay={i * 150}>
                  <div className="text-center relative">
                    <div className="relative inline-flex mb-6">
                      <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-emerald-500/5 border border-primary/15 flex items-center justify-center transition-transform duration-500 hover:scale-105">
                        <step.icon className="w-10 h-10 text-primary" />
                      </div>
                      <div className="absolute -top-2 -right-2 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-[12px] font-bold shadow-lg shadow-primary/30">
                        {step.num}
                      </div>
                    </div>
                    <h3 className="text-[17px] font-bold mb-2">{step.title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>

          <RevealSection delay={500}>
            <div className="text-center mt-12">
              <Button
                onClick={onRegister}
                className="premium-badge border-0 text-[14px] font-semibold h-12 px-8 shadow-lg shadow-primary/20 gap-2"
              >
                Criar minha clínica agora
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-primary/6 to-transparent blur-3xl" />
          <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-tl from-emerald-500/6 to-transparent blur-3xl" />
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <RevealSection>
            <div className="text-center mb-12">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Demonstração</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Veja o OdontoFlow em ação
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Assista como a IA atende pacientes, organiza a agenda e gerencia leads — em tempo real.
              </p>
            </div>
          </RevealSection>

          <RevealSection delay={200}>
            <div className="max-w-2xl mx-auto">
              <AnimatedDemo />
            </div>
          </RevealSection>
        </div>
      </section>

      <section id="depoimentos" className="py-20 lg:py-28 bg-muted/30 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Depoimentos</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                O que dizem os dentistas
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Resultados reais de quem já usa o OdontoFlow no dia a dia.
              </p>
            </div>
          </RevealSection>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {testimonials.map((t, i) => (
              <RevealSection key={t.name} delay={i * 100}>
                <div className="premium-card-glow rounded-2xl p-7 h-full flex flex-col group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-1">
                      {Array.from({ length: t.stars }).map((_, si) => (
                        <Star key={si} className="w-4 h-4 text-amber-400 fill-amber-400" />
                      ))}
                    </div>
                    <MessageSquare className="w-5 h-5 text-muted-foreground/20" />
                  </div>
                  <div className="mb-5 inline-flex self-start items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/15 text-primary text-[11px] font-bold">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {t.metric}
                  </div>
                  <p className="text-[14px] text-muted-foreground leading-relaxed flex-1 mb-6 italic">
                    "{t.quote}"
                  </p>
                  <div className="flex items-center gap-3 pt-4 border-t border-border/50">
                    <div className="w-12 h-12 rounded-full overflow-hidden shadow-sm flex-shrink-0 ring-2 ring-primary/15">
                      <img
                        src={t.photo}
                        alt={t.name}
                        className="w-full h-full object-cover object-top"
                        loading="lazy"
                      />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
          <p className="text-center text-[10px] text-muted-foreground/40 mt-10 italic max-w-xl mx-auto">
            ⓘ Resultados podem variar. As métricas apresentadas refletem experiências individuais. A IA é uma ferramenta de apoio e não garante resultados idênticos.
          </p>
        </div>
      </section>

      <section className="py-20 lg:py-28 relative overflow-hidden bg-gradient-to-br from-violet-950/60 via-background to-fuchsia-950/40 dark:from-violet-950/80 dark:via-background dark:to-fuchsia-950/60">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent" />
          <div className="absolute top-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 blur-3xl" />
          <div className="absolute bottom-[-15%] left-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-fuchsia-500/10 to-transparent blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <RevealSection>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/15 border border-violet-500/30 text-violet-400 text-[12px] font-bold mb-5 shadow-sm">
                <Crown className="w-3.5 h-3.5" />
                <span>Novidades Exclusivas do Plano Pro</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Funcionalidades{" "}
                <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Premium</span>{" "}
                que mudam tudo
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                O plano Pro eleva sua clínica a outro nível com tecnologia de ponta — agora acessível dentro de um SaaS.
              </p>
            </div>
          </RevealSection>

          <div className="max-w-5xl mx-auto space-y-6">
            <RevealSection delay={0}>
              <div className="relative rounded-2xl p-px bg-gradient-to-r from-sky-400 via-indigo-500 to-cyan-400 animate-border-glow shadow-2xl shadow-sky-500/20">
                <div className="rounded-2xl p-7 md:p-8 bg-gradient-to-br from-sky-950/90 via-slate-900/95 to-indigo-950/90 dark:from-sky-950/80 dark:via-slate-900/90 dark:to-indigo-950/80 relative overflow-hidden group">
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 right-0 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl" />
                    <div className="absolute bottom-0 left-0 w-56 h-56 bg-indigo-500/10 rounded-full blur-3xl" />
                  </div>

                  <div className="relative z-10">
                    <div className="flex flex-col md:flex-row md:items-start md:gap-8">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-5">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500/30 to-indigo-500/20 border border-sky-400/40 flex items-center justify-center shadow-lg shadow-sky-500/20 animate-icon-pulse">
                            <PhoneCall className="w-8 h-8 text-sky-400" />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-gradient-to-r from-orange-500 to-amber-500 text-white animate-badge-pulse w-fit">
                              🔥 NOVIDADE NO MERCADO
                            </span>
                            <h3 className="text-xl md:text-2xl font-extrabold text-white">Ligações IA com Voz Natural</h3>
                          </div>
                        </div>

                        <p className="text-[14px] text-sky-100/80 leading-relaxed mb-5 max-w-xl">
                          IA que liga para o paciente com voz humana real — confirmação de consulta, resgate de inativos e pós-consulta, tudo automático. O paciente não percebe diferença de uma secretária real.
                        </p>

                        <ul className="space-y-2.5 mb-5">
                          {["Voz 100% natural e humana — indistinguível de pessoa real", "Confirmação, resgate de inativos e pós-consulta automáticos", "Tecnologia antes inacessível — agora dentro do seu SaaS", "⚠️ Créditos de voz adquiridos separadamente"].map((h, hi) => (
                            <li key={hi} className="flex items-start gap-2 text-[13px] font-medium text-sky-100/90">
                              <CheckCircle2 className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-center justify-center md:justify-end md:pt-8">
                        <div className="flex items-end gap-1 h-16">
                          {[0.3, 0.6, 1, 0.7, 0.4, 0.8, 1, 0.5, 0.3].map((delay, i) => (
                            <div
                              key={i}
                              className="w-1.5 rounded-full bg-gradient-to-t from-sky-400 to-indigo-400 animate-sound-wave"
                              style={{
                                height: `${20 + i * 4}px`,
                                animationDelay: `${delay * 0.3}s`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </RevealSection>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: QrCode,
                  title: "Cobrança PIX Automática",
                  desc: "A IA envia a chave PIX pelo WhatsApp, aguarda o comprovante do paciente e confirma o agendamento automaticamente — sem intervenção humana.",
                  color: "text-emerald-400",
                  bg: "from-emerald-500/20 to-green-500/10",
                  border: "border-emerald-500/30",
                  tag: "NOVO",
                  tagBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                  highlight: ["Envia chave PIX no WhatsApp", "Recebe e valida comprovante", "Confirma agendamento automático"],
                },
                {
                  icon: LineChart,
                  title: "Financeiro Completo",
                  desc: "Painel completo de receitas e despesas da clínica com visão mensal consolidada, relatórios detalhados e controle financeiro total.",
                  color: "text-amber-400",
                  bg: "from-amber-500/20 to-orange-500/10",
                  border: "border-amber-500/30",
                  tag: "NOVO",
                  tagBg: "bg-amber-500/20 text-amber-300 border-amber-500/30",
                  highlight: ["Receitas e despesas integradas", "Visão mensal consolidada", "Relatórios financeiros detalhados"],
                },
                {
                  icon: UserCheck,
                  title: "Recuperação Avançada de Pacientes",
                  desc: "A IA identifica pacientes que sumiram há semanas ou meses e inicia contato automático com mensagens personalizadas para trazê-los de volta.",
                  color: "text-fuchsia-400",
                  bg: "from-fuchsia-500/20 to-violet-500/10",
                  border: "border-fuchsia-500/30",
                  tag: "NOVO",
                  tagBg: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
                  highlight: ["Identifica pacientes inativos", "Contato automático personalizado", "Recupera quem sumiu sem aviso"],
                },
              ].map((feat, i) => (
                <RevealSection key={feat.title} delay={(i + 1) * 120}>
                  <div className={`rounded-2xl p-7 h-full border bg-gradient-to-br ${feat.bg} ${feat.border} group hover:scale-[1.02] transition-all duration-300 shadow-lg`}>
                    <div className="flex items-start justify-between mb-5">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feat.bg} ${feat.border} border flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 shadow-sm`}>
                        <feat.icon className={`w-7 h-7 ${feat.color}`} />
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${feat.tagBg}`}>
                        {feat.tag}
                      </span>
                    </div>
                    <h3 className="text-[18px] font-bold mb-2 text-foreground">{feat.title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed mb-5">{feat.desc}</p>
                    <ul className="space-y-2">
                      {feat.highlight.map((h, hi) => (
                        <li key={hi} className="flex items-start gap-2 text-[12px] font-medium text-foreground/80">
                          <CheckCircle2 className={`w-3.5 h-3.5 ${feat.color} flex-shrink-0 mt-0.5`} />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>

          <RevealSection delay={500}>
            <div className="text-center mt-12">
              <Button
                onClick={onRegister}
                size="lg"
                className="h-14 px-10 text-[15px] font-bold gap-2 shadow-xl border-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-violet-500/30"
              >
                Quero o Plano Pro
                <Crown className="w-5 h-5" />
              </Button>
              <p className="text-[12px] text-muted-foreground/60 mt-3">7 dias de garantia — não gostou, devolvemos 100%</p>
            </div>
          </RevealSection>
        </div>
      </section>

      <section id="precos" className="py-20 lg:py-28 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">Planos e Preços</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Invista no crescimento da sua clínica
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                7 dias de garantia de satisfação — se não gostar, devolvemos seu dinheiro.
              </p>
            </div>
          </RevealSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto items-start pt-5">
            {plans.map((plan, i) => (
              <RevealSection key={plan.name} delay={i * 120} className="overflow-visible">
                <div className="relative">
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 z-10 px-5 py-1.5 rounded-full bg-gradient-to-r ${plan.badgeColor} text-white text-[11px] font-bold shadow-lg flex items-center gap-1.5`}>
                    {plan.popular ? <Crown className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    {plan.badge}
                  </div>
                  <div className={`rounded-2xl p-6 relative h-full flex flex-col ${
                    plan.popular
                      ? "premium-card-shine border-2 border-violet-500/50 shadow-2xl shadow-violet-500/15 ring-1 ring-violet-500/20"
                      : `premium-card border-2 ${plan.cardColor} shadow-xl shadow-primary/5`
                  }`}>
                    <div className="pt-4 text-center flex-1 flex flex-col">
                      <h3 className={`text-[20px] font-extrabold mb-1 ${plan.popular ? "bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent" : ""}`}>{plan.name}</h3>
                      <p className="text-[12px] text-muted-foreground mb-4">{plan.desc}</p>
                      <div className="flex items-baseline justify-center gap-1 mb-1">
                        {plan.originalPrice !== plan.price && (
                          <span className="text-[15px] font-semibold text-muted-foreground line-through mr-1">R${plan.originalPrice}</span>
                        )}
                        <span className={`text-5xl font-black ${plan.popular ? "bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent" : "gradient-text"}`}>R${plan.price}</span>
                        <span className="text-[14px] text-muted-foreground font-semibold">/mês</span>
                      </div>
                      {plan.promoText && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mb-1">{plan.promoText}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground/70 mb-5">Sem fidelização — cancele quando quiser</p>
                      <Button
                        onClick={
                          plan.hasTrial
                            ? onRegisterFree
                            : plan.popular
                            ? onRegister
                            : () => setLeadModalOpen(true)
                        }
                        className={`w-full h-11 text-[14px] font-bold gap-2 border-0 shadow-lg ${
                          plan.popular
                            ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-violet-500/25"
                            : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/25"
                        }`}
                      >
                        {plan.hasTrial
                          ? "Começar grátis — 7 dias"
                          : plan.popular
                          ? "Assinar agora"
                          : "Assinar agora"}
                        {plan.popular ? <Crown className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                      </Button>
                      {plan.hasTrial ? (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-2">7 dias grátis — sem cartão de crédito</p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/60 mt-2">Exige cartão de crédito — sem fidelização</p>
                      )}
                      <div className="mt-6 space-y-2 text-left flex-1">
                        {plan.features.map((feat) => (
                          <div key={feat.text} className="flex items-start gap-2">
                            {feat.included ? (
                              <CheckCircle2 className={`w-4 h-4 flex-shrink-0 mt-0.5 ${plan.popular ? "text-violet-400" : feat.highlight ? "text-emerald-500" : "text-emerald-500/70"}`} />
                            ) : (
                              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground/30" />
                            )}
                            <span className={`text-[12px] ${
                              !feat.included
                                ? "text-muted-foreground/40 line-through"
                                : feat.highlight
                                  ? "font-semibold text-foreground"
                                  : "text-muted-foreground"
                            }`}>
                              {feat.text}
                            </span>
                          </div>
                        ))}
                        <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
                          <p className="text-[11px] text-foreground/70 leading-snug font-medium bg-muted/60 rounded-lg px-2.5 py-1.5">
                            {CONVERSATION_DEFINITION_NOTE}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {EXTRA_PROFESSIONAL_CONVERSATIONS_NOTE}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {CONVERSATION_RECHARGE_NOTE}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="py-20 lg:py-28 bg-muted/30 relative">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <RevealSection>
            <div className="text-center mb-16">
              <p className="text-primary text-[13px] font-semibold tracking-wide uppercase mb-3">FAQ</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
                Perguntas frequentes
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Tire suas dúvidas sobre o OdontoFlow e seus diferenciais exclusivos.
              </p>
            </div>
          </RevealSection>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <RevealSection key={i} delay={i * 60}>
                <div className="premium-card rounded-xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between p-5 text-left"
                    aria-expanded={openFaq === i}
                  >
                    <span className="text-[14px] font-semibold pr-4">{faq.q}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-muted-foreground flex-shrink-0 transition-transform duration-300 ${
                        openFaq === i ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      openFaq === i ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="px-5 pb-5">
                      <div className="h-px bg-border/50 mb-4" />
                      <p className="text-[13px] text-muted-foreground leading-relaxed">{faq.a}</p>
                    </div>
                  </div>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-emerald-500/5" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-dot-pattern opacity-20" />
        </div>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <RevealSection>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[12px] font-semibold mb-6">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>7 dias de garantia — risco zero para você</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
              Sua clínica merece uma secretária que nunca falha
            </h2>
            <p className="text-muted-foreground text-lg mb-4 max-w-xl mx-auto">
              Configure em 2 minutos, teste por 7 dias e veja a diferença. Não gostou? Devolvemos 100% do seu dinheiro.
            </p>
            <p className="text-[13px] text-muted-foreground/70 mb-8">
              Sem contrato, sem fidelização. Cancele quando quiser.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                onClick={onRegister}
                size="lg"
                className="premium-badge border-0 text-[15px] font-semibold h-13 px-8 shadow-xl shadow-primary/25 gap-2 w-full sm:w-auto"
              >
                Quero começar agora
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={onLogin}
                className="text-[15px] font-medium h-13 px-8 w-full sm:w-auto"
              >
                Já tenho conta
              </Button>
            </div>
          </RevealSection>
        </div>
      </section>

      <footer className="border-t border-border/50 bg-card/50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <OdontoFlowLogo
                size="lg"
                textClassName="text-foreground"
                subtextClassName="text-muted-foreground/50"
                className="mb-4"
              />
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
                Sua secretária virtual inteligente para clínicas odontológicas. IA que atende 24h, aprende sozinha e nunca perde um paciente.
              </p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] text-muted-foreground">Sistema online</span>
              </div>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold mb-3">Produto</h4>
              <ul className="space-y-2">
                {[
                  { label: "Como Funciona", id: "como-funciona-trafego" },
                  { label: "Poderes da IA", id: "poderes-da-ia" },
                  { label: "Diferenciais", id: "diferenciais" },
                  { label: "Preços", id: "precos" },
                  { label: "Resultados", id: "depoimentos" },
                  { label: "FAQ", id: "faq" },
                ].map((link) => (
                  <li key={link.id}>
                    <button
                      onClick={() => scrollToSection(link.id)}
                      className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold mb-3">Diferenciais</h4>
              <ul className="space-y-2">
                {["IA 24h no WhatsApp", "Notificações Telegram", "IA Emocional", "Autoaprendizado", "Áudio Perfeito"].map((link) => (
                  <li key={link}>
                    <span className="text-[12px] text-muted-foreground">{link}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-[13px] font-semibold mb-3">Contato</h4>
              <ul className="space-y-2">
                <li className="text-[12px] text-muted-foreground">contato@odontoflow.com.br</li>
                <li className="text-[12px] text-muted-foreground">São Paulo, SP — Brasil</li>
              </ul>
              <h4 className="text-[13px] font-semibold mb-2 mt-4">Suporte</h4>
              <ul className="space-y-2">
                {["Central de Ajuda", "Status do Sistema"].map((link) => (
                  <li key={link}>
                    <span className="text-[12px] text-muted-foreground">{link}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[11px] text-muted-foreground/60">
              &copy; {new Date().getFullYear()} OdontoFlow. Todos os direitos reservados.
            </p>
            <div className="flex items-center gap-4">
              <button className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Termos de Uso</button>
              <button className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">Política de Privacidade</button>
              <button className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">LGPD</button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/35 text-center mt-4 italic">
            ⓘ A IA é uma ferramenta de apoio e pode cometer erros. Resultados podem variar conforme cada clínica e uso da plataforma.
          </p>
        </div>
      </footer>

      {leadModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => { if (!leadSubmitting) { setLeadModalOpen(false); setLeadSuccess(false); setLeadForm({ nome: "", email: "", whatsapp: "" }); setLeadError(""); } }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { if (!leadSubmitting) { setLeadModalOpen(false); setLeadSuccess(false); setLeadForm({ nome: "", email: "", whatsapp: "" }); setLeadError(""); } }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            {leadSuccess ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-9 h-9 text-emerald-500" />
                </div>
                <h3 className="text-[22px] font-extrabold text-gray-900 mb-2">Incrível! Você está dentro! 🎉</h3>
                <p className="text-[14px] text-gray-600 mb-2">
                  Seu consultório vai começar a receber pacientes no piloto automático.
                </p>
                <p className="text-[13px] text-emerald-700 font-semibold mb-6">
                  Entraremos em contato pelo WhatsApp para ativar sua conta!
                </p>
                <Button
                  onClick={() => { setLeadModalOpen(false); setLeadSuccess(false); setLeadForm({ nome: "", email: "", whatsapp: "" }); }}
                  className="w-full h-11 text-[14px] font-bold border-0 text-white"
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                >
                  Perfeito, obrigado!
                </Button>
              </div>
            ) : (
              <div className="p-6">
                <div className="text-center mb-5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-white text-[11px] font-bold shadow-sm mb-3">
                    <Sparkles className="w-3 h-3" /> Oferta Especial — R$197 por R$97/mês
                  </span>
                  <h3 className="text-[20px] font-extrabold text-gray-900 leading-tight mb-2">
                    Seu consultório recebendo pacientes no automático ainda hoje
                  </h3>
                  <p className="text-[13px] text-gray-600">
                    Preencha abaixo e ative seu plano por R$97/mês (válido por 3 meses).
                  </p>
                </div>

                <form onSubmit={handleLeadSubmit} className="space-y-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">Seu nome</label>
                    <input
                      type="text"
                      required
                      placeholder="Dr(a). João Silva"
                      value={leadForm.nome}
                      onChange={(e) => setLeadForm((f) => ({ ...f, nome: e.target.value }))}
                      className="w-full h-10 px-3 rounded-lg border border-emerald-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">E-mail</label>
                    <input
                      type="email"
                      required
                      placeholder="seu@email.com"
                      value={leadForm.email}
                      onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full h-10 px-3 rounded-lg border border-emerald-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1">WhatsApp</label>
                    <input
                      type="tel"
                      required
                      placeholder="(11) 99999-9999"
                      value={leadForm.whatsapp}
                      onChange={(e) => setLeadForm((f) => ({ ...f, whatsapp: formatWhatsapp(e.target.value) }))}
                      className="w-full h-10 px-3 rounded-lg border border-emerald-200 bg-white text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                    />
                  </div>

                  {leadError && (
                    <p className="text-[12px] text-red-600 font-medium">{leadError}</p>
                  )}

                  <Button
                    type="submit"
                    disabled={leadSubmitting}
                    className="w-full h-11 text-[14px] font-bold border-0 text-white mt-1 gap-2"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                  >
                    {leadSubmitting ? "Enviando..." : (
                      <>
                        Ativar por R$97/mês
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                  <p className="text-[11px] text-gray-500 text-center">
                    Sem spam. Seus dados são usados apenas para ativar sua conta.
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
