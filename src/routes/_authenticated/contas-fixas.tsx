import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { MemberSelect, useMemberName } from "@/components/member-select";
import { useFixedExpenses } from "@/hooks/useFinanceData";
import { NoFamily } from "./receitas";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_RECURRENCE_LABELS,
  createFixedExpense,
  deleteFixedExpense,
  formatCurrency,
  monthlyExpenseValue,
  toggleFixedExpense,
  type ExpenseCategory,
  type ExpenseRecurrence,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/contas-fixas")({
  head: () => ({
    meta: [
      { title: "Contas Fixas — Família Finance AI" },
      {
        name: "description",
        content: "Cadastre energia, água, internet, aluguel e outras contas fixas da família.",
      },
      { property: "og:title", content: "Contas Fixas — Família Finance AI" },
      { property: "og:description", content: "Organize as contas fixas da sua família." },
    ],
  }),
  component: ContasFixasPage,
});

function ContasFixasPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: expenses, isLoading } = useFixedExpenses(family?.id);
  const queryClient = useQueryClient();

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [categoria, setCategoria] = useState<ExpenseCategory>("ENERGIA");
  const [recorrencia, setRecorrencia] = useState<ExpenseRecurrence>("MENSAL");
  const [vencimento, setVencimento] = useState("5");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["fixed-expenses", family?.id] });

  const create = useMutation({
    mutationFn: () =>
      createFixedExpense({
        family_id: family!.id,
        created_by: user?.id ?? null,
        descricao,
        categoria,
        recorrencia,
        valor: Number(valor.replace(",", ".")) || 0,
        vencimento: Math.min(31, Math.max(1, Number(vencimento) || 1)),
        member_id: memberId || null,
      }),
    onSuccess: () => {
      setDescricao("");
      setValor("");
      toast.success("Conta fixa cadastrada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFixedExpense(id),
    onSuccess: () => {
      toast.success("Conta removida.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => toggleFixedExpense(id, ativo),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const total = (expenses ?? [])
    .filter((e) => e.ativo)
    .reduce((acc, e) => acc + monthlyExpenseValue(e), 0);

  if (!family) return <NoFamily />;

  return (
    <div>
      <PageHeader
        title="Contas Fixas"
        subtitle="Energia, água, internet, aluguel, financiamentos e assinaturas."
      />

      <Card>
        <h2 className="text-base font-bold">Nova conta fixa</h2>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!descricao.trim()) {
              toast.error("Informe a descrição.");
              return;
            }
            create.mutate();
          }}
        >
          <Field label="Descrição">
            <input
              className={inputClass}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Conta de luz, aluguel..."
            />
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
          <Field label="Categoria">
            <select
              className={inputClass}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as ExpenseCategory)}
            >
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recorrência">
            <select
              className={inputClass}
              value={recorrencia}
              onChange={(e) => setRecorrencia(e.target.value as ExpenseRecurrence)}
            >
              {Object.entries(EXPENSE_RECURRENCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <MemberSelect familyId={family?.id} value={memberId} onChange={setMemberId} />
          <Field label="Dia do vencimento">
            <input
              className={inputClass}
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              inputMode="numeric"
              placeholder="5"
            />
          </Field>
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={create.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Plus className="size-4" />
                {create.isPending ? "Salvando..." : "Adicionar conta"}
              </span>
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Contas cadastradas</h2>
          <p className="text-sm text-muted-foreground">
            Total mensal ativo:{" "}
            <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
          </p>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : expenses?.length ? (
          <ul className="mt-4 divide-y divide-border">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{e.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {EXPENSE_CATEGORY_LABELS[e.categoria]} ·{" "}
                    {EXPENSE_RECURRENCE_LABELS[e.recorrencia]} · vence dia {e.vencimento}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-bold">{formatCurrency(Number(e.valor))}</span>
                  <button
                    type="button"
                    onClick={() => toggle.mutate({ id: e.id, ativo: !e.ativo })}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    {e.ativo ? "Ativa" : "Inativa"}
                  </button>
                  <button
                    type="button"
                    aria-label="Remover conta"
                    onClick={() => remove.mutate(e.id)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma conta fixa cadastrada ainda.</p>
        )}
      </Card>
    </div>
  );
}
