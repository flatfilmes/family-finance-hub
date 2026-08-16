import { useState } from "react";
import { toast } from "sonner";
import { FormActions, FormDialog } from "@/components/form-dialog";
import { Field, inputClass } from "@/components/page-header";
import { useTransfer } from "@/hooks/useTransactions";
import { formatCurrency } from "@/lib/finance";
import type { BankAccount } from "@/lib/bank-accounts";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Transferência entre contas da família.
 * O saldo total não muda — é apenas realocação de dinheiro entre contas.
 */
export function TransferDialog({
  open,
  onOpenChange,
  familyId,
  accounts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  familyId: string;
  accounts: BankAccount[];
}) {
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(todayISO());
  const [descricao, setDescricao] = useState("");
  const transfer = useTransfer(familyId);

  const valorNum = Number(valor.replace(",", ".")) || 0;
  const contaOrigem = accounts.find((a) => a.id === origem);
  const saldoInsuficiente = !!contaOrigem && valorNum > Number(contaOrigem.saldo_atual);

  function reset() {
    setOrigem("");
    setDestino("");
    setValor("");
    setData(todayISO());
    setDescricao("");
  }

  function submit() {
    if (!origem || !destino) {
      toast.error("Escolha a conta de origem e a de destino.");
      return;
    }
    if (origem === destino) {
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
          reset();
          onOpenChange(false);
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
      title="Transferir entre contas"
      description="O dinheiro muda de conta, mas o saldo total da família continua o mesmo."
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
        <select className={inputClass} value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Selecione</option>
          {accounts
            .filter((a) => a.id !== origem)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.banco} · {a.nome_conta} — {formatCurrency(Number(a.saldo_atual))}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Valor (R$)">
        <input
          className={inputClass}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
        />
      </Field>
      {saldoInsuficiente && (
        <p className="text-xs font-semibold text-destructive">
          Saldo insuficiente: a conta de origem tem {formatCurrency(Number(contaOrigem?.saldo_atual))}.
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
      <FormActions
        onCancel={() => {
          reset();
          onOpenChange(false);
        }}
        saving={transfer.isPending}
        saveLabel="Transferir"
      />
      </form>
    </FormDialog>
  );
}
