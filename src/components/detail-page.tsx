import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Cabeçalho padrão das páginas de detalhe (cartão e conta bancária). */
export function DetailHeader({
  backTo,
  backParams,
  backLabel,
  title,
  subtitle,
  badges,
  actions,
}: {
  backTo: "/cartoes" | "/bancos" | "/cartoes/$cardId" | "/bancos/$accountId";
  backParams?: Record<string, string>;
  backLabel: string;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      <Link
        to={backTo}
        params={backParams as never}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {backLabel}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-balance-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          {badges && <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "ok" | "warn" | "danger";
}) {
  const classes = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    danger: "bg-red-500/15 text-red-700 dark:text-red-400",
  }[tone];
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>
      {children}
    </span>
  );
}

/** Card de métrica usado nas páginas de detalhe e nas visões gerais. */
export function Metric({
  label,
  value,
  hint,
  tone,
  big,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "ok" | "danger";
  big?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-extrabold ${big ? "text-xl" : "text-lg"} ${
          tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
