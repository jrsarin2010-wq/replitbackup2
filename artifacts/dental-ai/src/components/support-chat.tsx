import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send, Bot, User, Minimize2, RefreshCw, CheckCircle2, ChevronRight, ArrowLeft } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  separator?: boolean;
}

interface FlowStep {
  title: string;
  description: string;
  tip?: string;
}

interface Flow {
  id: string;
  title: string;
  emoji: string;
  steps: FlowStep[];
}

const FLOWS: Flow[] = [
  {
    id: "connect-whatsapp",
    title: "Conectar WhatsApp",
    emoji: "📱",
    steps: [
      {
        title: "Acesse as configurações do WhatsApp",
        description: "No menu lateral, clique em Configurações e depois na aba \"WhatsApp\".",
        tip: "Você precisará do celular da clínica com WhatsApp instalado."
      },
      {
        title: "Gere o QR Code",
        description: "Clique no botão \"Conectar WhatsApp\". Um QR Code será exibido na tela.",
      },
      {
        title: "Escaneie o QR Code",
        description: "No celular, abra o WhatsApp → toque em Configurações → Aparelhos conectados → Adicionar aparelho → Escaneie o QR Code.",
      },
      {
        title: "Confirme a conexão",
        description: "O ícone de status ficará verde quando conectado. Se ficar vermelho, tente novamente.",
        tip: "Mantenha o celular sempre com Wi-Fi estável para evitar desconexões."
      }
    ]
  },
  {
    id: "add-procedure",
    title: "Cadastrar Procedimento",
    emoji: "🦷",
    steps: [
      {
        title: "Acesse os procedimentos",
        description: "No menu lateral, clique em Configurações e depois na aba \"Procedimentos\".",
      },
      {
        title: "Crie um novo procedimento",
        description: "Clique no botão \"+ Novo Procedimento\" no canto superior direito.",
      },
      {
        title: "Preencha as informações",
        description: "Digite o nome (ex: Limpeza), a duração em minutos (ex: 60), o preço (ex: 150.00) e uma descrição detalhada.",
        tip: "A descrição é usada pela IA para explicar o procedimento aos pacientes. Seja detalhado!"
      },
      {
        title: "Salve e repita",
        description: "Clique em Salvar. Repita para cada procedimento que a clínica oferece. Quanto mais procedimentos, melhor a IA atende.",
      }
    ]
  },
  {
    id: "configure-telegram",
    title: "Configurar Telegram",
    emoji: "✈️",
    steps: [
      {
        title: "Acesse as configurações do Telegram",
        description: "No menu lateral, clique em Configurações e depois na aba \"Telegram\".",
      },
      {
        title: "Crie um bot no BotFather",
        description: "Clique no link azul \"abrir o BotFather direto ↗\". No Telegram, envie o comando /newbot e siga as instruções.",
        tip: "Dê um nome amigável ao bot, ex: 'Alertas Clínica Sorriso'. O username deve terminar em 'bot'."
      },
      {
        title: "Copie o token do bot",
        description: "O BotFather vai gerar um token (código longo). Copie esse código inteiro e cole no campo \"Token\" no OdontoFlow.",
      },
      {
        title: "Valide e busque seu chat",
        description: "Clique em \"Validar\". Depois clique no link azul para abrir o bot, envie /start no Telegram, volte ao OdontoFlow e clique em \"Buscar meu chat\".",
      },
      {
        title: "Selecione seu nome e teste",
        description: "Selecione seu nome na lista que aparecer. Clique em \"Enviar teste\" — você deve receber uma mensagem no Telegram.",
        tip: "Se não receber o teste, verifique se enviou /start para o bot no Telegram."
      }
    ]
  },
  {
    id: "add-professional",
    title: "Adicionar Profissional",
    emoji: "👨‍⚕️",
    steps: [
      {
        title: "Acesse os profissionais",
        description: "No menu lateral, clique em Configurações e depois na aba \"Profissionais\".",
      },
      {
        title: "Crie um novo profissional",
        description: "Clique em \"+ Novo Profissional\". Preencha o nome completo e a especialidade (ex: Ortodontia, Implantes, Estética).",
        tip: "A especialidade é usada pela IA para rotear pacientes automaticamente. Seja específico."
      },
      {
        title: "Configure horários e valores",
        description: "Defina os horários de atendimento do profissional, o valor da consulta e se aceita convênio.",
      },
      {
        title: "Confirme o pagamento (se necessário)",
        description: "Profissionais extras custam R$ 97/mês e estão disponíveis apenas no plano Pro (titular + 1 incluso + opção de 1 extra). Um QR Code PIX será gerado. Após o pagamento, o profissional fica ativo.",
        tip: "Nos planos Básico e Essencial, somente o profissional titular é permitido. Faça upgrade para o Pro para liberar profissionais adicionais."
      }
    ]
  }
];

