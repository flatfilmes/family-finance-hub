import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MemberFilter } from "@/components/member-filter";
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
  HeartPulse,
} from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { useFamily, useFinancialProfile, useMembers, useProfile } from "@/hooks/useFamilyData";
import { useFinancialSummary, useCreditCards } from "@/hooks/useFinanceData";
import { useExpenseSummary } from "@/hooks/useExpenses";
import { useBudgetProgress } from "@/hooks/useBudgets";
import { useFinancialEngine } from "@/hooks/useFinancialEngine";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardOverview } from "@/hooks/useCardInvoices";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { filterByMember } from "@/components/member-filter";
import { MEMBER_PROFILE_LABELS } from "@/lib/member-profiles";
import { HEALTH_CLASSES, HEALTH_LABELS, HEALTH_MESSAGES } from "@/lib/financial-engine";
import { BUDGET_STATUS_CLASSES, BUDGET_STATUS_LABELS } from "@/lib/budgets";
import { monthLabel } from "@/lib/expenses";
import { GOAL_LABELS, isDemoFamily } from "@/lib/family";
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
  const orcamento = useBudgetProgress(family?.id);
  const [filtroMembro, setFiltroMembro] = useState("");
  const engine = useFinancialEngine(family?.id, filtroMembro);

  const primeiroNome = profile?.nome_completo?.split(" ")[0];
  const comprometimento = summary.comprometimento;

  return (
    <div>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        subtitle="Visão geral do núcleo financeiro da sua família."
      />

      {isDemoFamily(family) && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400">
          Ambiente de demonstração: os dados desta família são fictícios e servem apenas para testes.
        </div>
      )}

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight">
            {filtroMembro ? "Situação Financeira da pessoa" : "Minha Situação Financeira"}
          </h2>
          <div className="w-48">
            <MemberFilter familyId={family?.id} value={filtroMembro} onChange={setFiltroMembro} />
          </div>
        </div>

        {engine.semDados && !engine.isLoading ? (
          <Card>
            <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Wallet className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-bold">Ainda não há dados suficientes</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre suas receitas, contas fixas e despesas para que o sistema calcule quanto sua
              família realmente pode gastar. Nenhum valor é estimado sem dados reais.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold text-primary">
              <Link to="/receitas" className="inline-flex items-center gap-1.5">
                Cadastrar receitas <ArrowRight className="size-4" />
              </Link>
              <Link to="/contas-fixas" className="inline-flex items-center gap-1.5">
                Cadastrar contas <ArrowRight className="size-4" />
              </Link>
              <Link to="/despesas" className="inline-flex items-center gap-1.5">
                Registrar despesas <ArrowRight className="size-4" />
              </Link>
            </div>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                    <HeartPulse className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-bold">Saúde financeira</h3>
                    <p className="text-xs text-muted-foreground">
                      Cálculo do mês de {monthLabel(engine.month)} · reserva de{" "}
                      {engine.percentualReserva.toFixed(0)}%
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${HEALTH_CLASSES[engine.status].badge}`}
                >
                  <span className={`size-2 rounded-full ${HEALTH_CLASSES[engine.status].dot}`} />
                  {HEALTH_LABELS[engine.status]}
                </span>
              </div>

              <p className="mt-4 text-sm font-semibold">{HEALTH_MESSAGES[engine.status]}</p>

              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Compromissos sobre a receita:{" "}
                    <strong className="text-foreground">
                      {engine.comprometimento === null
                        ? "—"
                        : `${engine.comprometimento.toFixed(0)}%`}
                    </strong>
                  </span>
                  <span className="text-muted-foreground">
                    Saldo bruto:{" "}
                    <strong className="text-foreground">{formatCurrency(engine.saldoBruto)}</strong>
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${HEALTH_CLASSES[engine.status].bar}`}
                    style={{ width: `${Math.min(100, engine.comprometimento ?? 0)}%` }}
                  />
                </div>
                <ul className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <li>Renda garantida: {formatCurrency(engine.rendaGarantida)}</li>
                  <li>Média das variáveis: {formatCurrency(engine.receitaVariavel)}</li>
                  <li>Reserva planejada: {formatCurrency(engine.reserva)}</li>
                </ul>
                {!engine.temReceitas && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Cadastre suas receitas para que o cálculo fique completo.
                  </p>
                )}
                {engine.cartaoEmAlerta && (
                  <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Uso dos cartões em {engine.usoCartoes?.toFixed(0)}% do limite (alerta em{" "}
                    {engine.limiteAlertaCartao.toFixed(0)}%).
                  </p>
                )}
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={<TrendingUp className="size-5" />}
                label="Receita mensal"
                value={formatCurrency(engine.rendaEstimada)}
                hint={`Garantida ${formatCurrency(engine.rendaGarantida)} · estimada ${formatCurrency(engine.rendaEstimada)}`}
                to="/receitas"
                loading={engine.isLoading}
              />
              <StatCard
                icon={<Receipt className="size-5" />}
                label="Comprometido"
                value={formatCurrency(engine.compromissos)}
                hint={`Contas ${formatCurrency(engine.contasFixas)} · fatura atual ${formatCurrency(engine.faturaCartoes)} · parcelas futuras ${formatCurrency(engine.parcelasFuturas)}`}
                to="/contas-fixas"
                loading={engine.isLoading}
              />
              <StatCard
                icon={<ShoppingCart className="size-5" />}
                label="Gastos realizados no mês"
                value={formatCurrency(engine.gastosRealizados)}
                hint={`Lançamentos de ${monthLabel(engine.month)}`}
                to="/despesas"
                loading={engine.isLoading}
              />
              <StatCard
                icon={<Wallet className="size-5" />}
                label="Dinheiro disponível real"
                value={formatCurrency(engine.disponivel)}
                hint="Receita estimada - compromissos - gastos - reserva"
                loading={engine.isLoading}
              />
            </div>

            <Card className="mt-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                  <ArrowUpDown className="size-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold">Comparação mensal</h3>
                  <p className="text-xs text-muted-foreground">
                    {monthLabel(gastos.month)} x mês anterior
                  </p>
                </div>
              </div>
              {gastos.variacao === null ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Ainda não há gastos suficientes para comparar. Registre despesas para acompanhar a
                  variação.
                </p>
              ) : (
                <p className="mt-4 text-sm">
                  <strong>
                    {gastos.variacao === 0
                      ? "Você gastou o mesmo que no mês passado."
                      : `Você gastou ${Math.abs(gastos.variacao).toFixed(0)}% ${gastos.variacao > 0 ? "a mais" : "a menos"} que o mês passado.`}
                  </strong>{" "}
                  <span className="text-muted-foreground">
                    Atual {formatCurrency(gastos.totalMes)} · anterior{" "}
                    {formatCurrency(gastos.totalAnterior)}
                  </span>
                </p>
              )}
            </Card>
          </>
        )}
      </section>


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
              <h2 className="text-base font-bold">Controle do mês</h2>
              <p className="text-xs text-muted-foreground">
                Planejado x gasto por categoria em {monthLabel(orcamento.month)}
              </p>
            </div>
          </div>
          <Link
            to="/planejamento"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            Gerenciar planejamento
            <ArrowRight className="size-4" />
          </Link>
        </div>

        {orcamento.isLoading ? (
          <p className="mt-5 text-sm text-muted-foreground">Carregando...</p>
        ) : orcamento.items.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Você ainda não criou seu planejamento mensal. Defina limites para acompanhar seus
            gastos.
          </p>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Dentro do orçamento</p>
                <p className="mt-1 text-lg font-bold">{orcamento.dentroDoLimite.length}</p>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Próximas do limite</p>
                <p className="mt-1 text-lg font-bold">{orcamento.proximosDoLimite.length}</p>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Acima do limite</p>
                <p className="mt-1 text-lg font-bold">{orcamento.acimaDoLimite.length}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Orçamento total</p>
                <p className="mt-1 text-lg font-bold">
                  {formatCurrency(orcamento.totalPlanejado)}
                </p>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Gasto total</p>
                <p className="mt-1 text-lg font-bold">{formatCurrency(orcamento.totalGasto)}</p>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  Diferença · {orcamento.percentualGeral.toFixed(0)}% utilizado
                </p>
                <p className="mt-1 text-lg font-bold">{formatCurrency(orcamento.diferenca)}</p>
              </div>
            </div>
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
          </>
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
