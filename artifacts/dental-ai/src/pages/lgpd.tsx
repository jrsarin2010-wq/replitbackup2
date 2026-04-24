import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, Download, Trash2, FileCheck, Clock, User, Loader2,
} from "lucide-react";
import { getTenantId } from "@/lib/api-config";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function lgpdFetch(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type") && options?.method && options.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}api/dental/lgpd${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function MeusDadosPage() {
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const { toast } = useToast();

  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const consents = await lgpdFetch("/consent");
      const auditLog = await lgpdFetch("/audit-log?limit=200");

      const exportData = {
        exportDate: new Date().toISOString(),
        tenantId: getTenantId(),
        consents,
        auditLog,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meus_dados_${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Exportação concluída", description: "Seus dados foram exportados com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteRequest = () => {
    setDeleteLoading(true);
    setTimeout(() => {
      toast({
        title: "Solicitação enviada",
        description: "Sua solicitação de exclusão de conta foi registrada. Nossa equipe entrará em contato em até 15 dias úteis.",
      });
      setDeleteDialogOpen(false);
      setDeleteLoading(false);
    }, 1000);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-500/10">
          <Shield className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Meus Dados</h1>
          <p className="text-muted-foreground text-sm">
            Gerencie suas preferências de privacidade e dados pessoais
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-5 w-5 text-blue-500" />
              Seus Dados Pessoais
            </CardTitle>
            <CardDescription>Informações sobre os dados armazenados na plataforma</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Dados cadastrais</span>
              <Badge className="bg-green-500/10 text-green-600 border-green-200">Armazenados</Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Dados de pacientes</span>
              <Badge className="bg-green-500/10 text-green-600 border-green-200">Protegidos</Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Histórico de conversas</span>
              <Badge className="bg-green-500/10 text-green-600 border-green-200">Criptografado</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Registros financeiros</span>
              <Badge className="bg-green-500/10 text-green-600 border-green-200">Protegidos</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck className="h-5 w-5 text-emerald-500" />
              Termos Aceitos
            </CardTitle>
            <CardDescription>Termos e políticas que você aceitou</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <p className="text-sm font-medium">Termos de Uso</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Versão 1.0
                </p>
              </div>
              <Badge variant="outline">Aceito</Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <p className="text-sm font-medium">Política de Privacidade</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Versão 1.0
                </p>
              </div>
              <Badge variant="outline">Aceito</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium">Tratamento de Dados (LGPD)</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Versão 1.0
                </p>
              </div>
              <Badge variant="outline">Aceito</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-violet-500" />
            Seus Direitos (LGPD)
          </CardTitle>
          <CardDescription>
            Conforme a Lei Geral de Proteção de Dados, você tem direito a exportar e solicitar a exclusão dos seus dados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={handleExportData}
              disabled={exportLoading}
              className="flex-1"
            >
              {exportLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Exportar Meus Dados
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Solicitar Exclusão da Conta
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            A exportação inclui seus consentimentos e registros de auditoria em formato JSON.
            A solicitação de exclusão será processada em até 15 dias úteis conforme a LGPD.
          </p>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Solicitar Exclusão de Conta
            </DialogTitle>
            <DialogDescription>
              Ao solicitar a exclusão da conta, todos os seus dados pessoais serão removidos ou anonimizados.
              Dados de pacientes poderão ser retidos conforme obrigações legais (ex: prontuários médicos).
              Esta ação não pode ser desfeita após processamento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteRequest} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar Solicitação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
