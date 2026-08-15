import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Users,
  Wallet,
  Brain,
  TrendingUp,
  Receipt,
  CreditCard,
  Gauge,
  ShoppingCart,
  PieChart,
  ArrowUpDown,
  Target,
} from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { useFamily, useFinancialProfile, useMembers, useProfile } from "@/hooks/useFamilyData";
import { useFinancialSummary } from "@/hooks/useFinanceData";
import { useExpenseSummary } from "@/hooks/useExpenses";
import { useBudgetProgress } from "@/hooks/useBudgets";
import { BUDGET_STATUS_CLASSES, BUDGET_STATUS_LABELS } from "@/lib/budgets";
import { monthLabel } from "@/lib/expenses";
import { GOAL_LABELS } from "@/lib/family";
import { formatCurrency } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Família Finance AI" },
      { name: "description", content: "Visão geral da estrutura financeira da sua família." },
      { property: "og:title", content: "Dashboard — Família Finance AI" },
      { property: "og:description", content: "Visão geral da sua família no Família Finance AI." },
    ],
  }),
  component: Dashboard,
});

const FUTURE_MODULES = [
  "Metas financeiras",
  "Análises e recomendações de IA",
];

function Dashboard() {
  const { data: profile } = useProfile();
  const { data: family, isLoading } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: financial } = useFinancialProfile(family?.id);
  const summary = useFinancialSummary(family?.id);
  const gastos = useExpenseSummary(family?.id);

  const primeiroNome = profile?.nome_completo?.split(" ")[0];
  const comprometimento = summary.comprometimento;

  return (
    <div>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        subtitle="Visão geral do núcleo financeiro da sua família."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<TrendingUp className="size-5" />}
          label="Receita mensal"
          value={formatCurrency(summary.receitaMensal)}
          hint={`${summary.counts.incomes} receita(s) cadastrada(s)`}
          to="/receitas"
          loading={summary.isLoading}
        />
        <StatCard
          icon={<Receipt className="size-5" />}
          label="Contas fixas"
          value={formatCurrency(summary.contasFixas)}
          hint={`${summary.counts.expenses} conta(s) cadastrada(s)`}
          to="/contas-fixas"
          loading={summary.isLoading}
        />
        <StatCard
          icon={<CreditCard className="size-5" />}
          label="Limite dos cartões"
          value={formatCurrency(summary.limiteCartoes)}
          hint={`${summary.counts.cards} cartão(ões) cadastrado(s)`}
          to="/cartoes"
          loading={summary.isLoading}
        />
        <StatCard
          icon={<Gauge className="size-5" />}
          label="Comprometimento financeiro"
          value={comprometimento === null ? "—" : `${comprometimento.toFixed(0)}%`}
          hint={
            comprometimento === null
              ? "Cadastre receitas para calcular"
              : `Sobra estimada: ${formatCurrency(summary.saldo)}`
          }
          loading={summary.isLoading}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<ShoppingCart className="size-5" />}
          label="Total gasto no mês"
          value={formatCurrency(gastos.totalMes)}
          hint={`${gastos.count} lançamento(s) em ${monthLabel(gastos.month)}`}
          to="/despesas"
          loading={gastos.isLoading}
        />
        <StatCard
          icon={<PieChart className="size-5" />}
          label="Maior categoria de gasto"
          value={gastos.maiorCategoria ? gastos.maiorCategoria.nome : "—"}
          hint={
            gastos.maiorCategoria
              ? formatCurrency(gastos.maiorCategoria.valor)
              : "Registre despesas para ver"
          }
          loading={gastos.isLoading}
        />
        <StatCard
          icon={<ArrowUpDown className="size-5" />}
          label="Comparação com mês anterior"
          value={
            gastos.variacao === null
              ? "—"
              : `${gastos.variacao > 0 ? "+" : ""}${gastos.variacao.toFixed(0)}%`
          }
          hint={
            gastos.totalAnterior > 0
              ? `Mês anterior: ${formatCurrency(gastos.totalAnterior)}`
              : "Sem gastos no mês anterior"
          }
          loading={gastos.isLoading}
        />
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Target className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">Controle do orçamento</h2>
              <p className="text-xs text-muted-foreground">
                Planejado x gasto por categoria em {monthLabel(orcamento.month)}
              </p>
            </div>
          </div>
          <Link
            to="/orcamento"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            Gerenciar orçamento
            <ArrowRight className="size-4" />
          </Link>
        </div>

        {orcamento.isLoading ? (
          <p className="mt-5 text-sm text-muted-foreground">Carregando...</p>
        ) : orcamento.items.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Nenhum limite definido ainda. Crie orçamentos por categoria para acompanhar o
            planejado.
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {orcamento.items.map((item) => {
              const cls = BUDGET_STATUS_CLASSES[item.status];
              return (
                <li key={item.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{item.categoria}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(item.gasto)} de {formatCurrency(item.planejado)}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls.badge}`}>
                      {item.percentual.toFixed(0)}% · {BUDGET_STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
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



      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Users className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-bold">Minha Família</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "Carregando..."
              : family
                ? `${family.nome_da_familia} · ${members?.length ?? 0} membro(s)`
                : "Nenhuma família criada ainda."}
          </p>
          <Link
            to="/minha-familia"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            {family ? "Gerenciar membros" : "Criar minha família"}
            <ArrowRight className="size-4" />
          </Link>
        </Card>

        <Card>
          <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Wallet className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-bold">Perfil Financeiro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {financial?.objetivo_principal
              ? `Objetivo: ${GOAL_LABELS[financial.objetivo_principal]}`
              : "Ainda não preenchido."}
          </p>
          <Link
            to="/perfil-financeiro"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            {financial ? "Atualizar informações" : "Preencher perfil"}
            <ArrowRight className="size-4" />
          </Link>
        </Card>
      </div>

      <Card className="mt-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Brain className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-bold">Próximos módulos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A arquitetura já está preparada para receber estes módulos nas próximas fases.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {FUTURE_MODULES.map((m) => (
            <li
              key={m}
              className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {m}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  to,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  to?: "/receitas" | "/contas-fixas" | "/cartoes" | "/despesas";
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        {icon}
      </span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{loading ? "—" : value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {to && (
        <Link to={to} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Abrir
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}
