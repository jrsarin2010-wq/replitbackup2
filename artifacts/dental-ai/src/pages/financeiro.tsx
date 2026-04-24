import { useState } from "react";
import {
  useListTreatments, useCreateTreatment, useUpdateTreatment, useDeleteTreatment,
  useGetFinancialSummary, useListPatients, getListTreatmentsQueryKey,
  getGetFinancialSummaryQueryKey, getListPatientsQueryKey,
  useListExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense,
  getListExpensesQueryKey,
} from "@workspace/api-client-react";
import type { Expense, FinancialSummary, ListExpensesParams, CreateExpenseBodyCategory } from "@workspace/api-client-react";
import type { TreatmentRecord, ProcedureItem, PatientRecord } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2, Plus, Trash2, Pencil,
  Receipt, CreditCard, PiggyBank, ArrowUpRight, FileText, X, AlertCircle,
  Wallet, TrendingDown, BarChart3,
} from "lucide-react";

interface TreatmentForm {
  patientId: string;
  description: string;
  procedures: { name: string; value: string }[];
  paidValue: string;
  paymentMethod: string;
  notes: string;
  status: string;
}

const emptyForm: TreatmentForm = {
  patientId: "", description: "", procedures: [{ name: "", value: "" }],
  paidValue: "0", paymentMethod: "", notes: "", status: "in_progress",
};

interface ExpenseForm {
  description: string;
  amount: string;
  category: string;
  date: string;
  notes: string;
}

const emptyExpenseForm: ExpenseForm = {
  description: "", amount: "", category: "outros", date: new Date().toISOString().split("T")[0], notes: "",
};

