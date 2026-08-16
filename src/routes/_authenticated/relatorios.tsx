import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Card, PageHeader } from "@/components/page-header";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useIncomes, useFixedExpenses, useCreditCards } from "@/hooks/useFinanceData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useMonthlySpending } from "@/hooks/useMonthlySpending";
import { currentMonth, monthLabel } from "@/lib/expenses";
import { formatCurrency, monthlyIncomeValue, monthlyExpenseValue } from "@/lib/finance";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Família Finance AI" },
      {
        name: "description",
        content: "Visões consolidadas da família: receitas, contas fixas, contas bancárias e gastos.",
      },
      { property: "og:title", content: "Relatórios — Família Finance AI" },
      {
        property: "og:description",
        content: "Panorama consolidado da vida financeira da sua família.",
      },
    ],
  }),
  component: RelatoriosPage,
});

const LINKS = [
  {
    to: "/receitas",
    title: "Receitas da família",
    desc: "Todas as entradas por pessoa, tipo e período.",
  },
  {
    to: "/bancos",
    title: "Bancos da família",
    desc: "Saldos por titular, agrupados por pessoa.",
  },
  {
    to: "/contas-fixas",
    title: "Contas fixas",
    desc: "Compromissos recorrentes que se repetem todo mês.",
  },
  {
    to: "/perfil-financeiro",
    title: "Perfil financeiro da família",
    desc: "Objetivo principal, dependentes e renda base.",
  },
] as const;

function RelatoriosPage() {
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: incomes } = useIncomes(family?.id);
  const { data: fixed } = useFixedExpenses(family?.id);
  const { data: cards } = useCreditCards(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const month = currentMonth();
  const gastoFamilia = useMonthlySpending(family?.id, "", month);

  if (!family) return <NoFamily />;

  const receitas = (incomes ?? [])
    .filter((i) => i.ativo)
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);
  const contas = (fixed ?? [])
    .filter((f) => f.ativo)
    .reduce((acc, f) => acc + monthlyExpenseValue(f), 0);
  const saldos = (accounts ?? [])
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const gastos = gastoFamilia.total;

  const stats = [
    { label: "Receita mensal da família", value: formatCurrency(receitas) },
    { label: "Contas fixas do mês", value: formatCurrency(contas) },
    { label: `Gastos · ${monthLabel(month)}`, value: formatCurrency(gastos) },
    { label: "Saldo em contas bancárias", value: formatCurrency(saldos) },
    { label: "Pessoas na família", value: String((members ?? []).length) },
    { label: "Cartões ativos", value: String((cards ?? []).filter((c) => c.ativo).length) },
  ];

  return (
    <div>
      <PageHeader
        title="Relatórios"
        subtitle="O panorama consolidado da família, somando a vida financeira de cada pessoa."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-extrabold">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <h2 className="text-base font-bold">Visões consolidadas</h2>
        <ul className="mt-3 divide-y divide-border">
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className="flex items-center justify-between gap-4 py-3.5 transition-colors hover:text-primary"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{l.title}</span>
                  <span className="block text-xs text-muted-foreground">{l.desc}</span>
                </span>
                <ArrowRight className="size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <h2 className="text-base font-bold">Por pessoa</h2>
        <ul className="mt-3 divide-y divide-border">
          {(members ?? []).map((m) => (
            <MembroLinha
              key={m.id}
              familyId={family.id}
              memberId={m.id}
              nome={m.nome}
              month={month}
              receitas={(incomes ?? [])
                .filter((i) => i.member_id === m.id && i.ativo)
                .reduce((acc, i) => acc + monthlyIncomeValue(i), 0)}
            />
          ))}
          {(members ?? []).length === 0 && (
            <li className="py-3 text-sm text-muted-foreground">
              Cadastre as pessoas da família em Minha Família para ver os relatórios individuais.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}

/** Resumo individual: gastos vêm do mesmo motor de competência baseado em compras. */
function MembroLinha({
  familyId,
  memberId,
  nome,
  month,
  receitas,
}: {
  familyId: string;
  memberId: string;
  nome: string;
  month: string;
  receitas: number;
}) {
  const gasto = useMonthlySpending(familyId, memberId, month);
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Link
          to="/membro/$memberId"
          params={{ memberId }}
          className="truncate text-sm font-semibold text-primary hover:underline"
        >
          {nome}
        </Link>
        <p className="text-xs text-muted-foreground">
          Receitas {formatCurrency(receitas)} · Gastos {formatCurrency(gasto.total)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold">
        {formatCurrency(receitas - gasto.total)}
      </span>
    </li>
  );
}
