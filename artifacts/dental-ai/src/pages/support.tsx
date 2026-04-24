import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  LifeBuoy,
  MessageSquarePlus,
  Star,
  Bot,
  Mail,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  ThumbsUp,
} from "lucide-react";

const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function SupportPage() {
  return (
    <div className="p-5 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mt-0.5">
          <LifeBuoy className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Suporte</h1>
          <p className="text-[13px] text-muted-foreground/70 mt-0.5">
            Estamos aqui para ajudar. Escolha a melhor forma de resolver sua dúvida.
          </p>
        </div>
      </div>

      <TutorIASection />
      <SupportMessageSection />
      <FeedbackSection />
    </div>
  );
}

function TutorIASection() {
  return (
    <Card className="rounded-2xl border-primary/20 bg-gradient-to-br from-primary/5 to-emerald-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-[14px] font-bold flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          1. Tutor IA — Suporte instantâneo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          Antes de qualquer coisa, experimente o <strong className="text-foreground">Tutor IA</strong> — nosso assistente virtual
          treinado exclusivamente no OdontoFlow. Ele conhece cada funcionalidade do sistema e responde na hora,
          sem fila de espera.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Sparkles, label: "Resposta imediata", desc: "24h por dia, sem espera" },
            { icon: Bot, label: "Especialista no sistema", desc: "Treinado no OdontoFlow" },
            { icon: ThumbsUp, label: "Sem complicação", desc: "Fale em linguagem normal" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-2.5 p-3 rounded-xl bg-background/60 border border-border/30"
            >
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <item.icon className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[11px] font-bold">{item.label}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/8 border border-primary/15">
          <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-[12px] text-primary font-semibold">
            Clique no ícone de chat no canto inferior direito da tela para abrir o Tutor IA agora.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SupportMessageSection() {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) {
      toast({ title: "Mensagem muito curta", description: "Descreva melhor o problema para que possamos ajudar.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/dental/support/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao enviar");
      setSent(true);
    } catch (err: unknown) {
      toast({
        title: "Erro ao enviar",
        description: err instanceof Error ? err.message : "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-[14px] font-bold flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-500" />
          2. Enviar mensagem para o suporte
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-[15px] font-bold text-foreground">Mensagem enviada!</p>
            <p className="text-[12px] text-muted-foreground text-center max-w-xs leading-relaxed">
              Nossa equipe recebeu sua mensagem e entrará em contato em breve pelo e-mail cadastrado na sua conta.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-[12px]"
              onClick={() => { setSent(false); setMessage(""); }}
            >
              Enviar outra mensagem
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              O Tutor IA não conseguiu resolver? Descreva seu problema com detalhes — quanto mais informações você fornecer, mais rápido conseguimos ajudar.
            </p>
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-foreground/80">Sua mensagem</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Descreva o problema ou dúvida em detalhes... Ex: 'O WhatsApp conecta mas não responde as mensagens dos pacientes...'"
                rows={5}
                maxLength={3000}
                className="text-[13px] resize-none"
              />
              <div className="flex justify-between">
                <p className="text-[10px] text-muted-foreground/50">
                  Sua resposta será enviada ao e-mail cadastrado na conta.
                </p>
                <p className="text-[10px] text-muted-foreground/50">{message.length}/3000</p>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading || message.trim().length < 10}
              className="w-full gap-2"
            >
              <MessageSquarePlus className="w-4 h-4" />
              {loading ? "Enviando..." : "Enviar para o suporte"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  const labels = ["", "Muito ruim", "Ruim", "Regular", "Bom", "Excelente"];
  const display = hovered || value;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className="transition-transform hover:scale-110 focus:outline-none"
          >
            <Star
              className={`w-8 h-8 transition-colors ${
                star <= display
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/20"
              }`}
            />
          </button>
        ))}
      </div>
      {display > 0 && (
        <p className="text-[12px] font-semibold text-amber-500">{labels[display]}</p>
      )}
    </div>
  );
}

function FeedbackSection() {
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      toast({ title: "Selecione uma avaliação", variant: "destructive" });
      return;
    }
    if (message.trim().length < 5) {
      toast({ title: "Comentário muito curto", description: "Escreva pelo menos 5 caracteres.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${basePath}/api/dental/support/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao enviar");
      setSent(true);
    } catch (err: unknown) {
      toast({
        title: "Erro ao enviar feedback",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-[14px] font-bold flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500" />
          Nos ajude a melhorar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <ThumbsUp className="w-8 h-8 text-amber-500" />
            </div>
            <p className="text-[15px] font-bold text-foreground">Obrigado pelo feedback!</p>
            <p className="text-[12px] text-muted-foreground text-center max-w-xs leading-relaxed">
              Sua opinião é muito importante para melhorarmos o OdontoFlow cada vez mais.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-[12px]"
              onClick={() => { setSent(false); setRating(0); setMessage(""); }}
            >
              Enviar outro feedback
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Sua opinião nos ajuda a priorizar melhorias e entregar uma experiência cada vez melhor para sua clínica.
            </p>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-foreground/80">Como você avalia o OdontoFlow?</label>
              <StarRating value={rating} onChange={setRating} />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold text-foreground/80">O que poderíamos melhorar?</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Conta pra gente! O que falta? O que poderia ser mais fácil? O que você mais gosta?"
                rows={4}
                maxLength={2000}
                className="text-[13px] resize-none"
              />
              <p className="text-[10px] text-muted-foreground/50 text-right">{message.length}/2000</p>
            </div>

            <Button
              type="submit"
              variant="outline"
              disabled={loading || rating === 0 || message.trim().length < 5}
              className="w-full gap-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/5 hover:border-amber-500/50"
            >
              <Star className="w-4 h-4" />
              {loading ? "Enviando..." : "Enviar feedback"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
