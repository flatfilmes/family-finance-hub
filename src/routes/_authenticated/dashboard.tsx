import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MemberFilter } from "@/components/member-filter";
import {
  ArrowRight,
  Wallet,
  Brain,
  TrendingUp,
  Receipt,
  CreditCard,
  ShoppingCart,
  PieChart,
  ArrowUpDown,
  Target,
  HeartPulse,
  CalendarCheck,
} from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { useFamily, useMembers, useProfile } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useSpendingSummary } from "@/hooks/useSpendingSummary";
import { useBudgetProgress } from "@/hooks/useBudgets";
import { useFinancialEngine } from "@/hooks/useFinancialEngine";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardOverview } from "@/hooks/useCardInvoices";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { filterByMember } from "@/components/member-filter";
import { MEMBER_PROFILE_LABELS } from "@/lib/member-profiles";
import { HEALTH_CLASSES, HEALTH_LABELS, HEALTH_MESSAGES } from "@/lib/financial-engine";
import { BUDGET_STATUS_CLASSES, BUDGET_STATUS_LABELS } from "@/lib/budgets";
import { monthLabel, formatDate, currentMonth, previousMonth } from "@/lib/expenses";
import { useTransactions } from "@/hooks/useTransactions";
import { useFutureCommitments } from "@/hooks/useFutureCommitments";
import { useMonthlySpending } from "@/hooks/useMonthlySpending";
import { AttentionCenter } from "@/components/attention-center";
import { useFreeCash } from "@/hooks/useFreeCash";
import { FREE_CASH_CLASSES, FREE_CASH_MESSAGES } from "@/lib/free-cash";
import { useMonthlySnapshots } from "@/hooks/useMonthlySnapshots";
import { competenciaFromMonth, competenciaLabel, podeFechar } from "@/lib/monthly-snapshots";


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";


import {
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  type Transaction,
} from "@/lib/transactions";
import { isDemoFamily } from "@/lib/family";
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

const FUTURE_MODULES = ["Metas financeiras", "Análises e recomendações de IA"];

