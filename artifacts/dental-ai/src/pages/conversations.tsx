import { useState, useEffect, useRef, useCallback } from "react";
import { useListConversations, useGetConversation, useListMessages, useSendMessage } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageSquare, Send, ArrowLeft, User, Bot, Phone, AlertTriangle, Play, UserCheck, Clock, Hand, AtSign,
} from "lucide-react";
import { ContactAvatar } from "@/components/ui/contact-avatar";

function useCountdown(expiresAt: string | null | undefined) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!expiresAt) { setRemaining(""); return; }
    function tick() {
      const diff = new Date(expiresAt!).getTime() - Date.now();
      if (diff <= 0) { setRemaining("0:00"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, "0")}`);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return remaining;
}

function SentimentDot({ sentiment }: { sentiment?: string }) {
  if (!sentiment || sentiment === "neutral") return null;
  const colors: Record<string, string> = {
    positive: "bg-green-500",
    negative: "bg-orange-500",
    critical: "bg-red-500",
  };
  const titles: Record<string, string> = {
    positive: "Positivo",
    negative: "Insatisfeito",
    critical: "Critico",
  };
  return (
    <span title={titles[sentiment] || sentiment} className={`inline-block w-2 h-2 rounded-full ${colors[sentiment] || "bg-gray-400"}`} />
  );
}

function ConversationList({ conversations, selected, onSelect }: {
  conversations: Array<{ id: number; contactPhone: string; contactName?: string; contactProfilePicUrl?: string; contactType: string; status: string; sentiment?: string; lastMessageAt?: string; lastMessagePreview?: string; unreadCount: number }>;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="space-y-1">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`w-full text-left p-3 rounded-xl transition-all duration-200 ${
            conv.status === "escalated"
              ? "bg-red-500/5 border border-red-500/20"
              : conv.status === "human_takeover"
                ? "bg-blue-500/5 border border-blue-500/20"
                : selected === conv.id
                  ? "bg-primary/10 border border-primary/20 shadow-sm"
                  : "hover:bg-muted/40 border border-transparent"
          }`}
        >
          <div className="flex items-center gap-3">
            <ContactAvatar name={conv.contactName || conv.contactPhone} profilePicUrl={conv.contactProfilePicUrl} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[13px] font-bold truncate">{conv.contactName || conv.contactPhone}</p>
                  <SentimentDot sentiment={conv.sentiment} />
                </div>
                {conv.unreadCount > 0 && (
                  <Badge className="h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full premium-badge border-0">
                    {conv.unreadCount}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5 font-medium">
                {conv.lastMessagePreview || "Sem mensagens"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="text-[9px] rounded-md font-semibold">
              {conv.contactType === "patient" ? "Paciente" : conv.contactType === "lead" ? "Lead" : "Contato"}
            </Badge>
            {conv.status === "escalated" && (
              <Badge variant="destructive" className="text-[9px] rounded-md font-semibold">
                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Escalado
              </Badge>
            )}
            {conv.status === "human_takeover" && (
              <Badge className="text-[9px] rounded-md font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
                <UserCheck className="w-2.5 h-2.5 mr-0.5" /> Dentista respondendo
              </Badge>
            )}
            {conv.lastMessageAt && (
              <span className="text-[10px] text-muted-foreground/50 ml-auto font-medium">
                {new Date(conv.lastMessageAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </button>
      ))}
      {conversations.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhuma conversa ainda</p>
        </div>
      )}
    </div>
  );
}

interface Professional {
  id: number;
  name: string;
  instagramUrl?: string | null;
  isOwner: boolean;
}

function useProfessionals() {
  return useQuery<Professional[]>({
    queryKey: ["/api/dental/professionals"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/dental/professionals?includeInactive=false`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json() as { professionals?: Professional[] } | Professional[];
      return Array.isArray(data) ? data : (data.professionals ?? []);
    },
    staleTime: 5 * 60 * 1000,
  });
}

function getInstagramHandle(rawUrl: string): string {
  const cleaned = rawUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "");
  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}

