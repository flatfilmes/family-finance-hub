import { useState } from "react";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormActions, FormDialog } from "@/components/form-dialog";
import { useRegisterBankMovement } from "@/hooks/useBankMovements";
import { useIncomes } from "@/hooks/useFinanceData";
import {
  DEPOSIT_NATURES,
  MOVEMENT_NATURE_LABELS,
  WITHDRAWAL_NATURES,
  type MovementNature,
} from "@/lib/bank-movements";
import { formatCurrency } from "@/lib/finance";
import type { BankAccount } from "@/lib/bank-accounts";

const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Depósito ou retirada manual em uma conta.
 * Depósito nunca cria receita e retirada nunca cria compra: o vínculo é opcional.
 */
export function MovementDialog({
  account,
  familyId,
  direcao,
  onClose,
}: {
  account: BankAccount | null;
  familyId: string;
  direcao: "ENTRADA" | "SAIDA";
  onClose: () => void;
}) {
  const isDeposito = direcao === "ENTRADA";
  const naturezas = isDeposito ? DEPOSIT_NATURES : WITHDRAWAL_NATURES;

  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(hoje());
  const [descricao, setDescricao] = useState("");
  const [natureza, setNatureza] = useState<MovementNature>("DINHEIRO");
  const [incomeId, setIncomeId] = useState("");
  const [observacao, setObservacao] = useState("");

  const { data: incomes } = useIncomes(familyId);
  const registrar = useRegisterBankMovement(familyId);

  const saldo = Number(account?.saldo_atual ?? 0);
  const saldoDepois = isDeposito ? saldo + (valor ?? 0) : saldo - (valor ?? 0);

  function reset() {
    setValor(null);
    setData(hoje());
    setDescricao("");
    setNatureza("DINHEIRO");
    setIncomeId("");
    setObservacao("");
  }

  function fechar() {
    reset();
    onClose();
  }

  return (
    <FormDialog
      open={!!account}
      onOpenChange={(open) => {
        if (!open) fechar();
      }}
      title={isDeposito ? "Registrar depósito" : "Registrar retirada"}
      description={
        isDeposito
          ? "Entrada de dinheiro nesta conta. Não vira receita automaticamente."
          : "Saída de dinheiro desta conta. Não vira despesa automaticamente."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!account) return;
          if (!valor || valor <= 0) {
            toast.error("Informe um valor maior que zero.");
            return;
          }
          registrar.mutate(
            {
              accountId: account.id,
              direcao,
              valor,
              data,
              natureza,
              ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
              ...(isDeposito && natureza === "RECEITA" && incomeId ? { incomeId } : {}),
              ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
            },
            {
              onSuccess: () => {
                toast.success(isDeposito ? "Depósito registrado." : "Retirada registrada.");
                fechar();
              },
              onError: (err: Error) => toast.error(err.message),
            },
          );
        }}
      >
        <Field label="Valor">
          <CurrencyInput value={valor} onChange={setValor} />
        </Field>
        <Field label="Data">
          <input
            type="date"
            className={inputClass}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </Field>
        <Field label="Descrição">
          <input
            className={inputClass}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={isDeposito ? "Depósito em dinheiro" : "Saque no caixa eletrônico"}
          />
        </Field>
        <Field label={isDeposito ? "Origem do dinheiro" : "Destino / motivo"}>
          <select
            className={inputClass}
            value={natureza}
            onChange={(e) => setNatureza(e.target.value as MovementNature)}
          >
            {naturezas.map((n) => (
              <option key={n} value={n}>
                {MOVEMENT_NATURE_LABELS[n]}
              </option>
            ))}
          </select>
        </Field>

        {isDeposito && natureza === "RECEITA" && (
          <Field label="Vincular a uma receita (opcional)">
            <select
              className={inputClass}
              value={incomeId}
              onChange={(e) => setIncomeId(e.target.value)}
            >
              <option value="">Não vincular</option>
              {(incomes ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.descricao} — {formatCurrency(Number(i.valor) || 0)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Observação (opcional)">
          <input
            className={inputClass}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Detalhe para conferir depois no extrato"
          />
        </Field>

        <div className="rounded-2xl bg-muted/60 p-4 text-sm">
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Saldo atual</span>
            <span className="font-semibold">{formatCurrency(saldo)}</span>
          </p>
          <p className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">Saldo depois</span>
            <span className="font-bold">{formatCurrency(saldoDepois)}</span>
          </p>
        </div>

        <p className="rounded-2xl bg-primary/5 p-3 text-xs text-muted-foreground">
          {isDeposito
            ? "Este lançamento entra no extrato como movimentação bancária. Entradas não são contadas como receita da família."
            : "Este lançamento entra no extrato como movimentação bancária. Saídas não são contadas como gasto da família."}
        </p>

        <FormActions
          onCancel={fechar}
          saving={registrar.isPending}
          saveLabel={isDeposito ? "Registrar depósito" : "Registrar retirada"}
        />
      </form>
    </FormDialog>
  );
}
