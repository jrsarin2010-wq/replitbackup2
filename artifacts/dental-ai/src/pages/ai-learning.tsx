import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Check, X, Pencil, Loader2 } from "lucide-react";

type Status = "pending" | "approved" | "rejected";

type Memory = {
  id: number; memoryType: string; content: string; editedContent: string | null;
  status: Status; contactPhone: string; createdAt: string;
};
type Objection = {
  id: number; category: string; objection: string; counterArgument: string | null;
  editedCounterArgument: string | null; successCount: number; totalCount: number;
  status: Status; createdAt: string;
};
type Knowledge = {
  id: number; question: string; answer: string; editedAnswer: string | null;
  category: string; frequency: number; status: Status; createdAt: string;
};
type StrategyRanking = {
  ranking: Array<{ strategy: string; total: number; converted: number; rate: number }>;
  sampleSize: number;
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pendentes",
  approved: "Aprovados",
  rejected: "Rejeitados",
};

function StatusFilter({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div className="flex gap-2">
      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
        <Button
          key={s}
          variant={value === s ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(s)}
          data-testid={`btn-filter-${s}`}
        >
          {STATUS_LABEL[s]}
        </Button>
      ))}
    </div>
  );
}

function ReviewCard({
  title, body, badges, originalText, editedText, onApprove, onReject, onSaveEdit, isPending,
  testIdPrefix,
}: {
  title: string;
  body: React.ReactNode;
  badges: React.ReactNode;
  originalText: string;
  editedText: string | null;
  onApprove: () => void;
  onReject: () => void;
  onSaveEdit: (newText: string) => void;
  isPending: boolean;
  testIdPrefix: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editedText ?? originalText);

  return (
    <Card className="border-border" data-testid={`${testIdPrefix}-card`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="flex gap-1 flex-wrap justify-end">{badges}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {body}
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              data-testid={`${testIdPrefix}-edit-textarea`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => { onSaveEdit(draft); setEditing(false); }}
                disabled={isPending}
                data-testid={`${testIdPrefix}-save-edit`}
              >
                Salvar edição
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="default"
              onClick={onApprove}
              disabled={isPending}
              data-testid={`${testIdPrefix}-approve`}
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              data-testid={`${testIdPrefix}-edit`}
            >
              <Pencil className="w-3 h-3 mr-1" /> Editar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onReject}
              disabled={isPending}
              data-testid={`${testIdPrefix}-reject`}
            >
              <X className="w-3 h-3 mr-1" /> Rejeitar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const variant = status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";
  return <Badge variant={variant} className="text-[10px] capitalize">{status}</Badge>;
}

function useLearningQuery<T>(kind: "memories" | "objections" | "knowledge", status: Status) {
  return useQuery<T[]>({
    queryKey: ["ai-learning", kind, status],
    queryFn: async () => {
      const res = await fetch(`/api/dental/ai-learning/${kind}?status=${status}`);
      if (!res.ok) throw new Error("Falha ao carregar");
      return res.json();
    },
  });
}

function useLearningMutation(kind: "memories" | "objections" | "knowledge") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: number; body?: Record<string, unknown>; method?: "PATCH" | "DELETE" }) => {
      const res = await fetch(`/api/dental/ai-learning/${kind}/${args.id}`, {
        method: args.method ?? "PATCH",
        headers: { "Content-Type": "application/json" },
        body: args.method === "DELETE" ? undefined : JSON.stringify(args.body ?? {}),
      });
      if (!res.ok) throw new Error("Falha ao atualizar");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-learning", kind] }),
  });
}

