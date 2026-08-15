import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useExpenseCategories, useExpenses } from "@/hooks/useExpenses";
import { NoFamily } from "./receitas";
import { formatCurrency } from "@/lib/finance";
import { clearInstallments, generateInstallments } from "@/lib/card-invoices";
import { MemberSelect, useMemberName } from "@/components/member-select";
import { MemberFilter } from "@/components/member-filter";

import {
  PAYMENT_METHOD_LABELS,
  PURCHASE_TYPE_LABELS,
  createExpense,
  currentMonth,
  deleteExpense,
  formatDate,
  monthLabel,
  updateExpense,
  type Expense,
  type PaymentMethod,
  type PurchaseType,
} from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/despesas")({
  head: () => ({
    meta: [
      { title: "Despesas — Família Finance AI" },
      {
        name: "description",
        content: "Registre e organize as despesas reais da sua família por período e categoria.",
      },
      { property: "og:title", content: "Despesas — Família Finance AI" },
      { property: "og:description", content: "Lançamentos de despesas reais da sua família." },
    ],
  }),
  component: DespesasPage,
});

type FormState = {
  descricao: string;
  valor: string;
  data_compra: string;
  forma_pagamento: PaymentMethod;
  categoria_id: string;
  tipo_compra: PurchaseType;
  cartao_id: string;
  parcelas_total: string;
  parcela_atual: string;
  member_id: string;
  observacao: string;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emptyForm = (): FormState => ({
  descricao: "",
  valor: "",
  data_compra: todayISO(),
  forma_pagamento: "PIX",
  categoria_id: "",
  tipo_compra: "A_VISTA",
  cartao_id: "",
  parcelas_total: "1",
  parcela_atual: "1",
  member_id: "",
  observacao: "",
});

function DespesasPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: categories } = useExpenseCategories();
  const { data: cards } = useCreditCards(family?.id);
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(currentMonth());
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [membroFiltro, setMembroFiltro] = useState("");
  const [cartaoFiltro, setCartaoFiltro] = useState("");
  const filters = useMemo(
    () => ({
      month: month || undefined,
      categoriaId: categoriaFiltro || undefined,
      memberId: membroFiltro || undefined,
      cartaoId: cartaoFiltro || undefined,
    }),
    [month, categoriaFiltro, membroFiltro, cartaoFiltro],
  );
  const { data: expenses, isLoading } = useExpenses(family?.id, filters);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["expense-installments"] });
    queryClient.invalidateQueries({ queryKey: ["card-invoices"] });
  };

  const payload = () => ({
    descricao: form.descricao.trim(),
    valor: Number(form.valor.replace(",", ".")) || 0,
    data_compra: form.data_compra,
    forma_pagamento: form.forma_pagamento,
    categoria_id: form.categoria_id || null,
    tipo_compra: form.tipo_compra,
    cartao_id: form.tipo_compra === "A_VISTA" ? null : form.cartao_id || null,
    parcelas_total:
      form.tipo_compra === "PARCELADO" ? Math.max(1, Number(form.parcelas_total) || 1) : 1,
    parcela_atual:
      form.tipo_compra === "PARCELADO" ? Math.max(1, Number(form.parcela_atual) || 1) : 1,
    member_id: form.member_id || null,
    observacao: form.observacao.trim() || null,
  });

  /** Gera (ou regenera) as parcelas e faturas de uma despesa no cartão. */
  async function syncInstallments(expenseId: string, data: ReturnType<typeof payload>) {
    await clearInstallments(expenseId);
    if (!data.cartao_id) return;
    const card = (cards ?? []).find((c) => c.id === data.cartao_id);
    if (!card) return;
    await generateInstallments({
      familyId: family!.id,
      expenseId,
      card,
      dataCompra: data.data_compra,
      valorTotal: data.valor,
      parcelas: data.tipo_compra === "PARCELADO" ? data.parcelas_total : 1,
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const data = payload();
      if (editingId) {
        await updateExpense(editingId, data);
        await syncInstallments(editingId, data);
        return;
      }
      const created = await createExpense({
        family_id: family!.id,
        created_by: user?.id ?? null,
        ...data,
      });
      await syncInstallments(created.id, data);
    },
    onSuccess: () => {
      toast.success(editingId ? "Despesa atualizada." : "Despesa registrada.");
      setForm(emptyForm());
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await clearInstallments(id);
      await deleteExpense(id);
    },
    onSuccess: () => {
      toast.success("Despesa excluída.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  function startEdit(e: Expense) {
    setEditingId(e.id);
    setForm({
      descricao: e.descricao,
      valor: String(e.valor ?? ""),
      data_compra: e.data_compra,
      forma_pagamento: e.forma_pagamento,
      categoria_id: e.categoria_id ?? "",
      tipo_compra: e.tipo_compra,
      cartao_id: e.cartao_id ?? "",
      parcelas_total: String(e.parcelas_total ?? 1),
      parcela_atual: String(e.parcela_atual ?? 1),
      member_id: e.member_id ?? "",
      observacao: e.observacao ?? "",
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const total = (expenses ?? []).reduce((acc, e) => acc + (Number(e.valor) || 0), 0);
  const memberName = useMemberName(family?.id);
  const categoriaNome = (id: string | null) =>
    categories?.find((c) => c.id === id)?.nome ?? "Sem categoria";

  if (!family) return <NoFamily />;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Despesas"
          subtitle="Histórico consolidado da família: compras à vista, no cartão e parcelamentos."
        />
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setForm(emptyForm());
            setShowForm((v) => !v);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
        >
          {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
          {showForm ? "Fechar" : "Nova despesa"}
        </button>
      </div>

      {showForm && (
        <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{editingId ? "Editar despesa" : "Nova despesa"}</h2>
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
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!form.descricao.trim()) {
              toast.error("Informe a descrição.");
              return;
            }
            save.mutate();
          }}
        >
          <Field label="Descrição">
            <input
              className={inputClass}
              value={form.descricao}
              onChange={(e) => set("descricao", e.target.value)}
              placeholder="Supermercado, farmácia..."
            />
          </Field>
          <Field label="Valor (R$)">
            <input
              className={inputClass}
              value={form.valor}
              onChange={(e) => set("valor", e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
          <Field label="Data da compra">
            <input
              type="date"
              className={inputClass}
              value={form.data_compra}
              onChange={(e) => set("data_compra", e.target.value)}
            />
          </Field>
          <Field label="Categoria">
            <select
              className={inputClass}
              value={form.categoria_id}
              onChange={(e) => set("categoria_id", e.target.value)}
            >
              <option value="">Selecione</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de compra">
            <select
              className={inputClass}
              value={form.tipo_compra}
              onChange={(e) => set("tipo_compra", e.target.value as PurchaseType)}
            >
              {Object.entries(PURCHASE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <MemberSelect
            familyId={family?.id}
            value={form.member_id}
            onChange={(v) => set("member_id", v)}
          />
          <Field label="Forma de pagamento">
            <select
              className={inputClass}
              value={form.forma_pagamento}
              onChange={(e) => set("forma_pagamento", e.target.value as PaymentMethod)}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          {form.tipo_compra !== "A_VISTA" && (
            <Field label="Cartão (opcional)">
              <select
                className={inputClass}
                value={form.cartao_id}
                onChange={(e) => set("cartao_id", e.target.value)}
              >
                <option value="">Nenhum</option>
                {(cards ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome_cartao} · {c.banco}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.tipo_compra === "PARCELADO" && (
            <>
              <Field label="Total de parcelas">
                <input
                  className={inputClass}
                  value={form.parcelas_total}
                  onChange={(e) => set("parcelas_total", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Parcela atual">
                <input
                  className={inputClass}
                  value={form.parcela_atual}
                  onChange={(e) => set("parcela_atual", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </>
          )}

          <div className="sm:col-span-2">
            <Field label="Observação">
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                value={form.observacao}
                onChange={(e) => set("observacao", e.target.value)}
                placeholder="Detalhes do lançamento (opcional)"
              />
            </Field>
          </div>

          <div className="flex items-end sm:col-span-2">
            <PrimaryButton type="submit" disabled={save.isPending}>
              <span className="inline-flex items-center gap-2">
                <Plus className="size-4" />
                {editingId ? "Salvar alterações" : "Adicionar despesa"}
              </span>
            </PrimaryButton>
          </div>
        </form>
        </Card>
      )}

      <Card className="mt-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Período (mês)">
            <input
              type="month"
              className={inputClass}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
          <Field label="Categoria">
            <select
              className={inputClass}
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
            >
              <option value="">Todas</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
          <MemberFilter familyId={family.id} value={membroFiltro} onChange={setMembroFiltro} />
          <Field label="Cartão">
            <select
              className={inputClass}
              value={cartaoFiltro}
              onChange={(e) => setCartaoFiltro(e.target.value)}
              aria-label="Cartão"
            >
              <option value="">Todos</option>
              {(cards ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome_cartao} · {c.banco}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setMonth("");
                setCategoriaFiltro("");
                setMembroFiltro("");
                setCartaoFiltro("");
              }}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              Limpar filtros
            </button>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">
            Lançamentos {month ? `· ${monthLabel(month)}` : "· todos os períodos"}
          </h2>
          <span className="text-sm font-semibold text-primary">{formatCurrency(total)}</span>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : (expenses ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma despesa encontrada para os filtros selecionados.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {(expenses ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.descricao}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {memberName(e.member_id)} · {formatDate(e.data_compra)} ·{" "}
                    {categoriaNome(e.categoria_id)} ·{" "}
                    {PURCHASE_TYPE_LABELS[e.tipo_compra]}
                    {e.tipo_compra === "PARCELADO" &&
                      ` (${e.parcela_atual}/${e.parcelas_total})`}{" "}
                    · {PAYMENT_METHOD_LABELS[e.forma_pagamento]}
                  </p>
                  {e.observacao && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.observacao}</p>
                  )}
                </div>
                <span className="text-sm font-bold">{formatCurrency(Number(e.valor))}</span>
                <button
                  onClick={() => startEdit(e)}
                  aria-label="Editar despesa"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => remove.mutate(e.id)}
                  aria-label="Excluir despesa"
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