const FLOW_QUICK_SUGGESTIONS = [
  { label: "Conectar WhatsApp", flowId: "connect-whatsapp" },
  { label: "Cadastrar procedimento", flowId: "add-procedure" },
  { label: "Configurar Telegram", flowId: "configure-telegram" },
  { label: "Adicionar profissional", flowId: "add-professional" },
];

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content: "Olá! 👋 Sou o Tutor IA do OdontoFlow. Estou aqui para te ajudar a configurar e usar o sistema.\n\nPosso te guiar nos primeiros passos, explicar como funciona cada funcionalidade ou resolver dúvidas. O que posso ajudar hoje?",
};

const SEPARATOR_MESSAGE: Message = {
  role: "assistant",
  content: "— Conversa anterior —",
  separator: true,
};

const TEXT_QUICK_SUGGESTIONS = [
  "Por onde começo?",
  "Como funciona o remarketing?",
  "Como ver os relatórios?",
  "Como pausar a IA?",
];

const BASE = import.meta.env.BASE_URL || "/";

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [proactiveTyping, setProactiveTyping] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  const [flowStep, setFlowStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasInteractedRef = useRef(false);
  const proactiveShownRef = useRef(false);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => {
        scrollToBottom();
        inputRef.current?.focus();
      }, 100);
      setHasNewMessage(false);
    }
  }, [open, minimized]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, proactiveTyping, activeFlow, flowStep]);

  async function loadHistory() {
    try {
      const res = await fetch(`${BASE}api/dental/support-chat/history`);
      if (!res.ok) {
        fetchProactive();
        return;
      }
      const data = await res.json() as { messages: Array<{ role: string; content: string }> };
      const saved = data.messages ?? [];
      if (saved.length > 0 && !hasInteractedRef.current) {
        const typedSaved: Message[] = saved.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
        setMessages([...typedSaved, SEPARATOR_MESSAGE, WELCOME_MESSAGE]);
      } else {
        fetchProactive();
      }
    } catch {
      fetchProactive();
    } finally {
      setHistoryLoaded(true);
    }
  }

  async function fetchProactive() {
    if (proactiveShownRef.current) return;
    proactiveShownRef.current = true;

    await new Promise(r => setTimeout(r, 900));
    setProactiveTyping(true);

    try {
      const res = await fetch(`${BASE}api/dental/support-chat/proactive`);
      if (!res.ok) return;
      const data = await res.json() as { tips: string[]; allConfigured: boolean; diagnostics?: Record<string, unknown> };
      const tips = data.tips ?? [];
      if (tips.length === 0) return;

      const intro = data.allConfigured
        ? "Aqui está o diagnóstico da sua clínica:"
        : "Fiz um diagnóstico da sua conta e encontrei pontos importantes:";

      const content = `${intro}\n\n${tips.map((t, i) => `${i + 1}. ${t}`).join("\n\n")}`;

      await new Promise(r => setTimeout(r, 800));
      setMessages(prev => [...prev, { role: "assistant", content }]);
    } catch {
    } finally {
      setProactiveTyping(false);
    }
  }

  async function saveHistory(msgs: Message[]) {
    const toSave = msgs
      .filter(m => !m.separator && m.content !== WELCOME_MESSAGE.content)
      .map(m => ({ role: m.role, content: m.content }));
    if (toSave.length === 0) return;
    try {
      await fetch(`${BASE}api/dental/support-chat/history`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toSave }),
      });
    } catch {
    }
  }

  async function clearHistory() {
    try {
      await fetch(`${BASE}api/dental/support-chat/history`, { method: "DELETE" });
    } catch {
    }
    setMessages([WELCOME_MESSAGE]);
    setActiveFlow(null);
    setFlowStep(0);
    setCompletedSteps(new Set());
    proactiveShownRef.current = false;
    fetchProactive();
  }

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  function startFlow(flowId: string) {
    const flow = FLOWS.find(f => f.id === flowId);
    if (!flow) return;
    hasInteractedRef.current = true;
    setActiveFlow(flow);
    setFlowStep(0);
    setCompletedSteps(new Set());
  }

  function exitFlow() {
    if (!activeFlow) return;
    const exitMsg: Message = {
      role: "assistant",
      content: `Tudo bem! Saindo do guia "${activeFlow.title}". Se precisar retomar ou tiver dúvidas, é só me perguntar. 😊`,
    };
    setMessages(prev => [...prev, exitMsg]);
    setActiveFlow(null);
    setFlowStep(0);
    setCompletedSteps(new Set());
  }

  function markStepDone() {
    if (!activeFlow) return;
    const newCompleted = new Set(completedSteps);
    newCompleted.add(flowStep);
    setCompletedSteps(newCompleted);

    if (flowStep < activeFlow.steps.length - 1) {
      setFlowStep(flowStep + 1);
    } else {
      const doneMsg: Message = {
        role: "assistant",
        content: `🎉 Parabéns! Você concluiu o guia "${activeFlow.title}" com sucesso!\n\nSe precisar de mais ajuda ou quiser explorar outras funcionalidades, estou aqui.`,
      };
      setMessages(prev => [...prev, doneMsg]);
      saveHistory([...messages, doneMsg]);
      setActiveFlow(null);
      setFlowStep(0);
      setCompletedSteps(new Set());
    }
  }

  async function sendMessage(text?: string) {
    const content = (text || input).trim();
    if (!content || loading) return;

    if (activeFlow) {
      exitFlow();
    }

    hasInteractedRef.current = true;
    const userMessage: Message = { role: "user", content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const apiMessages = newMessages
      .filter(m => !m.separator)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${BASE}api/dental/support-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const data = await res.json();
      const reply = data.reply || "Desculpe, não consegui processar sua mensagem. Tente novamente.";

      const withReply = [...newMessages, { role: "assistant" as const, content: reply }];
      setMessages(withReply);
      saveHistory(withReply);

      if (!open || minimized) {
        setHasNewMessage(true);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erro de conexão. Verifique sua internet e tente novamente." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function formatContent(content: string) {
    return content.split("\n").map((line, i) => (
      <span key={i}>
        {line}
        {i < content.split("\n").length - 1 && <br />}
      </span>
    ));
  }

  const realMessages = messages.filter(m => !m.separator);
  const hasUserMessages = realMessages.some(m => m.role === "user");
  const showQuickSuggestions = historyLoaded && !hasUserMessages && !loading && !proactiveTyping && !activeFlow;

  return (
    <>
      {open && (
        <div
          className={`fixed bottom-20 right-4 z-50 w-[340px] sm:w-[390px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ${
            minimized ? "h-14" : "h-[560px]"
          }`}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-teal-500 to-emerald-500 rounded-t-2xl cursor-pointer"
            onClick={() => setMinimized(!minimized)}
          >
            <div className="flex items-center gap-2">
              <img src="/odontoflow-logo.png" alt="OdontoFlow" className="w-8 h-8 rounded-full object-cover shadow-sm" />
              <div>
                <p className="text-sm font-semibold text-white leading-none">Tutor IA do OdontoFlow</p>
                {(loading || proactiveTyping) ? (
                  <p className="text-xs text-white/80 leading-none mt-0.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                    digitando...
                  </p>
                ) : activeFlow ? (
                  <p className="text-xs text-white/70 leading-none mt-0.5">
                    Guia: {activeFlow.title}
                  </p>
                ) : (
                  <p className="text-xs text-white/60 leading-none mt-0.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-300" />
                    online
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {activeFlow && (
                <button
                  onClick={(e) => { e.stopPropagation(); exitFlow(); }}
                  className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
                  title="Sair do guia"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-white" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); clearHistory(); }}
                className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
                title="Nova conversa"
              >
                <RefreshCw className="w-3.5 h-3.5 text-white" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setMinimized(!minimized); }}
                className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5 text-white" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              <div className="flex-1 overflow-y-auto px-3 py-3" ref={scrollRef}>
                <style>{`
                  @keyframes tutor-bounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                    30% { transform: translateY(-5px); opacity: 1; }
                  }
                  .tutor-dot {
                    width: 7px; height: 7px; border-radius: 50%;
                    background: currentColor;
                    animation: tutor-bounce 1.2s ease-in-out infinite;
                  }
                  .tutor-dot:nth-child(2) { animation-delay: 0.2s; }
                  .tutor-dot:nth-child(3) { animation-delay: 0.4s; }
                `}</style>
                <div className="space-y-3">
                  {messages.map((msg, i) => {
                    if (msg.separator) {
                      return (
                        <div key={i} className="flex items-center gap-2 py-1">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] text-muted-foreground shrink-0 px-1">{msg.content}</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        {msg.role === "assistant" && (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                            <Bot className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                        <div
                          className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-teal-500 text-white rounded-tr-sm"
                              : "bg-muted text-foreground rounded-tl-sm"
                          }`}
                        >
                          {formatContent(msg.content)}
                        </div>
                        {msg.role === "user" && (
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(loading || proactiveTyping) && (
                    <div className="flex gap-2 justify-start items-end">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shrink-0">
                        <Bot className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1 text-muted-foreground">
                        <div className="tutor-dot" />
                        <div className="tutor-dot" />
                        <div className="tutor-dot" />
                      </div>
                    </div>
                  )}
                </div>

                {activeFlow && (
                  <div className="mt-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/30 overflow-hidden">
                    <div className="px-3 py-2 bg-teal-100 dark:bg-teal-900/40 border-b border-teal-200 dark:border-teal-800 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{activeFlow.emoji}</span>
                        <span className="text-xs font-semibold text-teal-800 dark:text-teal-200">{activeFlow.title}</span>
                      </div>
                      <span className="text-[10px] text-teal-600 dark:text-teal-400 font-medium">
                        Passo {flowStep + 1} de {activeFlow.steps.length}
                      </span>
                    </div>

                    <div className="px-3 py-2.5">
                      <div className="flex gap-1 mb-2.5">
                        {activeFlow.steps.map((_, idx) => (
                          <div
                            key={idx}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              completedSteps.has(idx)
                                ? "bg-emerald-500"
                                : idx === flowStep
                                ? "bg-teal-400"
                                : "bg-teal-100 dark:bg-teal-900"
                            }`}
                          />
                        ))}
                      </div>

                      <div className="flex items-start gap-2 mb-2">
                        <div className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center shrink-0 mt-0.5">
                          {completedSteps.has(flowStep) ? (
                            <CheckCircle2 className="w-3 h-3 text-white" />
                          ) : (
                            <span className="text-[10px] font-bold text-white">{flowStep + 1}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground leading-snug">
                            {activeFlow.steps[flowStep].title}
                          </p>
                          <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                            {activeFlow.steps[flowStep].description}
                          </p>
                          {activeFlow.steps[flowStep].tip && (
                            <p className="text-[11px] text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-900/50 rounded-lg px-2 py-1 mt-1.5 leading-snug">
                              💡 {activeFlow.steps[flowStep].tip}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        onClick={markStepDone}
                        className="w-full h-8 text-xs bg-teal-500 hover:bg-teal-600 text-white rounded-lg flex items-center gap-1.5"
                      >
                        {flowStep < activeFlow.steps.length - 1 ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Feito! Próximo passo
                            <ChevronRight className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Concluir guia
                          </>
                        )}
                      </Button>

                      <button
                        onClick={exitFlow}
                        className="w-full text-[11px] text-muted-foreground hover:text-foreground mt-1.5 text-center transition-colors"
                      >
                        Sair do guia e voltar ao chat
                      </button>
                    </div>
                  </div>
                )}

                {showQuickSuggestions && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground px-0.5">Guias passo a passo:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FLOW_QUICK_SUGGESTIONS.map((s) => (
                        <button
                          key={s.flowId}
                          onClick={() => startFlow(s.flowId)}
                          className="text-xs px-2.5 py-1 rounded-full border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 transition-colors flex items-center gap-1"
                        >
                          {FLOWS.find(f => f.id === s.flowId)?.emoji} {s.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground px-0.5 mt-1">Ou pergunte livremente:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TEXT_QUICK_SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => sendMessage(s)}
                          className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-3 pb-3 pt-2 border-t border-border">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeFlow ? "Dúvida sobre este passo?" : "Escreva sua dúvida..."}
                    className="h-9 rounded-xl text-sm"
                    disabled={loading}
                  />
                  <Button
                    size="sm"
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    className="h-9 w-9 p-0 rounded-xl bg-teal-500 hover:bg-teal-600 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => { setOpen(true); setMinimized(false); setHasNewMessage(false); }}
        className="fixed bottom-4 right-4 z-50 w-13 h-13 rounded-full shadow-lg bg-gradient-to-br from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        style={{ width: 52, height: 52 }}
        title="Tutor IA — clique para ajuda"
      >
        {open ? (
          <X className="w-5 h-5 text-white" />
        ) : (
          <>
            <img src="/odontoflow-logo.png" alt="OdontoFlow" className="absolute inset-0 w-full h-full object-cover rounded-full" />
            {hasNewMessage && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-pulse" />
            )}
          </>
        )}
      </button>
    </>
  );
}
