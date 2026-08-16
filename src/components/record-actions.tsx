import { useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type RecordAction = {
  label: string;
  onSelect: () => void;
  /** Ação destrutiva ganha destaque vermelho no menu. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Menu discreto de gestão (⋮) usado nos cadastros de receitas,
 * contas bancárias e cartões. As opções só aparecem ao clicar.
 */
export function RecordActions({ label, actions }: { label: string; actions: RecordAction[] }) {
  const visiveis = actions.filter((a) => !a.disabled);
  if (!visiveis.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Ações de ${label}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {visiveis.map((a) => (
          <DropdownMenuItem
            key={a.label}
            onSelect={a.onSelect}
            className={a.destructive ? "text-destructive focus:text-destructive" : ""}
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Confirmação padrão para ações destrutivas ou irreversíveis. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  onConfirm,
  pending,
  blocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Quando true, apenas informa o motivo e não oferece a ação. */
  blocked?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Entendi" : "Cancelar"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {pending ? "Processando..." : confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Estado auxiliar para abrir diálogos de edição/exclusão de um registro. */
export function useRecordDialog<T>() {
  const [record, setRecord] = useState<T | null>(null);
  return {
    record,
    open: record !== null,
    openWith: (r: T) => setRecord(r),
    close: () => setRecord(null),
  };
}
