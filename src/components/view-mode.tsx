import { useState } from "react";
import { Users, User } from "lucide-react";
import { usePermissions, scopeMemberId, type ViewMode } from "@/hooks/usePermissions";

/**
 * Estado do modo de visualização (Família / Minha).
 * Quem não é administrador familiar abre sempre em "Minha" e não pode alternar.
 * O modo é sempre derivado da permissão atual — nunca fixado durante o carregamento,
 * senão o administrador ficava preso na visão individual e os filtros por pessoa
 * pareciam não funcionar.
 */
export function useViewMode() {
  const perms = usePermissions();
  const [mode, setMode] = useState<ViewMode>("familia");

  const effectiveMode: ViewMode = perms.canSwitchView ? mode : "minha";


  return {
    ...perms,
    mode: effectiveMode,
    setMode,
    /** member_id efetivo para filtrar listas; "" = toda a família. */
    scoped: (filtroMembro = "") =>
      scopeMemberId({
        isAdmin: perms.isAdmin,
        myMemberId: perms.myMemberId,
        mode: effectiveMode,
        filtroMembro,
      }),
  };
}

type Props = {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  canSwitch: boolean;
};

export function ViewModeSwitch({ mode, onChange, canSwitch }: Props) {
  if (!canSwitch) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
        <User className="size-3.5" /> Visualização individual
      </span>
    );
  }

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors";

  return (
    <div
      className="inline-flex gap-1 rounded-full border border-border bg-card p-1"
      role="group"
      aria-label="Modo de visualização"
    >
      <button
        type="button"
        onClick={() => onChange("familia")}
        aria-pressed={mode === "familia"}
        className={`${base} ${mode === "familia" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
      >
        <Users className="size-3.5" /> Família
      </button>
      <button
        type="button"
        onClick={() => onChange("minha")}
        aria-pressed={mode === "minha"}
        className={`${base} ${mode === "minha" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
      >
        <User className="size-3.5" /> Minha
      </button>
    </div>
  );
}
