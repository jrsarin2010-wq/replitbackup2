import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAuthToken, setTenantId, setTenantPlan } from "@/lib/api-config";
import OdontoFlowLogo from "@/components/odonto-flow-logo";
import {
  Sparkles, Stethoscope, Clock, ArrowRight, CheckCircle2, Mail, Lock, Eye, EyeOff,
  ArrowLeft, KeyRound, Building2, ShieldCheck, Brain, DollarSign,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";

interface OnboardingPageProps {
  onComplete: () => void;
  onSetupNeeded?: () => void;
  initialView?: "welcome" | "login" | "register";
  onBack?: () => void;
}

type View = "welcome" | "login" | "register" | "forgot" | "reset" | "done";

function PasswordInput({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-xl pr-10"
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        onClick={() => setShow(!show)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function OnboardingPage({ onComplete, onSetupNeeded, initialView = "welcome", onBack }: OnboardingPageProps) {
  const [view, setView] = useState<View>(initialView);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    name: "", email: "", password: "", confirmPassword: "", cro: "",
  });
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetForm, setResetForm] = useState({ token: "", password: "", confirmPassword: "" });
  const [createdClinicName, setCreatedClinicName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setResetForm(prev => ({ ...prev, token }));
      setView("reset");
    }
  }, []);

  async function handleLogin() {
    setError("");
    if (!loginForm.email || !loginForm.password) {
      setError("Preencha todos os campos");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao fazer login"); return; }
      setAuthToken(data.token);
      setTenantId(String(data.tenantId));
      if (data.plan) setTenantPlan(data.plan);
      onComplete();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setError("");
    if (!registerForm.name || !registerForm.email || !registerForm.password || !registerForm.confirmPassword || !registerForm.cro) {
      setError("Preencha todos os campos");
      return;
    }
    if (!/^\d{4,6}$/.test(registerForm.cro.trim())) {
      setError("CRO deve ter entre 4 e 6 dígitos numéricos");
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    if (registerForm.password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      const pendingPlan = sessionStorage.getItem("pendingPlan") || undefined;
      sessionStorage.removeItem("pendingPlan");
      const res = await fetch(`${BASE}api/dental/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...registerForm, ...(pendingPlan ? { planType: pendingPlan } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "CRO_DUPLICATE") {
          setError("CRO_DUPLICATE");
        } else {
          setError(data.error || "Erro ao criar conta");
        }
        return;
      }
      setAuthToken(data.token);
      setTenantId(String(data.tenantId));
      if (data.plan) setTenantPlan(data.plan);
      setCreatedClinicName(registerForm.name);
      if (onSetupNeeded) {
        onSetupNeeded();
      } else {
        setView("done");
      }
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    if (!forgotEmail) {
      setError("Digite seu email");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao processar solicitação"); return; }
      setSuccessMessage(data.message);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    setError("");
    if (!resetForm.password || !resetForm.confirmPassword) {
      setError("Preencha todos os campos");
      return;
    }
    if (resetForm.password !== resetForm.confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    if (resetForm.password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/dental/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resetForm),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao redefinir senha"); return; }
      setSuccessMessage(data.message);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-primary/8 to-transparent blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-emerald-500/6 to-transparent blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {view === "welcome" && (
          <div className="text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-center">
              <OdontoFlowLogo
                size="2xl"
                showText={false}
              />
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-extrabold tracking-tight gradient-text-warm">
                Bem-vindo ao OdontoFlow
              </h1>
              <p className="text-muted-foreground text-[15px] leading-relaxed max-w-sm mx-auto">
                Sua secretaria virtual inteligente com WhatsApp, agendamentos e muito mais — tudo em um só lugar.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 text-left">
              {[
                { icon: Sparkles, label: "IA que responde leads e pacientes 24h", desc: "Atendimento inteligente via WhatsApp", color: "text-primary", bg: "bg-primary/8" },
                { icon: Stethoscope, label: "Gestão de consultas e pacientes", desc: "Prontuário digital completo", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/8" },
                { icon: Clock, label: "Agenda inteligente com horários reais", desc: "Sem conflitos, sem erros", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/8" },
                { icon: Brain, label: "IA que aprende e evolui com seus pacientes", desc: "Melhora continuamente com cada interação", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/8" },
                { icon: DollarSign, label: "Gestão Financeira e Receitas", desc: "Controle completo de pagamentos e faturamento", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/8" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg p-3 flex items-center gap-3 group border border-white/5 hover:border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${item.bg} transition-all duration-300 group-hover:scale-105`}>
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold leading-tight">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button
              onClick={() => { setView("register"); setError(""); }}
              className="w-full h-12 text-[15px] font-semibold premium-badge border-0 shadow-xl shadow-primary/25 hover:shadow-primary/35 transition-all gap-2"
            >
              Criar minha clínica
              <ArrowRight className="w-4 h-4" />
            </Button>

            <p className="text-[13px] text-muted-foreground/70">
              Já tem uma conta?{" "}
              <button
                className="text-primary hover:underline font-semibold"
                onClick={() => { setView("login"); setError(""); }}
              >
                Fazer login
              </button>
            </p>
          </div>
        )}

        {view === "login" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight">Entrar na sua conta</h2>
              <p className="text-muted-foreground text-[13px]">Acesse o painel da sua clínica</p>
            </div>

            <div className="premium-card rounded-2xl p-6 space-y-4">
              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" /> Email
                </Label>
                <Input
                  type="email"
                  value={loginForm.email}
                  onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                  placeholder="clinica@email.com"
                  className="h-11 rounded-xl"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Senha
                </Label>
                <PasswordInput
                  value={loginForm.password}
                  onChange={v => setLoginForm({ ...loginForm, password: v })}
                  placeholder="Sua senha"
                />
              </div>

              <div className="text-right">
                <button
                  className="text-[12px] text-primary hover:underline font-medium"
                  onClick={() => { setView("forgot"); setError(""); setSuccessMessage(""); }}
                >
                  Esqueceu sua senha?
                </button>
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                  <p className="text-[12px] text-destructive font-medium">{error}</p>
                </div>
              )}
            </div>

            <Button
              onClick={handleLogin}
              disabled={loading || !loginForm.email || !loginForm.password}
              className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
            >
              {loading ? "Entrando..." : "Entrar"}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </Button>

            <p className="text-center text-[13px] text-muted-foreground/70">
              Não tem conta?{" "}
              <button className="text-primary hover:underline font-semibold" onClick={() => { setView("register"); setError(""); }}>
                Criar conta
              </button>
            </p>

            <button
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-muted-foreground mx-auto"
              onClick={() => { onBack ? onBack() : setView("welcome"); setError(""); }}
            >
              <ArrowLeft className="w-3 h-3" /> Voltar ao início
            </button>
          </div>
        )}

        {view === "register" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight">Criar sua clínica</h2>
              <p className="text-muted-foreground text-[13px]">Preencha os dados abaixo para começar</p>
            </div>

            <div className="premium-card rounded-2xl p-6 space-y-4">
              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> Nome da Clínica *
                </Label>
                <Input
                  value={registerForm.name}
                  onChange={e => setRegisterForm({ ...registerForm, name: e.target.value })}
                  placeholder="Ex: Clínica Sorriso Perfeito"
                  className="h-11 rounded-xl"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" /> CRO do Responsável *
                </Label>
                <Input
                  value={registerForm.cro}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setRegisterForm({ ...registerForm, cro: v });
                  }}
                  placeholder="Ex: 4219"
                  className="h-11 rounded-xl"
                  maxLength={6}
                  inputMode="numeric"
                />
                <p className="text-[11px] text-muted-foreground/60">Registro no Conselho Regional de Odontologia (4 a 6 dígitos)</p>
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" /> Email da Clínica *
                </Label>
                <Input
                  type="email"
                  value={registerForm.email}
                  onChange={e => setRegisterForm({ ...registerForm, email: e.target.value })}
                  placeholder="clinica@email.com"
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Senha *
                </Label>
                <PasswordInput
                  value={registerForm.password}
                  onChange={v => setRegisterForm({ ...registerForm, password: v })}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Confirmar Senha *
                </Label>
                <PasswordInput
                  value={registerForm.confirmPassword}
                  onChange={v => setRegisterForm({ ...registerForm, confirmPassword: v })}
                  placeholder="Repita a senha"
                />
                {registerForm.password && registerForm.confirmPassword && (
                  <p className={`text-[11px] font-medium ${registerForm.password === registerForm.confirmPassword ? "text-emerald-600" : "text-destructive"}`}>
                    {registerForm.password === registerForm.confirmPassword ? "✓ Senhas coincidem" : "✗ Senhas não coincidem"}
                  </p>
                )}
              </div>

              {error && error === "CRO_DUPLICATE" ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
                        CRO já utilizado no período de teste
                      </p>
                      <p className="text-[12px] text-amber-800/80 dark:text-amber-300/80">
                        O teste gratuito de 7 dias é válido para apenas 1 registro por CRO. Para continuar usando o OdontoFlow, assine o plano Premium.
                      </p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-violet-500/10 to-emerald-500/10 rounded-lg p-3 border border-violet-500/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-bold text-foreground">Plano Premium</p>
                        <p className="text-[11px] text-muted-foreground">Acesso completo a todas as funcionalidades</p>
                      </div>
                      <p className="text-lg font-extrabold text-violet-600 dark:text-violet-400">R$157<span className="text-[10px] font-normal text-muted-foreground">/mês</span></p>
                    </div>
                  </div>
                  <Button
                    onClick={() => { setView("login"); setError(""); }}
                    className="w-full h-10 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2 text-[13px]"
                  >
                    Fazer login e assinar o Premium
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              ) : error ? (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                  <p className="text-[12px] text-destructive font-medium">{error}</p>
                </div>
              ) : null}
            </div>

            <Button
              onClick={handleRegister}
              disabled={loading || !registerForm.name || !registerForm.email || !registerForm.password || !registerForm.confirmPassword || !registerForm.cro}
              className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
            >
              {loading ? "Criando..." : "Criar Clínica"}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </Button>

            <p className="text-center text-[13px] text-muted-foreground/70">
              Já tem conta?{" "}
              <button className="text-primary hover:underline font-semibold" onClick={() => { setView("login"); setError(""); }}>
                Fazer login
              </button>
            </p>

            <button
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-muted-foreground mx-auto"
              onClick={() => { onBack ? onBack() : setView("welcome"); setError(""); }}
            >
              <ArrowLeft className="w-3 h-3" /> Voltar ao início
            </button>
          </div>
        )}

        {view === "forgot" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 flex items-center justify-center">
                  <KeyRound className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight">Esqueceu sua senha?</h2>
              <p className="text-muted-foreground text-[13px]">Digite seu email para receber o link de redefinição</p>
            </div>

            <div className="premium-card rounded-2xl p-6 space-y-4">
              {!successMessage ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" /> Email da Clínica
                    </Label>
                    <Input
                      type="email"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      placeholder="clinica@email.com"
                      className="h-11 rounded-xl"
                      autoFocus
                      onKeyDown={e => e.key === "Enter" && handleForgotPassword()}
                    />
                  </div>

                  {error && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                      <p className="text-[12px] text-destructive font-medium">{error}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Mail className="w-6 h-6 text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-[14px] text-foreground font-medium">Email enviado!</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">
                    {successMessage}
                  </p>
                </div>
              )}
            </div>

            {!successMessage && (
              <Button
                onClick={handleForgotPassword}
                disabled={loading || !forgotEmail}
                className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
              >
                {loading ? "Enviando..." : "Enviar link de redefinição"}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </Button>
            )}

            <button
              className="flex items-center gap-1.5 text-[13px] text-primary hover:underline font-medium mx-auto"
              onClick={() => { setView("login"); setError(""); setSuccessMessage(""); }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao login
            </button>
          </div>
        )}

        {view === "reset" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                  <KeyRound className="w-6 h-6 text-primary" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight">Redefinir senha</h2>
              <p className="text-muted-foreground text-[13px]">Crie uma nova senha para sua conta</p>
            </div>

            <div className="premium-card rounded-2xl p-6 space-y-4">
              {!successMessage ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Nova Senha
                    </Label>
                    <PasswordInput
                      value={resetForm.password}
                      onChange={v => setResetForm({ ...resetForm, password: v })}
                      placeholder="Mínimo 6 caracteres"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[13px] font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Confirmar Nova Senha
                    </Label>
                    <PasswordInput
                      value={resetForm.confirmPassword}
                      onChange={v => setResetForm({ ...resetForm, confirmPassword: v })}
                      placeholder="Repita a nova senha"
                    />
                    {resetForm.password && resetForm.confirmPassword && (
                      <p className={`text-[11px] font-medium ${resetForm.password === resetForm.confirmPassword ? "text-emerald-600" : "text-destructive"}`}>
                        {resetForm.password === resetForm.confirmPassword ? "✓ Senhas coincidem" : "✗ Senhas não coincidem"}
                      </p>
                    )}
                  </div>

                  {error && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                      <p className="text-[12px] text-destructive font-medium">{error}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <div className="flex justify-center">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-[14px] text-foreground font-medium">Senha redefinida!</p>
                  <p className="text-[13px] text-muted-foreground">{successMessage}</p>
                </div>
              )}
            </div>

            {!successMessage ? (
              <Button
                onClick={handleResetPassword}
                disabled={loading || !resetForm.password || !resetForm.confirmPassword}
                className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
              >
                {loading ? "Redefinindo..." : "Redefinir Senha"}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </Button>
            ) : (
              <Button
                onClick={() => { setView("login"); setSuccessMessage(""); setError(""); }}
                className="w-full h-11 rounded-xl premium-badge border-0 shadow-lg shadow-primary/20 gap-2"
              >
                Ir para o login <ArrowRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}

        {view === "done" && (
          <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold tracking-tight">Clínica criada com sucesso!</h2>
              <p className="text-muted-foreground text-[14px]">
                Sua clínica <strong>{createdClinicName}</strong> está pronta. Configure o WhatsApp nas configurações para ativar a secretaria virtual.
              </p>
            </div>
            <Button
              onClick={onComplete}
              className="w-full h-12 text-[15px] font-semibold premium-badge border-0 shadow-xl shadow-primary/25 gap-2"
            >
              Ir para o Dashboard
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
