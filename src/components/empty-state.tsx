import type { ReactNode } from "react";

/**
 * Estado vazio padrão: nunca deixar uma área em branco.
 * Sempre explica o contexto e oferece o próximo passo.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  /** Botão ou link para o fluxo já existente (nunca cria fluxo novo). */
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border px-4 py-6 sm:items-center sm:text-center">
      {icon && (
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          {icon}
        </span>
      )}
      <p className="text-sm font-bold">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
