import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormActions, FormDialog } from "@/components/form-dialog";
import { Field, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useTransfer } from "@/hooks/useTransactions";
import { useRegisterBankMovement } from "@/hooks/useBankMovements";
import { formatCurrency } from "@/lib/finance";
import type { BankAccount } from "@/lib/bank-accounts";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Valor usado no seletor de destino para uma conta fora da família. */
const EXTERNA = "__EXTERNA__";

/**
 * Transferência entre contas da família (saldo total inalterado) ou para uma
 * conta externa (apenas saída bancária, sem virar gasto automaticamente).
 */
export function TransferDialog({
  open,
  onOpenChange,
  familyId,
  accounts,
  defaultOrigem,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  familyId: string;
  accounts: BankAccount[];
  /** Conta já selecionada como origem (ex.: abriu pela página da conta). */
  defaultOrigem?: string;
}) {
  const [origem, setOrigem] = useState(defaultOrigem ?? "");
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(todayISO());
  const [descricao, setDescricao] = useState("");
  const transfer = useTransfer(familyId);
  const registrar = useRegisterBankMovement(familyId);

  useEffect(() => {
    if (open) setOrigem(defaultOrigem ?? "");
  }, [open, defaultOrigem]);

  const valorNum = valor ?? 0;
  const externa = destino === EXTERNA;
  const contaOrigem = accounts.find((a) => a.id === origem);
  const saldoInsuficiente = !!contaOrigem && valorNum > Number(contaOrigem.saldo_atual);
  const salvando = transfer.isPending || registrar.isPending;

  function reset() {
    setOrigem(defaultOrigem ?? "");
    setDestino("");
    setValor(null);
    setData(todayISO());
    setDescricao("");
  }

  function fechar() {
    reset();
    onOpenChange(false);
  }

  function submit() {
    if (!origem || !destino) {
      toast.error("Escolha a conta de origem e o destino.");
      return;
    }
    if (!externa && origem === destino) {
      toast.error("As contas de origem e destino devem ser diferentes.");
      return;
    }
    if (valorNum <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (saldoInsuficiente) {
      toast.error("Saldo insuficiente na conta de origem.");
      return;
    }

    if (externa) {
      registrar.mutate(
        {
          accountId: origem,
          direcao: "SAIDA",
          valor: valorNum,
          data,
          natureza: "TRANSFERENCIA_EXTERNA",
          descricao: descricao.trim() || "Transferência para conta externa",
        },
        {
          onSuccess: () => {
            toast.success("Transferência externa registrada como saída bancária.");
            fechar();
          },
          onError: (e: Error) => toast.error(e.message),
        },
      );
      return;
    }

    transfer.mutate(
      {
        origemId: origem,
        destinoId: destino,
        valor: valorNum,
        data,
        ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Transferência registrada.");
          fechar();
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Transferir dinheiro"
      description="Entre contas da família o saldo total continua o mesmo. Para conta externa, registramos apenas a saída."
    >
      <form
        className="grid gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <Field label="De (origem)">
          <select className={inputClass} value={origem} onChange={(e) => setOrigem(e.target.value)}>
            <option value="">Selecione</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.banco} · {a.nome_conta} — {formatCurrency(Number(a.saldo_atual))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Para (destino)">
          <select
            className={inputClass}
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          >
            <option value="">Selecione</option>
            {accounts
              .filter((a) => a.id !== origem)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.banco} · {a.nome_conta} — {formatCurrency(Number(a.saldo_atual))}
                </option>
              ))}
            <option value={EXTERNA}>Conta externa (fora da família)</option>
          </select>
        </Field>
        <Field label="Valor">
          <CurrencyInput value={valor} onChange={setValor} />
        </Field>
        {saldoInsuficiente && (
          <p className="text-xs font-semibold text-destructive">
            Saldo insuficiente: a conta de origem tem{" "}
            {formatCurrency(Number(contaOrigem?.saldo_atual))}.
          </p>
        )}
        <Field label="Data">
          <input
            type="date"
            className={inputClass}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </Field>
        <Field label="Descrição (opcional)">
          <input
            className={inputClass}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Reserva, pagamento de conta..."
          />
        </Field>
        <p className="rounded-2xl bg-primary/5 p-3 text-xs text-muted-foreground">
          {externa
            ? "Transferência externa não é classificada como gasto automaticamente. Depois você pode registrar a compra correspondente, se existir."
            : "Transferência interna não é receita nem gasto: o dinheiro apenas muda de conta."}
        </p>
        <FormActions onCancel={fechar} saving={salvando} saveLabel="Transferir" />
      </form>
    </FormDialog>
  );
}
