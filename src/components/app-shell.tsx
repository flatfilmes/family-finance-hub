import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Wallet,
  Settings,
  LogOut,
  Menu,
  X,
  Sparkles,
  TrendingUp,
  Receipt,
  CreditCard,
  ShoppingCart,
  Target,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/receitas", label: "Receitas", icon: TrendingUp },
  { to: "/despesas", label: "Despesas", icon: ShoppingCart },
  { to: "/contas-fixas", label: "Contas Fixas", icon: Receipt },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/orcamento", label: "Orçamento Familiar", icon: Target },
  { to: "/minha-familia", label: "Minha Família", icon: Users },
  { to: "/perfil-financeiro", label: "Perfil Financeiro", icon: Wallet },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-[18px]" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-5 lg:flex">
        <Brand />
        <div className="mt-8 flex-1">{nav}</div>
        <FutureHint />
        <button
          onClick={handleSignOut}
          className="mt-4 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          <LogOut className="size-[18px]" />
          Sair
        </button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          aria-label="Abrir menu"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-foreground hover:bg-muted"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-x-0 top-[57px] z-20 border-b border-border bg-sidebar p-4 shadow-card lg:hidden">
          {nav}
          <button
            onClick={handleSignOut}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/60"
          >
            <LogOut className="size-[18px]" />
            Sair
          </button>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">{children}</div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft">
        <Sparkles className="size-[18px]" />
      </span>
      <span className="text-[15px] font-bold tracking-tight">Família Finance AI</span>
    </Link>
  );
}

function FutureHint() {
  return (
    <div className="rounded-2xl bg-accent/70 p-4">
      <p className="text-xs font-semibold text-accent-foreground">Inteligência em breve</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Análises de hábitos, previsões e recomendações chegam nas próximas fases.
      </p>
    </div>
  );
}
