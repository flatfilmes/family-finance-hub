import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useMemberName } from "@/components/member-select";
import { Card, PrimaryButton } from "@/components/page-header";
import { formatCurrency } from "@/lib/finance";
import { PAYMENT_METHOD_LABELS, formatDate } from "@/lib/expenses";
import {
  PAYMENT_METHODS_REAIS,
  isAtrasada,
  isPendentePagamento,
  registerPurchasePayment,
  usesBankAccount,
  type PaymentMethodValue,
  type Purchase,
} from "@/lib/purchases";

const inputClass =
  "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Chaves de cache financeiro que mudam quando um pagamento é registrado. */
export function invalidateFinanceQueries(queryClient: ReturnType<typeof useQueryClient>, familyId: string) {
  for (const key of [
    "purchases",
    "bank-accounts",
    "transactions",
    "card-invoices",
    "expense-installments",
    "expenses",
  ]) {
    queryClient.invalidateQueries({ queryKey: [key, familyId] });
  }
}

/**
 * Diálogo "Registrar pagamento": transforma uma compra pendente em compra paga.
 * É aqui — e só aqui — que o impacto financeiro real acontece.
 */
export function RegistrarPagamentoDialog({
  purchase,
  onClose,
}: {
  purchase: Purchase;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: cards } = useCreditCards(purchase.family_id);
  const { data: contas } = useBankAccounts(purchase.family_id);

  const [formaPagamento, setFormaPagamento] = useState<PaymentMethodValue>("PIX");
  const [dataPagamento, setDataPagamento] = useState(today());
  const [contaId, setContaId] = useState("");
  const [cartaoId, setCartaoId] = useState("");

  const usaBanco = usesBankAccount(formaPagamento);
  const credito = formaPagamento === "CREDITO";

  const pagar = useMutation({
    mutationFn: () =>
      registerPurchasePayment({
        purchase,
        formaPagamento,
        dataPagamento,
        bankAccountId: contaId || null,
        creditCardId: cartaoId || null,
        cards: cards ?? [],
      }),
    onSuccess: () => {
      toast.success("Pagamento registrado.");
      invalidateFinanceQueries(queryClient, purchase.family_id);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (usaBanco && !contaId) {
      toast.error("Selecione a conta bancária do pagamento.");
      return;
    }
    if (credito && !cartaoId) {
      toast.error("Selecione o cartão utilizado.");
      return;
    }
    pagar.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Registrar pagamento da compra"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg space-y-4 rounded-3xl bg-card p-6 shadow-soft"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold">Registrar pagamento</h2>
            <p className="text-sm text-muted-foreground">
              {purchase.estabelecimento} · {formatCurrency(Number(purchase.valor_total))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Forma de pagamento">
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value as PaymentMethodValue)}
              className={inputClass}
            >
              {PAYMENT_METHODS_REAIS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data do pagamento">
            <input
              type="date"
              value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)}
              className={inputClass}
            />
          </Field>
          {usaBanco && (
            <Field label="Conta bancária">
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
                className={inputClass}
              >
                <option value="">Selecione</option>
                {(contas ?? [])
                  .filter((c) => c.ativo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.banco} · {c.nome_conta}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {credito && (
            <Field label="Cartão">
              <select
                value={cartaoId}
                onChange={(e) => setCartaoId(e.target.value)}
                className={inputClass}
              >
                <option value="">Selecione</option>
                {(cards ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome_cartao} · {c.banco}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          Só agora o pagamento é lançado: Pix, débito e transferência saem da conta escolhida;
          crédito vira compromisso na fatura do cartão; dinheiro não altera saldo bancário.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <PrimaryButton type="submit" disabled={pagar.isPending}>
            {pagar.isPending ? "Registrando..." : "Confirmar pagamento"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}

/** Lista de compras já registradas que ainda aguardam pagamento. */
export function PagamentosPendentesCard({
  familyId,
  purchases,
  onRegistrar,
  podeLancar,
}: {
  familyId: string;
  purchases: Purchase[];
  onRegistrar: (purchase: Purchase) => void;
  podeLancar: boolean;
}) {
  const memberName = useMemberName(familyId);
  const pendentes = purchases
    .filter(isPendentePagamento)
    .sort((a, b) =>
      (a.data_prevista_pagamento ?? a.data_compra).localeCompare(
        b.data_prevista_pagamento ?? b.data_compra,
      ),
    );

  if (pendentes.length === 0) return null;

  const total = pendentes.reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Pagamentos pendentes</h2>
        <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          {pendentes.length} compra(s) · {formatCurrency(total)}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {pendentes.map((p) => {
          const atrasada = isAtrasada(p);
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-52 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {p.estabelecimento}
                  {atrasada && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
                      <AlertTriangle className="size-3" /> Atrasada
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Compra em {formatDate(p.data_compra)} · {memberName(p.member_id)}
                  {p.data_prevista_pagamento
                    ? ` · previsão de pagamento em ${formatDate(p.data_prevista_pagamento)}`
                    : " · sem data prevista"}
                </p>
              </div>
              <span className="text-sm font-bold">{formatCurrency(Number(p.valor_total))}</span>
              {podeLancar && (
                <button
                  type="button"
                  onClick={() => onRegistrar(p)}
                  className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Registrar pagamento
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