function ChatView({ conversationId, onBack }: { conversationId: number; onBack: () => void }) {
  const [message, setMessage] = useState("");
  const [socialProofOpen, setSocialProofOpen] = useState(false);
  const [socialProofMessage, setSocialProofMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: conversation } = useGetConversation(conversationId);
  const { data: messagesData } = useListMessages(conversationId, {});
  const sendMut = useSendMessage();
  const { data: professionals } = useProfessionals();

  const messages = (messagesData as Array<{ id: number; content: string; direction: string; audioUrl?: string; createdAt: string }>) || [];
  const conv = conversation as { id: number; contactPhone: string; contactName?: string; contactProfilePicUrl?: string; contactType: string; status: string; sentiment?: string; escalationReason?: string; humanTakeoverExpiresAt?: string | null; leadId?: number | null; lastModelUsed?: string | null } | undefined;
  const countdown = useCountdown(conv?.status === "human_takeover" ? conv?.humanTakeoverExpiresAt : null);

  const { data: leadData } = useQuery<{ professionalId?: number | null } | null>({
    queryKey: ["/api/dental/leads", conv?.leadId],
    enabled: !!conv?.leadId && conv?.contactType === "lead",
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!conv?.leadId) return null;
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/dental/leads/${conv.leadId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ professionalId?: number | null }>;
    },
  });

  function resolveInstagramProfessional(): { handle: string; name: string } | null {
    const profs = professionals || [];
    let prof: Professional | null = null;
    if (leadData?.professionalId) {
      const assigned = profs.find((p) => p.id === leadData.professionalId) || null;
      if (assigned?.instagramUrl) prof = assigned;
    }
    if (!prof) {
      prof = profs.find((p) => p.isOwner && p.instagramUrl) || null;
    }
    if (!prof) {
      prof = profs.find((p) => p.instagramUrl) || null;
    }
    if (!prof?.instagramUrl) return null;
    return { handle: getInstagramHandle(prof.instagramUrl), name: prof.name };
  }

  const profInsta = resolveInstagramProfessional();
  const instagramHandle = profInsta?.handle || null;

  function openSocialProof() {
    const profName = profInsta?.name || "o profissional";
    const handle = instagramHandle || "";
    const contactName = conv?.contactName ? conv.contactName.split(" ")[0] : "";
    const greeting = contactName ? `Oi ${contactName}! ` : "";
    setSocialProofMessage(`${greeting}Olha o trabalho do(a) ${profName} antes de agendar, vale a pena dar uma olhada! ${handle.startsWith("@") ? `instagram.com/${handle.replace("@", "")}` : handle}`);
    setSocialProofOpen(true);
  }

  async function handleSendSocialProof() {
    if (!socialProofMessage.trim()) return;
    try {
      await sendMut.mutateAsync({ conversationId, data: { content: socialProofMessage } });
      setSocialProofOpen(false);
      setSocialProofMessage("");
      qc.invalidateQueries({ queryKey: [`/api/dental/conversations/${conversationId}/messages`] });
      qc.invalidateQueries({ queryKey: ["/api/dental/conversations"] });
      toast({ title: "Prova social enviada!" });
    } catch (e: unknown) {
      toast({ title: "Erro ao enviar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!message.trim()) return;
    try {
      await sendMut.mutateAsync({
        conversationId,
        data: { content: message },
      });
      setMessage("");
      qc.invalidateQueries({ queryKey: [`/api/dental/conversations/${conversationId}/messages`] });
      qc.invalidateQueries({ queryKey: ["/api/dental/conversations"] });
    } catch (e: unknown) {
      toast({ title: "Erro ao enviar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden rounded-xl">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <ContactAvatar name={conv?.contactName || conv?.contactPhone || "?"} profilePicUrl={(conv as Record<string, unknown>)?.contactProfilePicUrl as string | undefined} size="sm" />
        <div>
          <p className="text-[13px] font-bold">{conv?.contactName || conv?.contactPhone || "..."}</p>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 font-medium">
            <Phone className="w-3 h-3" />
            {conv?.contactPhone || ""}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <SentimentDot sentiment={conv?.sentiment} />
          <Badge variant="outline" className="text-[9px] rounded-md font-semibold">
            {conv?.contactType === "patient" ? "Paciente" : conv?.contactType === "lead" ? "Lead" : "Contato"}
          </Badge>
          {conv?.lastModelUsed && conv.lastModelUsed !== "gpt-5.1" && conv.lastModelUsed !== "gpt-5.4-mini" && (
            <Badge
              variant="outline"
              title={`Modelo de IA usado: ${conv.lastModelUsed}`}
              className="text-[9px] rounded-md font-semibold border-violet-400/40 text-violet-600 dark:text-violet-400 bg-violet-500/5"
            >
              {conv.lastModelUsed === "gpt-5.4" ? "IA Pro" : conv.lastModelUsed}
            </Badge>
          )}
          {instagramHandle && conv?.contactType === "lead" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] rounded-md border-pink-500/30 text-pink-600 dark:text-pink-400 hover:bg-pink-500/10"
              onClick={openSocialProof}
            >
              <AtSign className="w-3 h-3 mr-1" /> Enviar Prova Social
            </Button>
          )}
          {conv?.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] rounded-md border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              onClick={async () => {
                try {
                  const base = import.meta.env.BASE_URL || "/";
                  await fetch(`${base}api/dental/conversations/${conversationId}/takeover`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                  });
                  qc.invalidateQueries({ queryKey: [`/api/dental/conversations/${conversationId}`] });
                  qc.invalidateQueries({ queryKey: ["/api/dental/conversations"] });
                  toast({ title: "Conversa assumida", description: "Voce esta no controle. A IA retomara automaticamente." });
                } catch {
                  toast({ title: "Erro", description: "Nao foi possivel assumir a conversa.", variant: "destructive" });
                }
              }}
            >
              <Hand className="w-3 h-3 mr-1" /> Assumir
            </Button>
          )}
        </div>
      </div>

      {conv?.status === "escalated" && (
        <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">IA pausada — atendimento manual necessario</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] rounded-md border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
            onClick={async () => {
              try {
                const base = import.meta.env.BASE_URL || "/";
                await fetch(`${base}api/dental/conversations/${conversationId}/resume`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                });
                qc.invalidateQueries({ queryKey: [`/api/dental/conversations/${conversationId}`] });
                qc.invalidateQueries({ queryKey: ["/api/dental/conversations"] });
                toast({ title: "IA reativada", description: "A IA voltou a responder nesta conversa." });
              } catch {
                toast({ title: "Erro", description: "Nao foi possivel reativar a IA.", variant: "destructive" });
              }
            }}
          >
            <Play className="w-2.5 h-2.5 mr-1" /> Reativar IA
          </Button>
        </div>
      )}

      {conv?.status === "human_takeover" && (
        <div className="px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <UserCheck className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">Dentista respondendo</span>
            {countdown && (
              <span className="text-[11px] font-mono bg-blue-500/15 px-1.5 py-0.5 rounded-md">
                <Clock className="w-3 h-3 inline mr-0.5" />{countdown}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] rounded-md border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
            onClick={async () => {
              try {
                const base = import.meta.env.BASE_URL || "/";
                await fetch(`${base}api/dental/conversations/${conversationId}/resume`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                });
                qc.invalidateQueries({ queryKey: [`/api/dental/conversations/${conversationId}`] });
                qc.invalidateQueries({ queryKey: ["/api/dental/conversations"] });
                toast({ title: "IA reativada", description: "A IA voltou a responder nesta conversa." });
              } catch {
                toast({ title: "Erro", description: "Nao foi possivel reativar a IA.", variant: "destructive" });
              }
            }}
          >
            <Play className="w-2.5 h-2.5 mr-1" /> Devolver para IA
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3 max-w-2xl mx-auto">
          {messages.map((msg: { id: number; content: string; direction: string; audioUrl?: string; createdAt: string }) => {
            const isOutbound = msg.direction === "outbound";
            return (
              <div key={msg.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                <div className={`flex items-end gap-2 max-w-[85%] ${isOutbound ? "flex-row-reverse" : ""}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isOutbound ? "bg-primary/10" : "bg-muted"
                  }`}>
                    {isOutbound ? <Bot className="w-3 h-3 text-primary" /> : <User className="w-3 h-3 text-muted-foreground" />}
                  </div>
                  <div className={`px-3 py-2 rounded-2xl text-sm ${
                    isOutbound
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${isOutbound ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-card">
        <div className="flex gap-2 max-w-2xl mx-auto">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Digite uma mensagem..."
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={!message.trim() || sendMut.isPending} size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Dialog open={socialProofOpen} onOpenChange={setSocialProofOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AtSign className="w-4 h-4 text-pink-500" /> Enviar Prova Social
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {instagramHandle && (
              <p className="text-[12px] text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
                Instagram do profissional: <span className="font-semibold text-pink-600 dark:text-pink-400">{instagramHandle}</span>
              </p>
            )}
            <Textarea
              value={socialProofMessage}
              onChange={(e) => setSocialProofMessage(e.target.value)}
              placeholder="Mensagem com o Instagram do profissional..."
              rows={4}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground/60">Edite a mensagem acima antes de enviar.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSocialProofOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSendSocialProof}
              disabled={!socialProofMessage.trim() || sendMut.isPending}
              className="gap-1"
            >
              <Send className="w-3 h-3" /> Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConversationsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: convData, isLoading } = useListConversations({});

  const conversations = (convData as Array<{ id: number; contactPhone: string; contactName?: string; contactProfilePicUrl?: string; contactType: string; status: string; sentiment?: string; lastMessageAt?: string; lastMessagePreview?: string; unreadCount: number }>) || [];

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      <div className={`w-full md:w-[340px] md:border-r border-border flex flex-col ${selectedId ? "hidden md:flex" : "flex"}`}>
        <div className="p-4 border-b border-border/50">
          <h1 className="text-lg font-extrabold tracking-tight gradient-text-warm">Conversas</h1>
          <p className="text-[11px] text-muted-foreground/60 font-medium mt-0.5">{conversations.length} conversas</p>
        </div>
        <ScrollArea className="flex-1 p-2">
          <ConversationList conversations={conversations} selected={selectedId} onSelect={setSelectedId} />
        </ScrollArea>
      </div>

      <div className={`flex-1 ${selectedId ? "flex flex-col" : "hidden md:flex md:items-center md:justify-center"}`}>
        {selectedId ? (
          <ChatView conversationId={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="text-center text-muted-foreground">
            <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="text-sm">Selecione uma conversa para visualizar</p>
          </div>
        )}
      </div>
    </div>
  );
}