function MemoriesTab() {
  const [status, setStatus] = useState<Status>("pending");
  const { data, isLoading } = useLearningQuery<Memory>("memories", status);
  const mut = useLearningMutation("memories");

  return (
    <div className="space-y-4">
      <StatusFilter value={status} onChange={setStatus} />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma memória {STATUS_LABEL[status].toLowerCase()}.</p>
      )}
      <div className="grid gap-3">
        {data?.map((m) => (
          <ReviewCard
            key={m.id}
            testIdPrefix={`memory-${m.id}`}
            title={`Memória — ${m.memoryType}`}
            body={
              <div>
                <p className="whitespace-pre-wrap">{m.editedContent ?? m.content}</p>
                {m.editedContent && (
                  <p className="mt-1 text-xs text-muted-foreground">Original: {m.content}</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Contato: {m.contactPhone} • {new Date(m.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
            }
            badges={<><StatusBadge status={m.status} /></>}
            originalText={m.content}
            editedText={m.editedContent}
            onApprove={() => mut.mutate({ id: m.id, body: { status: "approved" } })}
            onReject={() => mut.mutate({ id: m.id, body: { status: "rejected" } })}
            onSaveEdit={(text) => mut.mutate({ id: m.id, body: { editedContent: text, status: "approved" } })}
            isPending={mut.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function ObjectionsTab() {
  const [status, setStatus] = useState<Status>("pending");
  const { data, isLoading } = useLearningQuery<Objection>("objections", status);
  const mut = useLearningMutation("objections");

  return (
    <div className="space-y-4">
      <StatusFilter value={status} onChange={setStatus} />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma objeção {STATUS_LABEL[status].toLowerCase()}.</p>
      )}
      <div className="grid gap-3">
        {data?.map((o) => {
          const counter = o.editedCounterArgument ?? o.counterArgument ?? "";
          const rate = o.totalCount > 0 ? Math.round((o.successCount / o.totalCount) * 100) : 0;
          return (
            <ReviewCard
              key={o.id}
              testIdPrefix={`objection-${o.id}`}
              title={`Objeção — ${o.category}`}
              body={
                <div className="space-y-2">
                  <p><span className="font-medium">Paciente diz:</span> {o.objection}</p>
                  <p><span className="font-medium">Contra-argumento:</span> {counter || <em className="text-muted-foreground">— sem contra-argumento aprendido —</em>}</p>
                  {o.editedCounterArgument && o.counterArgument && (
                    <p className="text-xs text-muted-foreground">Original: {o.counterArgument}</p>
                  )}
                </div>
              }
              badges={
                <>
                  <Badge variant="outline" className="text-[10px]">freq {o.totalCount}x</Badge>
                  <Badge variant="outline" className="text-[10px]">{rate}% conv</Badge>
                  <StatusBadge status={o.status} />
                </>
              }
              originalText={o.counterArgument ?? ""}
              editedText={o.editedCounterArgument}
              onApprove={() => mut.mutate({ id: o.id, body: { status: "approved" } })}
              onReject={() => mut.mutate({ id: o.id, body: { status: "rejected" } })}
              onSaveEdit={(text) => mut.mutate({ id: o.id, body: { editedCounterArgument: text, status: "approved" } })}
              isPending={mut.isPending}
            />
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeTab() {
  const [status, setStatus] = useState<Status>("pending");
  const { data, isLoading } = useLearningQuery<Knowledge>("knowledge", status);
  const mut = useLearningMutation("knowledge");

  return (
    <div className="space-y-4">
      <StatusFilter value={status} onChange={setStatus} />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma resposta {STATUS_LABEL[status].toLowerCase()}.</p>
      )}
      <div className="grid gap-3">
        {data?.map((k) => {
          const answer = k.editedAnswer ?? k.answer;
          return (
            <ReviewCard
              key={k.id}
              testIdPrefix={`knowledge-${k.id}`}
              title={`Pergunta — ${k.category}`}
              body={
                <div className="space-y-2">
                  <p><span className="font-medium">P:</span> {k.question}</p>
                  <p><span className="font-medium">R:</span> {answer}</p>
                  {k.editedAnswer && (
                    <p className="text-xs text-muted-foreground">Resposta original: {k.answer}</p>
                  )}
                </div>
              }
              badges={
                <>
                  <Badge variant="outline" className="text-[10px]">vista {k.frequency}x</Badge>
                  <StatusBadge status={k.status} />
                </>
              }
              originalText={k.answer}
              editedText={k.editedAnswer}
              onApprove={() => mut.mutate({ id: k.id, body: { status: "approved" } })}
              onReject={() => mut.mutate({ id: k.id, body: { status: "rejected" } })}
              onSaveEdit={(text) => mut.mutate({ id: k.id, body: { editedAnswer: text, status: "approved" } })}
              isPending={mut.isPending}
            />
          );
        })}
      </div>
    </div>
  );
}

function StrategiesTab() {
  const { data, isLoading } = useQuery<StrategyRanking>({
    queryKey: ["ai-learning", "strategies"],
    queryFn: async () => {
      const res = await fetch("/api/dental/ai-learning/strategies");
      if (!res.ok) throw new Error("Falha ao carregar");
      return res.json();
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!data || !data.ranking.length) {
    return <p className="text-sm text-muted-foreground">Sem dados de estratégias ainda. Após algumas conversas, o ranking aparece aqui.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Amostra: {data.sampleSize} usos registrados</p>
      <div className="grid gap-2">
        {data.ranking.map((s) => (
          <Card key={s.strategy}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{s.strategy}</p>
                <p className="text-xs text-muted-foreground">{s.total} usos • {s.converted} conversões</p>
              </div>
              <Badge variant="default" className="text-sm">{s.rate}%</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AiLearningPage() {
  return (
    <div className="container mx-auto py-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Aprendizado da IA</h1>
          <p className="text-sm text-muted-foreground">
            Revise o que a IA aprendeu antes de virar parte das próximas conversas. Itens pendentes não vão pro prompt até serem aprovados.
          </p>
        </div>
      </div>

      <Tabs defaultValue="memories" className="space-y-4">
        <TabsList>
          <TabsTrigger value="memories" data-testid="tab-memories">Memórias</TabsTrigger>
          <TabsTrigger value="objections" data-testid="tab-objections">Objeções</TabsTrigger>
          <TabsTrigger value="knowledge" data-testid="tab-knowledge">Conhecimento</TabsTrigger>
          <TabsTrigger value="strategies" data-testid="tab-strategies">Estratégias</TabsTrigger>
        </TabsList>
        <TabsContent value="memories"><MemoriesTab /></TabsContent>
        <TabsContent value="objections"><ObjectionsTab /></TabsContent>
        <TabsContent value="knowledge"><KnowledgeTab /></TabsContent>
        <TabsContent value="strategies"><StrategiesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
