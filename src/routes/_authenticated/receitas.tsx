import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { useIncomes } from "@/hooks/useFinanceData";
import { useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import {
  INCOME_FREQUENCY_LABELS,
  INCOME_TYPE_LABELS,
  formatCurrency,
  monthlyIncomeValue,
  type IncomeType,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/receitas")({
  head: () => ({
    meta: [
      { title: "Receitas da Família — Família Finance AI" },
      {
        name: "description",
        content: "Visão consolidada de todas as entradas da família, por pessoa, tipo e período.",
      },
      { property: "og:title", content: "Receitas da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Todas as receitas da família reunidas em uma única visão.",
      },
    ],
  }),
  component: ReceitasPage,
});

function ReceitasPage() {
  const { data: family } = useFamily();
  const { data: incomes, isLoading } = useIncomes(family?.id);
  const memberName = useMemberName(family?.id);

  const [filtroMembro, setFiltroMembro] = useState("");
  const view = useViewMode();
  const [filtroTipo, setFiltroTipo] = useState<"" | IncomeType>("");
  const [mes, setMes] = useState("");

  if (!family) return <NoFamily />;

  const lista = filterByMember(incomes ?? [], view.scoped(filtroMembro))
    .filter((i) => (filtroTipo ? i.tipo === filtroTipo : true))
    .filter((i) => (mes ? (i.data_recebimento ?? "").startsWith(mes) : true));

  const total = lista.filter((i) => i.ativo).reduce((acc, i) => acc + monthlyIncomeValue(i), 0);

  return (
    <div>
      <PageHeader
        title="Receitas da família"
        subtitle="Visão consolidada de tudo o que entra. O cadastro acontece no perfil de cada pessoa."
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          {view.isAdmin ? (
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          ) : (
            <div className="flex items-end">
              <ViewModeSwitch mode={view.mode} onChange={view.setMode} canSwitch={false} />
            </div>
          )}
          <Field label="Tipo">
            <select
              className={inputClass}
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as "" | IncomeType)}
              aria-label="Tipo"
            >
              <option value="">Todos</option>
              {Object.entries(INCOME_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período (mês do recebimento)">
            <input
              type="month"
              className={inputClass}
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Entradas</h2>
          <span className="text-sm font-semibold text-primary">
            Total mensal ativo: {formatCurrency(total)}
          </span>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : lista.length ? (
          <ul className="mt-4 divide-y divide-border">
            {lista.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {memberName(i.member_id)} · {INCOME_TYPE_LABELS[i.tipo]} ·{" "}
                    {INCOME_FREQUENCY_LABELS[i.frequencia]}
                    {i.data_recebimento
                      ? ` · ${i.data_recebimento.split("-").reverse().join("/")}`
                      : ""}
                    {i.ativo ? "" : " · inativa"}
                  </p>
                </div>
                <span className="text-sm font-bold">{formatCurrency(Number(i.valor))}</span>
                {i.member_id && (
                  <Link
                    to="/membro/$memberId"
                    params={{ memberId: i.member_id }}
                    className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Ver membro
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma receita encontrada. Abra o perfil de uma pessoa em Minha Família para cadastrar
            salário e comissões.
          </p>
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
