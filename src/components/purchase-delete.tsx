import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import {
  deletePurchase,
  inspectPurchaseDeletion,
  type Purchase,
} from "@/lib/purchases";

type Props = {
  purchase: Purchase;
  onClose: () => void;
  /** Invalidação das consultas financeiras após excluir. */
  onDeleted?: () => void;
};

function Linha({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

/**
 * Confirmação de exclusão de compra com relatório de impacto.
 * O bloqueio real acontece no banco; aqui apenas explicamos ao usuário.
 */
export function DeletePurchaseDialog({ purchase, onClose, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const { data: relatorio, isLoading } = useQuery({
    queryKey: ["purchase-deletion", purchase.id],
    queryFn: () => inspectPurchaseDeletion(purchase.id),
  });

  const remove = useMutation({
    mutationFn: () => deletePurchase(purchase.id),
    onSuccess: () => {
      toast.success("Compra excluída com sucesso.");
      void queryClient.invalidateQueries({ queryKey: ["purchase-deletion", purchase.id] });
      onDeleted?.();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bloqueada = !!relatorio && !relatorio.pode_excluir;
  const parcelada = (relatorio?.parcelas ?? 0) > 0;

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {bloqueada
              ? "Não é possível excluir esta compra"
              : parcelada
                ? "Excluir compra e parcelas relacionadas?"
                : "Excluir compra?"}
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-2xl bg-muted/50 p-4">
            <p className="font-semibold">{purchase.estabelecimento}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(purchase.data_compra)} ·{" "}
              {formatCurrency(Number(purchase.valor_total))}
            </p>
          </div>

          {isLoading && <p className="text-muted-foreground">Verificando dependências...</p>}

          {relatorio && (
            <div className="space-y-1 rounded-2xl border border-border p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Impacto da exclusão
              </p>
              <Linha label="Itens da compra" value={relatorio.itens} />
              <Linha label="Parcelas vinculadas" value={relatorio.parcelas} />
              <Linha label="Movimentações bancárias" value={relatorio.transactions} />
              <Linha label="Conciliações" value={relatorio.conciliacoes} />
              <Linha label="Faturas vinculadas" value={relatorio.faturas} />
              <Linha label="Documentos vinculados" value={relatorio.documentos} />
              {!relatorio.itens &&
                !relatorio.parcelas &&
                !relatorio.transactions &&
                !relatorio.conciliacoes &&
                !relatorio.faturas &&
                !relatorio.documentos && (
                  <p className="text-muted-foreground">Nenhuma dependência vinculada.</p>
                )}
            </div>
          )}

          {relatorio?.duplicada_de && (
            <div className="rounded-2xl bg-primary/5 p-4">
              <p className="text-xs font-semibold text-primary">Esta compra parece duplicada de:</p>
              <p className="font-semibold">
                {relatorio.duplicada_de.estabelecimento} —{" "}
                {formatCurrency(Number(relatorio.duplicada_de.valor_total))}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(relatorio.duplicada_de.data_compra)} · mantenha apenas uma delas.
              </p>
            </div>
          )}

          {bloqueada && (
            <div className="rounded-2xl bg-destructive/10 p-4 text-destructive">
              <p className="font-semibold">
                Esta compra já possui histórico financeiro. Use cancelar/estornar em vez de excluir.
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs">
                {relatorio.bloqueios.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{bloqueada ? "Entendi" : "Cancelar"}</AlertDialogCancel>
          {!bloqueada && (
            <AlertDialogAction
              disabled={isLoading || remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending
                ? "Excluindo..."
                : relatorio?.duplicada_de
                  ? "Excluir duplicada"
                  : "Excluir compra"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
