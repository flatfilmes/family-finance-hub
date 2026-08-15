import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useIncomes } from "@/hooks/useFinanceData";
import {
  INCOME_FREQUENCY_LABELS,
  INCOME_TYPE_LABELS,
  createIncome,
  deleteIncome,
  formatCurrency,
  monthlyIncomeValue,
  toggleIncome,
  type IncomeFrequency,
  type IncomeType,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/receitas")({
  head: () => ({
    meta: [
      { title: "Receitas — Família Finance AI" },
      {
        name: "description",
        content: "Cadastre salários, comissões e rendas extras da sua família.",
      },
      { property: "og:title", content: "Receitas — Família Finance AI" },
      { property: "og:description", content: "Controle as receitas da sua família." },
    ],
  }),
  component: ReceitasPage,
});

function ReceitasPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: incomes, isLoading } = useIncomes(family?.id);
  const queryClient = useQueryClient();

  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState<IncomeType>("FIXA");
  const [frequencia, setFrequencia] = useState<IncomeFrequency>("MENSAL");
  const [dataRecebimento, setDataRecebimento] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["incomes", family?.id] });

  const create = useMutation({
    mutationFn: () =>
      createIncome({
        family_id: family!.id,
        created_by: user?.id ?? null,
        descricao,
        valor: Number(valor.replace(",", ".")) || 0,
        tipo,
        frequencia,
        data_recebimento: dataRecebimento || null,
      }),
    onSuccess: () => {
      setDescricao("");
      setValor("");
      setDataRecebimento("");
      toast.success("Receita cadastrada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteIncome(id),
    onSuccess: () => {
      toast.success("Receita removida.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => toggleIncome(id, ativo),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const total = (incomes ?? [])
    .filter((i) => i.ativo)
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);

  if (!family) return <NoFamily />;

  return (
    <div>
      <PageHeader
        title="Receitas"
        subtitle="Salário, comissões, renda extra e outras entradas da sua família."
      />

      <Card>
        <h2 className="text-base font-bold">Nova receita</h2>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!descricao.trim()) return toast.error("Informe a descrição.");
            create.mutate();
          }}
        >
          <Field label="Descrição">
            <input
              className={inputClass}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Salário, comissão, renda extra..."
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
          <Field label="Tipo">
            <select
              className={inputClass}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as IncomeType)}
            >
              {Object.entries(INCOME_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frequência">
            <select
              className={inputClass}
              value={frequencia}
              onChange={(e) => setFrequencia(e.target.value as IncomeFrequency)}
            >
              {Object.entries(INCOME_FREQUENCY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data de recebimento">
            <input
              type="date"
              className={inputClass}
              value={dataRecebimento}
              onChange={(e) => setDataRecebimento(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={create.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Plus className="size-4" />
                {create.isPending ? "Salvando..." : "Adicionar receita"}
              </span>
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Receitas cadastradas</h2>
          <p className="text-sm text-muted-foreground">
            Total mensal ativo:{" "}
            <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
          </p>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : incomes?.length ? (
          <ul className="mt-4 divide-y divide-border">
            {incomes.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{i.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {INCOME_TYPE_LABELS[i.tipo]} · {INCOME_FREQUENCY_LABELS[i.frequencia]}
                    {i.data_recebimento ? ` · ${i.data_recebimento.split("-").reverse().join("/")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-bold">{formatCurrency(Number(i.valor))}</span>
                  <button
                    type="button"
                    onClick={() => toggle.mutate({ id: i.id, ativo: !i.ativo })}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    {i.ativo ? "Ativa" : "Inativa"}
                  </button>
                  <button
                    type="button"
                    aria-label="Remover receita"
                    onClick={() => remove.mutate(i.id)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma receita cadastrada ainda.</p>
        )}
      </Card>
    </div>
  );
}

export function NoFamily() {
  return (
    <div>
      <PageHeader
        title="Crie sua família primeiro"
        subtitle="Os dados financeiros pertencem a uma família. Crie a sua para começar."
      />
      <Card>
        <Link to="/minha-familia" className="text-sm font-semibold text-primary">
          Ir para Minha Família
        </Link>
      </Card>
    </div>
  );
}
