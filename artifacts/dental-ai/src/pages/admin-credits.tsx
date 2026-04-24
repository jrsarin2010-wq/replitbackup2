import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Coins, Plus, History, Lock } from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";

function adminFetch(path: string, adminKey: string, options?: RequestInit) {
  return fetch(`${BASE}api/dental/audio${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
      ...(options?.headers || {}),
    },
  });
}

interface TenantSummary {
  tenantId: number;
  tenantName: string;
  balance: number;
}

interface CreditTx {
  id: number;
  tenantId: number;
  amount: number;
  type: string;
  description: string | null;
  createdAt: string;
}

export default function AdminCreditsPage() {
  const { toast } = useToast();
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("admin_key") || "");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<TenantSummary[]>([]);
  const [transactions, setTransactions] = useState<CreditTx[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<{ id: number; name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const loadData = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const [sumRes, txRes] = await Promise.all([
        adminFetch("/credits/all", key),
        adminFetch("/credits/transactions/all", key),
      ]);
      if (!sumRes.ok || !txRes.ok) {
        if (sumRes.status === 403 || txRes.status === 403) {
          setAuthenticated(false);
          sessionStorage.removeItem("admin_key");
          toast({ title: "Chave admin invalida", variant: "destructive" });
          return;
        }
        throw new Error("Failed to load data");
      }
      setSummaries(await sumRes.json());
      setTransactions(await txRes.json());
      setAuthenticated(true);
      sessionStorage.setItem("admin_key", key);
    } catch (e) {
      toast({ title: "Erro ao carregar dados", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_key");
    if (saved) {
      loadData(saved);
    }
  }, [loadData]);

  function handleLogin() {
    if (!adminKey.trim()) return;
    loadData(adminKey.trim());
  }

  async function handleAddCredits() {
    if (!selectedTenant || !amount) return;
    try {
      const res = await adminFetch("/credits/add", adminKey, {
        method: "POST",
        body: JSON.stringify({
          tenantId: selectedTenant.id,
          amount: Number(amount),
          description: description || "Creditos adicionados via admin",
        }),
      });
      if (!res.ok) throw new Error("Failed to add credits");
      toast({ title: `${Number(amount).toLocaleString("pt-BR")} creditos adicionados para ${selectedTenant.name}` });
      setDialogOpen(false);
      loadData(adminKey);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  if (!authenticated) {
    return (
      <div className="p-4 md:p-6 max-w-md mx-auto mt-20">
        <Card className="border border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              Acesso Administrativo
            </CardTitle>
            <CardDescription className="text-xs">
              Insira a chave de administrador para gerenciar creditos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Chave Admin</Label>
              <Input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Digite a chave de admin"
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            <Button onClick={handleLogin} disabled={!adminKey.trim() || loading} className="w-full">
              {loading ? "Verificando..." : "Entrar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight gradient-text-warm">Creditos de Audio</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie os creditos de audio IA por clinica</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="gap-2"
          >
            <History className="w-4 h-4" />
            {showHistory ? "Ver Saldos" : "Historico"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setAuthenticated(false); sessionStorage.removeItem("admin_key"); }}
          >
            Sair
          </Button>
        </div>
      </div>

      {!showHistory ? (
        <Card className="border border-border/50 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="w-4 h-4 text-primary" />
              Saldo por Clinica
            </CardTitle>
            <CardDescription className="text-xs">Adicione creditos para habilitar respostas em audio</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[200px]" />
            ) : summaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma clinica cadastrada</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Clinica</TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((s) => (
                    <TableRow key={s.tenantId}>
                      <TableCell className="font-medium">{s.tenantName}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.balance > 1000 ? "default" : s.balance > 0 ? "secondary" : "destructive"} className="font-mono">
                          {s.balance.toLocaleString("pt-BR")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => {
                            setSelectedTenant({ id: s.tenantId, name: s.tenantName });
                            setAmount("");
                            setDescription("Creditos adicionados via admin");
                            setDialogOpen(true);
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Adicionar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border/50 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Historico de Transacoes (Global)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma transacao registrada</p>
            ) : (
              <div className="max-h-[500px] overflow-y-auto space-y-1">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{tx.description || (tx.type === "add" ? "Creditos adicionados" : "Consumo TTS")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Tenant #{tx.tenantId} · {new Date(tx.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <span className={`text-sm font-mono font-medium ${tx.type === "add" ? "text-emerald-500" : "text-red-400"}`}>
                      {tx.type === "add" ? "+" : "-"}{Math.abs(tx.amount).toLocaleString("pt-BR")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Creditos - {selectedTenant?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Quantidade de Creditos</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ex: 10000"
                min="1"
              />
              <p className="text-[11px] text-muted-foreground">1 credito = 1 caractere de audio gerado</p>
            </div>
            <div className="space-y-2">
              <Label>Descricao</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Motivo da adição"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddCredits} disabled={!amount || Number(amount) <= 0}>
              Adicionar {amount ? Number(amount).toLocaleString("pt-BR") : 0} creditos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