const EXPENSE_CATEGORIES: Record<string, string> = {
  aluguel: "Aluguel",
  material: "Material",
  salario: "Salario",
  fornecedor: "Fornecedor",
  manutencao: "Manutencao",
  outros: "Outros",
};

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FinanceiroPage() {
  const [activeTab, setActiveTab] = useState<"treatments" | "expenses">("treatments");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<TreatmentForm>(emptyForm);

  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expenseEditId, setExpenseEditId] = useState<number | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(emptyExpenseForm);
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>("all");
  const [expenseStartDate, setExpenseStartDate] = useState<string>("");
  const [expenseEndDate, setExpenseEndDate] = useState<string>("");

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: treatments, isLoading, isError: treatmentsError } = useListTreatments(
    statusFilter !== "all" ? { status: statusFilter as "all" | "in_progress" | "finished" | "cancelled" } : undefined
  );
  const { data: summary, isError: summaryError } = useGetFinancialSummary();
  const { data: patientsData } = useListPatients();
  const patients = ((patientsData as unknown) as { data?: PatientRecord[] })?.data || [];

  const expenseParams: ListExpensesParams | undefined = (() => {
    const p: ListExpensesParams = {};
    if (expenseCategoryFilter !== "all") p.category = expenseCategoryFilter as ListExpensesParams["category"];
    if (expenseStartDate) p.startDate = expenseStartDate;
    if (expenseEndDate) p.endDate = expenseEndDate;
    return Object.keys(p).length > 0 ? p : undefined;
  })();
  const { data: expenses, isLoading: expensesLoading, isError: expensesError } = useListExpenses(expenseParams);

  const createMut = useCreateTreatment();
  const updateMut = useUpdateTreatment();
  const deleteMut = useDeleteTreatment();

  const createExpenseMut = useCreateExpense();
  const updateExpenseMut = useUpdateExpense();
  const deleteExpenseMut = useDeleteExpense();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListTreatmentsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetFinancialSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
  }

  function openCreate() {
    setForm(emptyForm);
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(t: Partial<TreatmentRecord> & { id: number; patientId: number }) {
    let procs: { name: string; value: string }[] = [];
    try {
      const parsed = typeof t.procedures === "string" ? JSON.parse(t.procedures) : t.procedures;
      procs = (parsed || []).map((p: ProcedureItem) => ({ name: p.name || "", value: String(p.value || 0) }));
    } catch { procs = []; }
    if (procs.length === 0) procs = [{ name: "", value: "" }];
    setForm({
      patientId: String(t.patientId),
      description: t.description || "",
      procedures: procs,
      paidValue: String(t.paidValue || 0),
      paymentMethod: t.paymentMethod || "",
      notes: t.notes || "",
      status: t.status || "in_progress",
    });
    setEditId(t.id);
    setDialogOpen(true);
  }

  function addProcedure() {
    setForm({ ...form, procedures: [...form.procedures, { name: "", value: "" }] });
  }

  function removeProcedure(idx: number) {
    const newProcs = form.procedures.filter((_, i) => i !== idx);
    setForm({ ...form, procedures: newProcs.length ? newProcs : [{ name: "", value: "" }] });
  }

  function updateProcedure(idx: number, field: "name" | "value", val: string) {
    const newProcs = [...form.procedures];
    newProcs[idx] = { ...newProcs[idx], [field]: val };
    setForm({ ...form, procedures: newProcs });
  }

  const totalValue = form.procedures.reduce((s, p) => s + Number(p.value || 0), 0);

  async function handleSubmit() {
    const procedures = form.procedures.filter(p => p.name).map(p => ({ name: p.name, value: Number(p.value || 0) }));
    const payload = {
      patientId: Number(form.patientId),
      description: form.description,
      procedures,
      totalValue,
      paidValue: Number(form.paidValue || 0),
      paymentMethod: form.paymentMethod || undefined,
      notes: form.notes || undefined,
      status: form.status as "in_progress" | "finished" | "cancelled",
    };
    try {
      if (editId) {
        await updateMut.mutateAsync({ treatmentId: editId, data: payload });
        toast({ title: "Tratamento atualizado" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "Tratamento registrado" });
      }
      setDialogOpen(false);
      invalidate();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Excluir este tratamento?")) return;
    try {
      await deleteMut.mutateAsync({ treatmentId: id });
      toast({ title: "Tratamento excluido" });
      invalidate();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleFinalize(t: Partial<TreatmentRecord> & { id: number }) {
    try {
      await updateMut.mutateAsync({ treatmentId: t.id, data: { status: "finished", paidValue: Number(t.totalValue) } });
      toast({ title: "Tratamento finalizado" });
      invalidate();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  function openExpenseCreate() {
    setExpenseForm(emptyExpenseForm);
    setExpenseEditId(null);
    setExpenseDialogOpen(true);
  }

  function openExpenseEdit(e: Expense) {
    setExpenseForm({
      description: e.description || "",
      amount: String(e.amount || 0),
      category: e.category || "outros",
      date: e.date ? new Date(e.date).toISOString().split("T")[0] : "",
      notes: e.notes || "",
    });
    setExpenseEditId(e.id);
    setExpenseDialogOpen(true);
  }

  async function handleExpenseSubmit() {
    const payload = {
      description: expenseForm.description,
      amount: Number(expenseForm.amount),
      category: expenseForm.category as CreateExpenseBodyCategory,
      date: expenseForm.date || undefined,
      notes: expenseForm.notes || undefined,
    };
    try {
      if (expenseEditId) {
        await updateExpenseMut.mutateAsync({ expenseId: expenseEditId, data: payload });
        toast({ title: "Despesa atualizada" });
      } else {
        await createExpenseMut.mutateAsync({ data: payload });
        toast({ title: "Despesa registrada" });
      }
      setExpenseDialogOpen(false);
      invalidate();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  async function handleExpenseDelete(id: number) {
    if (!confirm("Excluir esta despesa?")) return;
    try {
      await deleteExpenseMut.mutateAsync({ expenseId: id });
      toast({ title: "Despesa excluida" });
      invalidate();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
      in_progress: { label: "Em Andamento", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800", icon: Clock },
      finished: { label: "Finalizado", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800", icon: CheckCircle2 },
      cancelled: { label: "Cancelado", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800", icon: AlertCircle },
    };
    const c = map[status] || map.in_progress;
    const Icon = c.icon;
    return (
      <Badge variant="outline" className={`gap-1.5 ${c.cls} rounded-lg text-[11px] font-medium`}>
        <Icon className="w-3 h-3" />
        {c.label}
      </Badge>
    );
  };

  const summaryData = summary as FinancialSummary | undefined;
  const stats = [
    { label: "Receita Total", value: formatBRL(summaryData?.totalRevenue ?? 0), icon: TrendingUp, gradient: "stat-gradient-1" },
    { label: "Despesas Total", value: formatBRL(summaryData?.totalExpenses ?? 0), icon: TrendingDown, gradient: "stat-gradient-3" },
    { label: "Saldo (Lucro)", value: formatBRL(summaryData?.netBalance ?? 0), icon: Wallet, gradient: (summaryData?.netBalance ?? 0) >= 0 ? "stat-gradient-2" : "stat-gradient-3" },
    { label: "Recebido", value: formatBRL(summaryData?.totalPaid ?? 0), icon: DollarSign, gradient: "stat-gradient-2" },
    { label: "Pendente", value: formatBRL(summaryData?.totalPending ?? 0), icon: PiggyBank, gradient: "stat-gradient-4" },
    { label: "Finalizados", value: `${summaryData?.finalized ?? 0} / ${summaryData?.totalTreatments ?? 0}`, icon: CheckCircle2, gradient: "stat-gradient-1" },
  ];

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      {(summaryError || treatmentsError || expensesError) && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/8 border border-red-500/20 text-red-700 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">Nao foi possivel carregar alguns dados. Tente recarregar a pagina.</p>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-[28px] font-extrabold tracking-tight gradient-text-warm">Financeiro</h1>
          <p className="text-[12px] text-muted-foreground/60 font-medium mt-1">Controle de tratamentos, despesas e receita</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          {activeTab === "treatments" ? (
            <Button onClick={openCreate} className="gap-2 rounded-xl h-10 px-5 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
              <Plus className="w-4 h-4" />
              Novo Tratamento
            </Button>
          ) : (
            <Button onClick={openExpenseCreate} className="gap-2 rounded-xl h-10 px-5 premium-badge border-0 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
              <Plus className="w-4 h-4" />
              Nova Despesa
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`premium-card-glow rounded-2xl overflow-hidden ${s.gradient} border group`}>
              <div className="p-5 md:p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center bg-white/60 dark:bg-white/10 shadow-sm transition-all duration-500 group-hover:scale-110 group-hover:shadow-md`}>
                    <Icon className="w-5 h-5 text-foreground/70" />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground/30 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="text-xl md:text-2xl font-extrabold tracking-tighter number-display leading-none">{s.value}</p>
                <p className="text-[11px] text-muted-foreground/60 font-semibold mt-1.5 uppercase tracking-[0.12em]">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 border-b border-border/50 pb-0">
        <Button
          variant="ghost"
          className={`rounded-t-xl rounded-b-none text-sm h-10 px-5 ${activeTab === "treatments" ? "bg-muted font-semibold border-b-2 border-primary" : ""}`}
          onClick={() => setActiveTab("treatments")}
        >
          <Receipt className="w-4 h-4 mr-2" />
          Tratamentos
        </Button>
        <Button
          variant="ghost"
          className={`rounded-t-xl rounded-b-none text-sm h-10 px-5 ${activeTab === "expenses" ? "bg-muted font-semibold border-b-2 border-primary" : ""}`}
          onClick={() => setActiveTab("expenses")}
        >
          <BarChart3 className="w-4 h-4 mr-2" />
          Despesas
        </Button>
      </div>

      {activeTab === "treatments" && (
        <>
          <div className="flex gap-2">
            {[
              { value: "all", label: "Todos" },
              { value: "in_progress", label: "Em Andamento" },
              { value: "finished", label: "Finalizados" },
              { value: "cancelled", label: "Cancelados" },
            ].map((f) => (
              <Button
                key={f.value}
                variant={statusFilter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.value)}
                className="rounded-xl text-xs h-8"
              >
                {f.label}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : (
            <>
              <div className="hidden md:block">
                <div className="premium-card rounded-2xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Paciente</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Descricao</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Procedimentos</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Valor</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Pago</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Status</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80 text-right">Acoes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(treatments || []).map((t) => {
                        let procs: ProcedureItem[] = [];
                        try { procs = typeof t.procedures === "string" ? JSON.parse(t.procedures) : (t.procedures || []); } catch {}
                        return (
                          <TableRow key={t.id} className="hover:bg-muted/30 transition-colors group">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                                  <Receipt className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <div>
                                  <p className="font-semibold text-[13px]">{t.patientName || `Paciente #${t.patientId}`}</p>
                                  <p className="text-[11px] text-muted-foreground">{t.patientPhone || ""}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px]">{t.description}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {procs.map((p: ProcedureItem, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-[10px] rounded-md">
                                    {p.name} ({formatBRL(Number(p.value))})
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-[13px] font-semibold">{formatBRL(Number(t.totalValue))}</TableCell>
                            <TableCell>
                              <span className={`font-mono text-[13px] ${Number(t.paidValue) >= Number(t.totalValue) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                {formatBRL(Number(t.paidValue))}
                              </span>
                            </TableCell>
                            <TableCell>{statusBadge(t.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {t.status === "in_progress" && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Finalizar" onClick={() => handleFinalize(t)}>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(t)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleDelete(t.id)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="md:hidden space-y-3">
                {(treatments || []).map((t) => {
                  let procs: ProcedureItem[] = [];
                  try { procs = typeof t.procedures === "string" ? JSON.parse(t.procedures) : (t.procedures || []); } catch {}
                  return (
                    <div key={t.id} className="premium-card rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                            <Receipt className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-[13px]">{t.patientName || `Paciente #${t.patientId}`}</p>
                            <p className="text-[11px] text-muted-foreground">{t.description}</p>
                          </div>
                        </div>
                        {statusBadge(t.status)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {procs.map((p: ProcedureItem, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[10px] rounded-md">
                            {p.name} ({formatBRL(Number(p.value))})
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Valor Total</p>
                          <p className="font-mono font-bold text-sm">{formatBRL(Number(t.totalValue))}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground uppercase">Pago</p>
                          <p className={`font-mono font-bold text-sm ${Number(t.paidValue) >= Number(t.totalValue) ? "text-emerald-600" : "text-amber-600"}`}>
                            {formatBRL(Number(t.paidValue))}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 pt-1 border-t border-border/50">
                        {t.status === "in_progress" && (
                          <Button variant="outline" size="sm" className="rounded-lg text-[11px] h-7 gap-1" onClick={() => handleFinalize(t)}>
                            <CheckCircle2 className="w-3 h-3" /> Finalizar
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="rounded-lg text-[11px] h-7" onClick={() => openEdit(t)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="rounded-lg text-[11px] h-7" onClick={() => handleDelete(t.id)}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "expenses" && (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Categoria</Label>
              <Select value={expenseCategoryFilter} onValueChange={setExpenseCategoryFilter}>
                <SelectTrigger className="rounded-xl h-8 w-[160px] text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">De</Label>
              <Input type="date" value={expenseStartDate} onChange={(e) => setExpenseStartDate(e.target.value)} className="rounded-xl h-8 w-[150px] text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Ate</Label>
              <Input type="date" value={expenseEndDate} onChange={(e) => setExpenseEndDate(e.target.value)} className="rounded-xl h-8 w-[150px] text-xs" />
            </div>
            {(expenseCategoryFilter !== "all" || expenseStartDate || expenseEndDate) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs rounded-xl" onClick={() => { setExpenseCategoryFilter("all"); setExpenseStartDate(""); setExpenseEndDate(""); }}>
                Limpar filtros
              </Button>
            )}
          </div>

          {expensesLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : (
            <>
              <div className="hidden md:block">
                <div className="premium-card rounded-2xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Descricao</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Categoria</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Data</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Valor</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80">Notas</TableHead>
                        <TableHead className="font-semibold text-xs uppercase tracking-wider text-muted-foreground/80 text-right">Acoes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((expenses || []) as Expense[]).map((e) => (
                        <TableRow key={e.id} className="hover:bg-muted/30 transition-colors group">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center">
                                <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                              </div>
                              <p className="font-semibold text-[13px]">{e.description}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[11px] rounded-lg">
                              {EXPENSE_CATEGORIES[e.category] || e.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">
                            {new Date(e.date).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="font-mono text-[13px] font-semibold text-red-600 dark:text-red-400">
                            {formatBRL(Number(e.amount))}
                          </TableCell>
                          <TableCell className="text-[12px] text-muted-foreground max-w-[200px] truncate">
                            {e.notes || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openExpenseEdit(e)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => handleExpenseDelete(e.id)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(expenses || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            Nenhuma despesa encontrada
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="md:hidden space-y-3">
                {((expenses || []) as Expense[]).map((e) => (
                  <div key={e.id} className="premium-card rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center">
                          <TrendingDown className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                          <p className="font-semibold text-[13px]">{e.description}</p>
                          <p className="text-[11px] text-muted-foreground">{new Date(e.date).toLocaleDateString("pt-BR")}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] rounded-lg">
                        {EXPENSE_CATEGORIES[e.category] || e.category}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Valor</p>
                        <p className="font-mono font-bold text-sm text-red-600 dark:text-red-400">{formatBRL(Number(e.amount))}</p>
                      </div>
                    </div>
                    {e.notes && <p className="text-[11px] text-muted-foreground">{e.notes}</p>}
                    <div className="flex gap-1 pt-1 border-t border-border/50">
                      <Button variant="ghost" size="sm" className="rounded-lg text-[11px] h-7" onClick={() => openExpenseEdit(e)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="rounded-lg text-[11px] h-7" onClick={() => handleExpenseDelete(e.id)}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {(expenses || []).length === 0 && (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    Nenhuma despesa encontrada
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editId ? "Editar Tratamento" : "Novo Tratamento"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Paciente *</Label>
              <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
                <SelectTrigger className="rounded-xl h-10">
                  <SelectValue placeholder="Selecione o paciente" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p: PatientRecord) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Descricao *</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Limpeza e Clareamento" className="rounded-xl h-10" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium">Procedimentos</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addProcedure} className="h-7 text-[11px] rounded-lg gap-1">
                  <Plus className="w-3 h-3" /> Adicionar
                </Button>
              </div>
              {form.procedures.map((p, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input value={p.name} onChange={(e) => updateProcedure(idx, "name", e.target.value)} placeholder="Nome do procedimento" className="rounded-xl h-9 text-[13px] flex-1" />
                  <Input type="number" value={p.value} onChange={(e) => updateProcedure(idx, "value", e.target.value)} placeholder="Valor" className="rounded-xl h-9 text-[13px] w-28" />
                  {form.procedures.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg flex-shrink-0" onClick={() => removeProcedure(idx)}>
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="text-right">
                <span className="text-[12px] text-muted-foreground">Total: </span>
                <span className="font-mono font-semibold text-sm">{formatBRL(totalValue)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Valor Pago</Label>
                <Input type="number" value={form.paidValue} onChange={(e) => setForm({ ...form, paidValue: e.target.value })} className="rounded-xl h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Forma de Pagamento</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                  <SelectTrigger className="rounded-xl h-10">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">PIX</SelectItem>
                    <SelectItem value="Cartao de Credito">Cartao de Credito</SelectItem>
                    <SelectItem value="Cartao de Debito">Cartao de Debito</SelectItem>
                    <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="Parcelado">Parcelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="rounded-xl h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">Em Andamento</SelectItem>
                  <SelectItem value="finished">Finalizado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Observacoes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre o tratamento" className="rounded-xl h-10" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.patientId || !form.description} className="rounded-xl shadow-md shadow-primary/20">
              {editId ? "Salvar" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{expenseEditId ? "Editar Despesa" : "Nova Despesa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Descricao *</Label>
              <Input value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} placeholder="Ex: Aluguel do consultorio" className="rounded-xl h-10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Valor *</Label>
                <Input type="number" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} placeholder="0.00" className="rounded-xl h-10" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">Categoria *</Label>
                <Select value={expenseForm.category} onValueChange={(v) => setExpenseForm({ ...expenseForm, category: v })}>
                  <SelectTrigger className="rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Data</Label>
              <Input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} className="rounded-xl h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Observacoes</Label>
              <Input value={expenseForm.notes} onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })} placeholder="Notas adicionais" className="rounded-xl h-10" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExpenseDialogOpen(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={handleExpenseSubmit} disabled={!expenseForm.description || !expenseForm.amount || Number(expenseForm.amount) <= 0} className="rounded-xl shadow-md shadow-primary/20">
              {expenseEditId ? "Salvar" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