function Dashboard() {
  const { data: profile } = useProfile();
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const [filtroMembro, setFiltroMembro] = useState("");
  const view = useViewMode();
  const escopo = view.scoped(filtroMembro);
  const gastos = useSpendingSummary(family?.id, escopo);
  const gastoMes = useMonthlySpending(family?.id, escopo);

  const orcamento = useBudgetProgress(family?.id, undefined, escopo);
  const engine = useFinancialEngine(family?.id, escopo);
  const caixa = useFreeCash(family?.id, escopo);
  const compromissos = useFutureCommitments(family?.id, escopo);


  const primeiroNome = profile?.nome_completo?.split(" ")[0];
  const nomeEscopo = (members ?? []).find((m) => m.id === escopo)?.nome;

  return (
    <div>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        subtitle="Visão geral do núcleo financeiro da sua família."
      />

      {isDemoFamily(family) && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400">
          Modo Demonstração ativo: os dados desta família são fictícios e servem apenas para testes.
        </div>
      )}

      <FechamentoMensal familyId={family?.id} isAdmin={view.isAdmin} />

      <AttentionCenter familyId={family?.id} memberId={escopo} podeAgir={!view.isViewer} />





      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              {escopo
                ? `Situação financeira de ${nomeEscopo ?? "quem está logado"}`
                : "Situação financeira da família"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Seu perfil: {MEMBER_PROFILE_LABELS[view.tipo]}
              {view.canSwitchView
                ? " · você pode alternar entre a visão da família e a sua."
                : " · você vê apenas os seus dados."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <ViewModeSwitch
              mode={view.mode}
              onChange={(m) => {
                view.setMode(m);
                if (m === "minha") setFiltroMembro("");
              }}
              canSwitch={view.canSwitchView}
            />
            {view.canSwitchView && view.mode === "familia" && (
              <div className="w-48">
                <MemberFilter
                  familyId={family?.id}
                  value={filtroMembro}
                  onChange={setFiltroMembro}
                />
              </div>
            )}
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
              <Link to="/compras" className="inline-flex items-center gap-1.5">
                Registrar compras <ArrowRight className="size-4" />
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
              <ComprometidoCard caixa={caixa} />
              <GastosDoMesCard gasto={gastoMes} />
              <DinheiroLivreCard caixa={caixa} />
            </div>

            <ResumoCaixa caixa={caixa} />


            <CapacidadeCartoes familyId={family?.id} memberId={escopo} />

            <UltimasMovimentacoes familyId={family?.id} memberId={escopo} />

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

      {/* O total gasto já aparece em "Gastos realizados no mês" — aqui só o detalhe. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<ShoppingCart className="size-5" />}
          label="Compras do mês"
          value={String(gastos.count)}
          hint={`Compras registradas em ${monthLabel(gastos.month)}`}
          to="/compras"
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
          <div>
            <h2 className="text-base font-bold">Compromissos futuros</h2>
            <p className="text-xs text-muted-foreground">
              Fatura de cartão, parcelamentos e cobranças recorrentes já assumidos.
            </p>
          </div>
          <Link
            to="/cartoes"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            Ver cartões
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Bloco label="Este mês" value={formatCurrency(compromissos.esteMes)} />
          <Bloco label="Próximo mês" value={formatCurrency(compromissos.proximoMes)} />
          <Bloco label="Próximos 3 meses" value={formatCurrency(compromissos.proximos3)} />
        </div>

        <ul className="mt-4 divide-y divide-border">
          {compromissos.porMes.map((m) => (
            <li key={m.mes} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold">{monthLabel(m.mes)}</p>
                <p className="text-xs text-muted-foreground">
                  Cartão {formatCurrency(m.cartao)} · Parcelamentos {formatCurrency(m.parcelas)} ·
                  Recorrências {formatCurrency(m.recorrencias)}
                </p>
              </div>
              <span className="text-sm font-bold">{formatCurrency(m.total)}</span>
            </li>
          ))}
        </ul>
        {compromissos.porMes.every((m) => m.total === 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhum compromisso futuro registrado. Compras no cartão e recorrências aparecem aqui.
          </p>
        )}
      </Card>

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
                <p className="mt-1 text-lg font-bold">{formatCurrency(orcamento.totalPlanejado)}</p>
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
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls.badge}`}
                      >
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

/**
 * Capacidade de pagamento dos cartões:
 * soma das faturas abertas x saldo disponível nas contas bancárias.
 */
/** Últimas movimentações reais (compras, pagamentos de fatura, entradas e saídas). */
function UltimasMovimentacoes({
  familyId,
  memberId,
}: {
  familyId?: string | undefined;
  memberId: string;
}) {
  const { data, isLoading } = useTransactions(familyId);
  const rows: Transaction[] = data ?? [];
  const lista = filterByMember(rows, memberId).slice(0, 8);

  return (
    <Card className="mt-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <ArrowUpDown className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-bold">Últimas movimentações</h3>
          <p className="text-xs text-muted-foreground">
            Saídas, entradas e pagamentos de fatura registrados
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
      ) : lista.length ? (
        <ul className="mt-2 divide-y divide-border">
          {lista.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(t.data_movimento)} · {TRANSACTION_TYPE_LABELS[t.tipo]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TRANSACTION_STATUS_CLASSES[t.status]}`}
                >
                  {TRANSACTION_STATUS_LABELS[t.status]}
                </span>
                <span className="text-sm font-bold">
                  {t.tipo === "ENTRADA" ? "+" : "-"} {formatCurrency(Number(t.valor))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhuma movimentação ainda. Registre uma compra para começar o fluxo financeiro.
        </p>
      )}
    </Card>
  );
}

function CapacidadeCartoes({
  familyId,
  memberId,
}: {
  familyId?: string | undefined;
  memberId: string;
}) {
  const { data: cards } = useCreditCards(familyId);
  const { data: accounts } = useBankAccounts(familyId);
  const cartoes = filterByMember(cards ?? [], memberId);
  const overview = useCardOverview(familyId, cartoes);

  const faturas = overview.porCartao
    .filter((o) => o.faturaAtual?.status !== "PAGA")
    .reduce((acc, o) => acc + o.valorFaturaAtual, 0);
  const contas = filterByMember(accounts ?? [], memberId).filter((a) => a.ativo);
  const saldo = contas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);

  const cobertura = faturas > 0 ? (saldo / faturas) * 100 : 100;
  const status: "verde" | "amarelo" | "vermelho" =
    cobertura >= 120 ? "verde" : cobertura >= 100 ? "amarelo" : "vermelho";

  const tone = {
    verde: {
      badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      dot: "bg-emerald-500",
      bar: "bg-emerald-500",
      label: "Saldo cobre os cartões",
    },
    amarelo: {
      badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      dot: "bg-amber-500",
      bar: "bg-amber-500",
      label: "Saldo próximo do limite",
    },
    vermelho: {
      badge: "bg-red-500/15 text-red-700 dark:text-red-400",
      dot: "bg-red-500",
      bar: "bg-red-500",
      label: "Saldo insuficiente",
    },
  }[status];

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StatCard
          icon={<Wallet className="size-5" />}
          label="Minha liquidez"
          value={formatCurrency(saldo)}
          hint={`${contas.length} conta(s) bancária(s) ativa(s)`}
          to="/bancos"
        />
        <StatCard
          icon={<CreditCard className="size-5" />}
          label="Compromissos de cartão"
          value={formatCurrency(faturas)}
          hint="Total das faturas em aberto"
          to="/cartoes"
        />
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <CreditCard className="size-5" />
            </span>
            <div>
              <h3 className="text-base font-bold">Capacidade de pagamento</h3>
              <p className="text-xs text-muted-foreground">
                Faturas abertas comparadas ao saldo das contas bancárias
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${tone.badge}`}
          >
            <span className={`size-2 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Faturas abertas</p>
            <p className="mt-1 text-xl font-extrabold">{formatCurrency(faturas)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Saldo bancário</p>
            <p className="mt-1 text-xl font-extrabold">{formatCurrency(saldo)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Diferença</p>
            <p className="mt-1 text-xl font-extrabold">{formatCurrency(saldo - faturas)}</p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${tone.bar}`}
            style={{ width: `${Math.max(0, Math.min(100, cobertura))}%` }}
          />
        </div>

        {overview.porCartao.length > 0 && (
          <ul className="mt-4 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {overview.porCartao.map((o) => (
              <li key={o.card.id}>
                {o.card.banco} · {o.card.nome_cartao}:{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(o.valorFaturaAtual)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * Gasto real da competência: compras parceladas entram pela parcela do mês,
 * pagamento de fatura não é recontado e cada recorrência aparece uma única vez.
 */
type Caixa = ReturnType<typeof useFreeCash>;

/**
 * Comprometido = obrigações ainda pendentes da competência.
 * Não é "tudo que foi comprado": Pix/débito já saíram do saldo, fatura paga
 * não é mais compromisso e parcelamento entra pela parcela do período.
 */
function ComprometidoCard({ caixa }: { caixa: Caixa }) {
  const c = caixa.comprometido;
  const linhas = [
    { label: "Contas recorrentes", valor: c.contasRecorrentes },
    { label: "Faturas de cartão", valor: c.faturasCartao },
    { label: "Parcelas do período", valor: c.parcelas },
    { label: "Recorrências", valor: c.recorrencias },
    { label: "Outros compromissos", valor: c.outros },
  ];
  return (
    <Card className="p-5">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Receipt className="size-5" />
      </span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Comprometido
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">
        {caixa.isLoading ? "—" : formatCurrency(c.total)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Obrigações em aberto até o fim de {monthLabel(caixa.month)}
      </p>
      <Dialog>
        <DialogTrigger className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Ver composição
          <ArrowRight className="size-3.5" />
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Composição do comprometido</DialogTitle>
            <DialogDescription>
              Somente obrigações pendentes. Compras no Pix, débito ou dinheiro já reduziram o saldo
              e faturas pagas saem daqui.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {linhas.map((l) => (
              <li key={l.label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{l.label}</span>
                <strong>{formatCurrency(l.valor)}</strong>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 border-t border-border pt-2">
              <span className="font-semibold">Total comprometido</span>
              <strong>{formatCurrency(c.total)}</strong>
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Dinheiro livre hoje = saldo bancário - obrigações até o próximo recebimento - reserva. */
function DinheiroLivreCard({ caixa }: { caixa: Caixa }) {
  const tone = FREE_CASH_CLASSES[caixa.status];
  const j = caixa.ateProximoRecebimento;
  return (
    <Card className="p-5">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Wallet className="size-5" />
      </span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Dinheiro livre hoje
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">
        {caixa.isLoading ? "—" : formatCurrency(caixa.livreHoje)}
      </p>
      <span
        className={`mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}
      >
        <span className={`size-2 rounded-full ${tone.dot}`} />
        {FREE_CASH_MESSAGES[caixa.status]}
      </span>
      <Dialog>
        <DialogTrigger className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Como calculamos?
          <ArrowRight className="size-3.5" />
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Como calculamos o dinheiro livre</DialogTitle>
            <DialogDescription>
              Partimos do saldo real das contas bancárias e retiramos as obrigações conhecidas até{" "}
              {caixa.proximoRecebimento
                ? `o próximo recebimento (${formatDate(caixa.proximoRecebimento)})`
                : "o fim do mês"}
              , além da sua reserva.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Saldo das contas</span>
              <strong>{formatCurrency(caixa.saldoBancario)}</strong>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Faturas pendentes</span>
              <strong>- {formatCurrency(j.faturasCartao + j.parcelas)}</strong>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Contas até o próximo recebimento</span>
              <strong>- {formatCurrency(j.contasRecorrentes + j.outros)}</strong>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Recorrências</span>
              <strong>- {formatCurrency(j.recorrencias)}</strong>
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                Reserva ({caixa.percentualReserva.toFixed(0)}% da renda fixa)
              </span>
              <strong>- {formatCurrency(caixa.reserva)}</strong>
            </li>
            <li className="flex items-center justify-between gap-4 border-t border-border pt-2">
              <span className="font-semibold">= Dinheiro livre hoje</span>
              <strong>{formatCurrency(caixa.livreHoje)}</strong>
            </li>
          </ul>
          <p className="mt-2 rounded-2xl bg-muted/50 p-3 text-xs text-muted-foreground">
            Renda variável esperada de {formatCurrency(caixa.rendaVariavelEsperada)} não entra neste
            cálculo: só consideramos dinheiro já disponível na conta.
          </p>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Deixa explícito que saldo bancário não é dinheiro livre. */
function ResumoCaixa({ caixa }: { caixa: Caixa }) {
  const tone = FREE_CASH_CLASSES[caixa.status];
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">Do saldo ao dinheiro livre</h3>
          <p className="text-xs text-muted-foreground">
            Saldo bancário não é dinheiro livre: parte dele já tem destino.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${tone.badge}`}
        >
          <span className={`size-2 rounded-full ${tone.dot}`} />
          {caixa.contas} conta(s) considerada(s)
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Bloco label="Saldo bancário" value={formatCurrency(caixa.saldoBancario)} />
        <Bloco
          label="Dinheiro comprometido"
          value={formatCurrency(caixa.ateProximoRecebimento.total)}
        />
        <Bloco label="Reserva" value={formatCurrency(caixa.reserva)} />
        <Bloco label="Dinheiro livre hoje" value={formatCurrency(caixa.livreHoje)} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Renda variável esperada: {formatCurrency(caixa.rendaVariavelEsperada)} — não é saldo
        garantido.
      </p>
    </Card>
  );
}

function GastosDoMesCard({ gasto }: { gasto: ReturnType<typeof useMonthlySpending> }) {

  const linhas = [
    { label: "Pix / Débito / Dinheiro", valor: gasto.caixa },
    { label: "Cartão à vista", valor: gasto.cartaoAVista },
    { label: "Parcelas do mês", valor: gasto.parcelasDoMes },
    { label: "Recorrências", valor: gasto.recorrencias },
    { label: "Contas recorrentes", valor: gasto.contasRecorrentes },
  ];
  return (
    <Card className="p-5">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <ShoppingCart className="size-5" />
      </span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Gastos realizados no mês
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">
        {gasto.isLoading ? "—" : formatCurrency(gasto.total)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Competência de {monthLabel(gasto.month)}
      </p>
      <Dialog>
        <DialogTrigger className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Ver composição
          <ArrowRight className="size-3.5" />
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Composição de {monthLabel(gasto.month)}</DialogTitle>
            <DialogDescription>
              Somente o impacto real da competência. Parcelamentos entram pela parcela do mês.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {linhas.map((l) => (
              <li key={l.label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{l.label}</span>
                <strong>{formatCurrency(l.valor)}</strong>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 border-t border-border pt-2">
              <span className="font-semibold">Total</span>
              <strong>{formatCurrency(gasto.total)}</strong>
            </li>
          </ul>
          <div className="mt-2 space-y-2 rounded-2xl bg-muted/50 p-3 text-xs">
            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
              Fora do gasto do mês
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Parcelamentos futuros</span>
              <strong>{formatCurrency(gasto.parcelasFuturas)}</strong>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Valor contratado em parcelamentos</span>
              <strong>{formatCurrency(gasto.valorContratadoParcelamentos)}</strong>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
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
  to?: "/receitas" | "/contas-fixas" | "/cartoes" | "/compras" | "/bancos";
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
        <Link
          to={to}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
        >
          Abrir
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}

function Bloco({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-extrabold">{value}</p>
    </div>
  );
}

/**
 * Ação de fechamento da competência + aviso de mês já fechado.
 * O snapshot nunca é recalculado automaticamente: alterações em registros
 * antigos não modificam o retrato histórico já preservado.
 */
function FechamentoMensal({ familyId, isAdmin }: { familyId?: string | undefined; isAdmin: boolean }) {
  const snapshots = useMonthlySnapshots(familyId);
  const atual = competenciaFromMonth(currentMonth());
  const anterior = competenciaFromMonth(previousMonth(currentMonth()));
  const sugerida = podeFechar(atual) ? atual : anterior;

  const lista = snapshots.data ?? [];
  const fechadoAtual = lista.find(
    (s) => s.ano === atual.ano && s.mes === atual.mes && s.member_id === null && s.fechado,
  );
  const jaFechado = lista.some(
    (s) => s.ano === sugerida.ano && s.mes === sugerida.mes && s.member_id === null && s.fechado,
  );

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
      <div>
        <p className="text-sm font-bold">Fechamento mensal</p>
        <p className="text-xs text-muted-foreground">
          {fechadoAtual
            ? "Este mês já foi fechado. Alterações em registros antigos não modificam o histórico consolidado."
            : jaFechado
              ? `${competenciaLabel(sugerida)} já está fechado no histórico.`
              : `Você pode preservar o retrato financeiro de ${competenciaLabel(sugerida)}.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/historico"
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          Ver histórico
        </Link>
        {isAdmin && !jaFechado && (
          <Link
            to="/historico/fechar/$ano/$mes"
            params={{ ano: String(sugerida.ano), mes: String(sugerida.mes) }}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <CalendarCheck className="size-4" /> Fechar {competenciaLabel(sugerida)}
          </Link>
        )}
      </div>
    </div>
  );
}
