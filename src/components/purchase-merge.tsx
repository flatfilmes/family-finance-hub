import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import { inspectPurchaseMerge, mergeDuplicatePurchase } from "@/lib/purchases";

type Props = {
  /** Compra que deve permanecer (normalmente a criada pela nota fiscal). */
  principalId: string;
  /** Compra criada pela fatura, que será absorvida. */
  duplicadaId: string;
  onClose: () => void;
  onMerged?: () => void;
};

function Card({
  titulo,
  nome,
  valor,
  data,
  detalhes,
  destaque,
}: {
  titulo: string;
  nome: string;
  valor: number;
  data: string;
  detalhes: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destaque ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <p className="mt-1 font-semibold leading-tight">{nome}</p>
      <p className="text-sm font-semibold">{formatCurrency(valor)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatDate(data)} · {detalhes}
      </p>
    </div>
  );
}

/**
 * Mesclagem de compras duplicadas: a nota fiscal é a compra,
 * a fatura é a cobrança. Ao mesclar, uma única compra permanece
 * com os produtos da nota e o parcelamento da fatura.
 */
export function MergePurchaseDialog({ principalId, duplicadaId, onClose, onMerged }: Props) {
  const queryClient = useQueryClient();
  const [invertido, setInvertido] = useState(false);
  const principal = invertido ? duplicadaId : principalId;
  const duplicada = invertido ? principalId : duplicadaId;

  const { data: relatorio, isLoading, error } = useQuery({
    queryKey: ["purchase-merge", principal, duplicada],
    queryFn: () => inspectPurchaseMerge(principal, duplicada),
  });

  const merge = useMutation({
    mutationFn: () => mergeDuplicatePurchase(principal, duplicada),
    onSuccess: (r) => {
      toast.success(
        r.parcelas_transferidas > 0
          ? `Compras mescladas. ${r.parcelas_transferidas} parcela(s) transferida(s).`
          : "Compras mescladas com sucesso.",
      );
      void queryClient.invalidateQueries();
      onMerged?.();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bloqueada = !!relatorio && !relatorio.pode_mesclar;

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Mesclar compras duplicadas</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            A nota fiscal representa a compra; a fatura do cartão representa a cobrança. Ao
            mesclar, permanece uma única compra com os produtos da nota e o parcelamento da
            fatura.
          </p>

          {isLoading && <p className="text-muted-foreground">Verificando as duas compras...</p>}
          {error && <p className="text-destructive">{(error as Error).message}</p>}

          {relatorio && (
            <div className="space-y-2">
              <Card
                titulo="Compra principal (será mantida)"
                nome={relatorio.principal.estabelecimento}
                valor={Number(relatorio.principal.valor_total)}
                data={relatorio.principal.data_compra}
                detalhes={`${relatorio.principal.itens} produto(s) · ${relatorio.principal.parcelas} parcela(s)`}
                destaque
              />
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <ArrowRight className="size-4 rotate-90" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full text-xs"
                  onClick={() => setInvertido((v) => !v)}
                >
                  <ArrowLeftRight className="mr-1 size-3.5" /> Inverter
                </Button>
              </div>
              <Card
                titulo="Registro duplicado (será removido)"
                nome={relatorio.duplicada.estabelecimento}
                valor={Number(relatorio.duplicada.valor_total)}
                data={relatorio.duplicada.data_compra}
                detalhes={`${relatorio.duplicada.itens} produto(s) · ${relatorio.duplicada.parcelas} parcela(s)`}
              />

              <div className="rounded-2xl border border-border p-4 text-xs">
                <p className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
                  Será transferido para a compra principal
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>{relatorio.duplicada.parcelas} parcela(s) do cartão</li>
                  <li>{relatorio.duplicada.itens_fatura} lançamento(s) de fatura</li>
                  <li>{relatorio.duplicada.conciliacoes} conciliação(ões)</li>
                  <li>Cartão, forma de pagamento e status de cobrança</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                  O valor total e os produtos da compra principal não mudam.
                </p>
              </div>
            </div>
          )}

          {bloqueada && (
            <div className="rounded-2xl bg-destructive/10 p-4 text-destructive">
              <p className="font-semibold">Não é possível mesclar estas compras.</p>
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
              disabled={isLoading || merge.isPending || !relatorio}
              onClick={(e) => {
                e.preventDefault();
                merge.mutate();
              }}
            >
              {merge.isPending ? "Mesclando..." : "Mesclar compras"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
