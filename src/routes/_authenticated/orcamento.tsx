import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useBudgetProgress, useBudgets } from "@/hooks/useBudgets";
import { NoFamily } from "./receitas";
import { formatCurrency } from "@/lib/finance";
import { monthLabel } from "@/lib/expenses";
import {
  BUDGET_PERIOD_LABELS,
  BUDGET_STATUS_CLASSES,
  BUDGET_STATUS_LABELS,
  createBudget,
  deleteBudget,
  updateBudget,
  type BudgetPeriod,
} from "@/lib/budgets";

export const Route = createFileRoute("/_authenticated/orcamento")({
  head: () => ({
    meta: [
      { title: "Orçamento Familiar — Família Finance AI" },
      {
        name: "description",
        content:
          "Defina limites de gastos por categoria e acompanhe o progresso do orçamento da família.",
      },
      { property: "og:title", content: "Orçamento Familiar — Família Finance AI" },
      {
        property: "og:description",
        content: "Planeje limites por categoria e veja se a família está dentro do planejado.",
      },
    ],
  }),
  component: OrcamentoPage,
});

type FormState = { category_id: string; valor_planejado: string; periodo: BudgetPeriod };

const emptyForm = (): FormState => ({ category_id: "", valor_planejado: "", periodo: "MENSAL" });

function OrcamentoPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: categories } = useExpenseCategories();
  const { data: budgets } = useBudgets(family?.id);
  const progress = useBudgetProgress(family?.id);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budgets"] });

  const payload = () => ({
    category_id: form.category_id || null,
    valor_planejado: Number(form.valor_planejado.replace(",", ".")) || 0,
    periodo: form.periodo,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editingId) return updateBudget(editingId, payload());
      return createBudget({ family_id: family!.id, created_by: user?.id ?? null, ...payload() });
    },
    onSuccess: () => {
      toast.success(editingId ? "Orçamento atualizado." : "Orçamento criado.");
      setForm(emptyForm());
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate")
          ? "Já existe um orçamento para essa categoria."
          : e.message,
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBudget(id),
    onSuccess: () => {
      toast.success("Orçamento excluído.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!family) return <NoFamily />;

  return (
    <div>
      <PageHeader
        title="Orçamento Familiar"
        subtitle={`Limites de gastos por categoria e acompanhamento do progresso em ${monthLabel(progress.month)}.`}
      />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">
            {editingId ? "Editar orçamento" : "Novo orçamento"}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" /> Cancelar
            </button>
          )}
        </div>

        <form
          className="mt-5 grid gap-4 sm:grid-cols-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!form.category_id) {
              toast.error("Selecione a categoria.");
              return;
            }
            save.mutate();
          }}
        >
          <Field label="Categoria">
            <select
              className={inputClass}
              value={form.category_id}
              onChange={(e) => set("category_id", e.target.value)}
            >
              <option value="">Selecione</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor planejado (R$)">
            <input
              className={inputClass}
              value={form.valor_planejado}
              onChange={(e) => set("valor_planejado", e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
          <Field label="Período">
            <select
              className={inputClass}
              value={form.periodo}
              onChange={(e) => set("periodo", e.target.value as BudgetPeriod)}
            >
              {Object.entries(BUDGET_PERIOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end sm:col-span-3">
            <PrimaryButton type="submit" disabled={save.isPending}>
              <span className="inline-flex items-center gap-2">
                <Plus className="size-4" />
                {editingId ? "Salvar alterações" : "Criar orçamento"}
              </span>
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-bold">Progresso do orçamento</h2>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(progress.totalGasto)} de {formatCurrency(progress.totalPlanejado)}{" "}
            planejados
          </p>
        </div>

        {progress.isLoading ? (
          <p className="mt-5 text-sm text-muted-foreground">Carregando...</p>
        ) : progress.items.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Nenhum orçamento definido ainda. Crie o primeiro limite por categoria acima.
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {progress.items.map((item) => {
              const cls = BUDGET_STATUS_CLASSES[item.status];
              const budget = budgets?.find((b) => b.id === item.id);
              return (
                <li key={item.id} className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{item.categoria}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.gasto)} de {formatCurrency(item.planejado)} ·{" "}
                        {item.restante >= 0
                          ? `${formatCurrency(item.restante)} disponível`
                          : `${formatCurrency(Math.abs(item.restante))} acima`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls.badge}`}
                      >
                        {item.percentual.toFixed(0)}% · {BUDGET_STATUS_LABELS[item.status]}
                      </span>
                      <button
                        aria-label="Editar orçamento"
                        onClick={() => {
                          if (!budget) return;
                          setEditingId(budget.id);
                          setForm({
                            category_id: budget.category_id ?? "",
                            valor_planejado: String(budget.valor_planejado ?? ""),
                            periodo: budget.periodo,
                          });
                          if (typeof window !== "undefined")
                            window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        aria-label="Excluir orçamento"
                        onClick={() => remove.mutate(item.id)}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${cls.bar}`}
                      style={{ width: `${Math.min(100, item.percentual)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
