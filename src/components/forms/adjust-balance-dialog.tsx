import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormActions, FormDialog } from "@/components/form-dialog";
import { adjustBankAccountBalance, type BankAccount } from "@/lib/bank-accounts";
import { formatCurrency } from "@/lib/finance";

/**
 * Correção de saldo da conta: nunca altera o saldo silenciosamente —
 * gera um lançamento de ajuste com a diferença e o motivo informado.
 */
export function AdjustBalanceDialog({
  account,
  familyId,
  onClose,
}: {
  account: BankAccount | null;
  familyId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [novoSaldo, setNovoSaldo] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");

  const saldoAtual = Number(account?.saldo_atual ?? 0);
  const diferenca = (novoSaldo ?? saldoAtual) - saldoAtual;

  const ajustar = useMutation({
    mutationFn: () =>
      adjustBankAccountBalance({
        accountId: account!.id,
        novoSaldo: novoSaldo ?? saldoAtual,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success("Saldo ajustado com lançamento registrado.");
      setNovoSaldo(null);
      setMotivo("");
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", familyId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={!!account}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Ajustar saldo"
      description="A diferença vira um lançamento de ajuste no extrato da conta."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (novoSaldo === null) {
            toast.error("Informe o saldo correto.");
            return;
          }
          if (diferenca === 0) {
            toast.error("O novo saldo é igual ao saldo atual.");
            return;
          }
          ajustar.mutate();
        }}
      >
        <div className="rounded-2xl bg-muted/60 p-4 text-sm">
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Saldo atual do sistema</span>
            <span className="font-semibold">{formatCurrency(saldoAtual)}</span>
          </p>
          <p className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">Diferença do ajuste</span>
            <span className="font-bold">
              {diferenca >= 0 ? "+" : "-"}
              {formatCurrency(Math.abs(diferenca))}
            </span>
          </p>
        </div>
        <Field label="Novo saldo correto">
          <CurrencyInput value={novoSaldo} onChange={setNovoSaldo} />
        </Field>
        <Field label="Motivo (opcional)">
          <input
            className={inputClass}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Conferência com o extrato do banco"
          />
        </Field>
        <FormActions onCancel={onClose} saving={ajustar.isPending} saveLabel="Confirmar ajuste" />
      </form>
    </FormDialog>
  );
}
