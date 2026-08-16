import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormActions, FormDialog } from "@/components/form-dialog";
import { setBankAccountBalance, type BankAccount } from "@/lib/bank-accounts";
import { formatCurrency } from "@/lib/finance";

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * "Informar saldo" da conta. Na primeira vez cria a posição de abertura;
 * depois vira ajuste com a diferença. Nunca entra como receita ou gasto.
 */
export function BalanceDialog({
  account,
  familyId,
  primeiraVez,
  saldoSugerido = null,
  onClose,
}: {
  account: BankAccount | null;
  familyId: string;
  /** Conta ainda sem posição de abertura registrada. */
  primeiraVez: boolean;
  /** Valor pré-preenchido (ex.: saldo lido de um print). */
  saldoSugerido?: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [saldo, setSaldo] = useState<number | null>(saldoSugerido);
  const [data, setData] = useState(hoje());
  const [motivo, setMotivo] = useState("");

  const saldoAtual = Number(account?.saldo_atual ?? 0);
  const diferenca = (saldo ?? saldoAtual) - saldoAtual;

  const salvar = useMutation({
    mutationFn: () =>
      setBankAccountBalance({
        accountId: account!.id,
        saldo: saldo ?? 0,
        data,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(
        primeiraVez ? "Posição inicial registrada." : "Saldo ajustado com lançamento auditável.",
      );
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
      title={primeiraVez ? "Informar saldo atual" : "Ajustar saldo"}
      description={
        primeiraVez
          ? "Este valor é a posição inicial da conta. Não é receita e não entra nos gastos."
          : "A diferença vira um lançamento de ajuste no extrato da conta."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (saldo === null) {
            toast.error("Informe o saldo da conta.");
            return;
          }
          if (!primeiraVez && diferenca === 0) {
            toast.error("O saldo informado é igual ao saldo do sistema.");
            return;
          }
          salvar.mutate();
        }}
      >
        {!primeiraVez && (
          <div className="rounded-2xl bg-muted/60 p-4 text-sm">
            <p className="flex items-center justify-between">
              <span className="text-muted-foreground">Saldo do sistema</span>
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
        )}
        <Field label={primeiraVez ? "Saldo atual da conta" : "Saldo correto"}>
          <CurrencyInput value={saldo} onChange={setSaldo} />
        </Field>
        <Field label="Data de referência">
          <input
            type="date"
            className={inputClass}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </Field>
        <Field label="Observação (opcional)">
          <input
            className={inputClass}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Conferência com o app do banco"
          />
        </Field>
        <p className="rounded-2xl bg-primary/5 p-3 text-xs text-muted-foreground">
          Registramos isto como <strong>posição da conta</strong>: não vira receita, não conta como
          consumo e não afeta o resultado do mês. Se depois você importar o extrato do mesmo
          período, o saldo informado continua sendo apenas o ponto de partida.
        </p>
        <FormActions
          onCancel={onClose}
          saving={salvar.isPending}
          saveLabel={primeiraVez ? "Registrar posição" : "Confirmar ajuste"}
        />
      </form>
    </FormDialog>
  );
}
