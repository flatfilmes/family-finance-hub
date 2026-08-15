import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Família Finance AI" },
      {
        name: "description",
        content: "Acesse ou crie sua conta para organizar a vida financeira da sua família.",
      },
      { property: "og:title", content: "Entrar — Família Finance AI" },
      { property: "og:description", content: "Acesse sua conta do Família Finance AI." },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "signup" | "forgot";

const TABS: { id: Mode; label: string }[] = [
  { id: "login", label: "Entrar" },
  { id: "signup", label: "Criar conta" },
];

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: {
            emailRedirectTo: window.location.origin,
            data: { nome_completo: nome, telefone: telefone || null },
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/dashboard" });
        } else {
          toast.success("Conta criada! Confirme seu e-mail para entrar.");
          setMode("login");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Enviamos um link de recuperação para o seu e-mail.");
        setMode("login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-gradient px-5 py-8 sm:px-8">
      <Link to="/" className="flex items-center gap-2.5 self-start">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft">
          <Sparkles className="size-[18px]" />
        </span>
        <span className="text-[15px] font-bold tracking-tight">Família Finance AI</span>
      </Link>

      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-float sm:p-9">
          {mode === "forgot" ? (
            <div>
              <h1 className="text-2xl font-extrabold text-balance-tight">Recuperar senha</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Informe seu e-mail e enviaremos um link para criar uma nova senha.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-balance-tight">
                {mode === "login" ? "Bem-vindo de volta" : "Vamos começar"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "login"
                  ? "Entre para acompanhar as finanças da sua família."
                  : "Crie sua conta em menos de um minuto."}
              </p>
              <div className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMode(tab.id)}
                    className={cn(
                      "rounded-full py-2 text-sm font-semibold transition-colors",
                      mode === tab.id
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <>
                <Field label="Nome completo">
                  <input
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className={inputClass}
                    placeholder="Ana Souza"
                  />
                </Field>
                <Field label="Telefone (opcional)">
                  <input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    className={inputClass}
                    placeholder="(11) 90000-0000"
                  />
                </Field>
              </>
            )}

            <Field label="E-mail">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="voce@email.com"
              />
            </Field>

            {mode !== "forgot" && (
              <Field label="Senha">
                <input
                  required
                  type="password"
                  minLength={6}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </Field>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {loading
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : mode === "signup"
                    ? "Criar conta"
                    : "Enviar link de recuperação"}
            </button>
          </form>

          {mode !== "forgot" && (
            <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">ou</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-60"
              >
                Continuar com Google
              </button>
            </>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "forgot" ? (
              <button type="button" onClick={() => setMode("login")} className="font-semibold text-primary">
                Voltar para o login
              </button>
            ) : (
              <button type="button" onClick={() => setMode("forgot")} className="font-semibold text-primary">
                Esqueci minha senha
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
