import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Padrão único de cadastro: botão "Novo/Adicionar" → diálogo compacto
 * com os botões Salvar e Cancelar. Evita formulários grandes sempre
 * abertos no topo das páginas.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Ação principal de cadastro, igual em todas as páginas. */
export function AddButton({
  children,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      {...(onClick ? { onClick } : {})}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
    >
      <Plus className="size-4" />
      {children}
    </button>
  );
}

/** Rodapé padrão dos formulários em diálogo: Salvar + Cancelar. */
export function FormActions({
  onCancel,
  saving,
  saveLabel = "Salvar",
}: {
  onCancel: () => void;
  saving?: boolean;
  saveLabel?: string;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={saving}
        className="min-h-11 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {saving ? "Salvando..." : saveLabel}
      </button>
    </div>
  );
}
