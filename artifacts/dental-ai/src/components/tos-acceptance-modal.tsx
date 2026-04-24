/**
 * Task #15 + #17 — Modal bloqueante de aceite dos documentos legais.
 *
 * - Verifica `/api/dental/tos/needs-acceptance` ao montar (após login).
 * - Se houver documentos pendentes, abre dialog modal não-fechável que cobre o
 *   app e exibe os documentos sequencialmente: primeiro o Termo de Uso (kind
 *   "tos") e depois o Contrato de Assinatura (kind "subscription").
 * - Cada etapa exige rolagem até o fim e clique em "Li e concordo", e dispara
 *   um POST separado por documento.
 * - Usuários antigos que já aceitaram o TOS pulam direto para o contrato novo.
 * - Enquanto a checagem está em andamento renderizamos um overlay neutro de
 *   loading para evitar flash do dashboard atrás (que está bloqueado por 451).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hasAuthToken } from "@/lib/api-config";

type DocKind = "tos" | "subscription";

interface PendingDoc {
  kind: DocKind;
  versionId: number;
  version: string;
  title: string;
  publishedAt: string;
}

interface TosNeedsResponse {
  needsAcceptance: boolean;
  pending?: PendingDoc[];
}

interface TosCurrentResponse {
  id: number;
  kind: DocKind;
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

const API_BASE = `${import.meta.env.BASE_URL}api/dental/tos`;

type LoadState = "checking" | "ok" | "needs";

export function TosAcceptanceModal({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<LoadState>(enabled && hasAuthToken() ? "checking" : "ok");
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const [currentDoc, setCurrentDoc] = useState<TosCurrentResponse | null>(null);
  const [docIndex, setDocIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial check after login.
  useEffect(() => {
    if (!enabled || !hasAuthToken()) {
      setState("ok");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/needs-acceptance`, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setState("ok");
          return;
        }
        const data = (await r.json()) as TosNeedsResponse;
        if (cancelled) return;
        const list = data.pending ?? [];
        if (!data.needsAcceptance || list.length === 0) {
          setState("ok");
          return;
        }
        setPending(list);
        setDocIndex(0);
        setState("needs");
      } catch {
        if (!cancelled) setState("ok");
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  // Load the current document whenever the index advances.
  useEffect(() => {
    if (state !== "needs") return;
    const target = pending[docIndex];
    if (!target) return;
    let cancelled = false;
    setCurrentDoc(null);
    setScrolledToEnd(false);
    (async () => {
      try {
        const cr = await fetch(`${API_BASE}/current?kind=${target.kind}`, { cache: "no-store" });
        if (!cr.ok) {
          if (!cancelled) setState("ok");
          return;
        }
        const cdata = (await cr.json()) as TosCurrentResponse;
        if (cancelled) return;
        setCurrentDoc(cdata);
        // Reset scroll position on the next paint.
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
      } catch {
        if (!cancelled) setState("ok");
      }
    })();
    return () => { cancelled = true; };
  }, [state, docIndex, pending]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 24) setScrolledToEnd(true);
  }

  async function handleAccept() {
    if (!currentDoc) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: currentDoc.kind }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const isLast = docIndex >= pending.length - 1;
      if (isLast) {
        toast({
          title: "Documentos aceitos",
          description:
            "Obrigado. Você pode baixar uma cópia em PDF em Configurações → Termos & Contratos.",
        });
        setState("ok");
        setTimeout(() => {
          window.location.href = `${import.meta.env.BASE_URL}settings?tab=legal`;
        }, 600);
      } else {
        toast({
          title: "Documento aceito",
          description: "Falta apenas o próximo documento.",
        });
        setDocIndex((i) => i + 1);
        setSubmitting(false);
      }
    } catch {
      toast({
        title: "Erro ao registrar aceite",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  if (state === "ok") return null;

  if (state === "checking" || !currentDoc) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
        data-testid="tos-checking-overlay"
      >
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Verificando documentos legais…</span>
        </div>
      </div>
    );
  }

  const totalSteps = pending.length;
  const stepNumber = docIndex + 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tos-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      data-testid="tos-acceptance-modal"
    >
      <div className="w-full max-w-2xl bg-background border border-border rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-border">
          {totalSteps > 1 && (
            <p
              className="text-xs uppercase tracking-wider text-muted-foreground mb-1"
              data-testid="tos-step-indicator"
            >
              Etapa {stepNumber} de {totalSteps}
            </p>
          )}
          <div className="h-1 w-10 rounded-full bg-primary mb-3" aria-hidden />
          <h2 id="tos-modal-title" className="text-2xl font-semibold tracking-tight">
            {currentDoc.title}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Documento atualizado em{" "}
            {new Date(currentDoc.publishedAt).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
            . Após o aceite, uma cópia em PDF fica disponível em <strong>Configurações → Termos &amp; Contratos</strong>.
          </p>
        </div>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-8 py-6 text-[13.5px] leading-7 whitespace-pre-wrap text-foreground/90 [font-feature-settings:'liga','kern'] text-justify"
          data-testid="tos-content-scroll"
        >
          {currentDoc.content}
        </div>
        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground flex-1">
            {scrolledToEnd
              ? "Você leu o documento até o fim. Pode aceitar."
              : "Role o documento até o fim para habilitar o botão."}
          </p>
          <Button
            onClick={handleAccept}
            disabled={!scrolledToEnd || submitting}
            data-testid="button-accept-tos"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Li e concordo
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TosAcceptanceModal;
