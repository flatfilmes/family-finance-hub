import { AlertTriangle, CreditCard } from "lucide-react";
import { useStatementImports } from "@/hooks/useCardStatements";
import { isStatementConfirmed } from "@/lib/card-statements";
import { EmptyState } from "@/components/empty-state";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader } from "@/components/page-header";
import { Badge, Metric } from "@/components/detail-page";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useCardCommitments } from "@/hooks/useFinancialReadModel";
import { filterByMember } from "@/components/member-filter";
import { COVERAGE_MESSAGES } from "@/lib/read-models";
import { useViewMode } from "@/components/view-mode";
import { formatDate } from "@/lib/expenses";
import { cardSubtitle } from "@/lib/institutions";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/cartoes/")({
  head: () => ({
    meta: [
      { title: "Cartões da Família — Família Finance AI" },
      {
        name: "description",
        content:
          "Painel de crédito da família: faturas abertas, limites, capacidade de pagamento e próximas faturas.",
      },
      { property: "og:title", content: "Cartões da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Faturas, limite utilizado, histórico e pagamento das faturas dos cartões.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CartoesPage,
});

function CartoesPage() {
  const { data: family } = useFamily();
  const dados = useCardsData(family?.id);
  const view = useViewMode();
  const importacoes = useStatementImports(family?.id);

  if (!family) return <NoFamily />;

  // Visão geral: sem busca, sem filtros e sem importação global.
  const visiveis = filterByMember(dados.cards, view.scoped(""));

  // Alerta compacto: só aparece quando existe importação sem revisão confirmada.
  const pendentes = (importacoes.data ?? []).filter((i) => !isStatementConfirmed(i));
  const pendentePrimeiro = pendentes[0];
  const cartaoPendente = pendentePrimeiro
    ? dados.cards.find((c) => c.id === pendentePrimeiro.credit_card_id)
    : undefined;

  // Faturas, limites e capacidade de pagamento vêm do read model canônico.
  const { commitments } = useCardCommitments(family?.id, view.scoped(""));
  const {
    obrigacoes,
    totalFaturasAbertas,
    totalLimite,
    saldoContas,
    capacidade,
    status,
  } = commitments;
  const statusTexto = COVERAGE_MESSAGES[status];
  const statusTone = ({ VERDE: "ok", AMARELO: "warn", VERMELHO: "danger" } as const)[status];

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Visão geral do crédito. Clique em um cartão para abrir fatura, lançamentos, importações e projeções."
      />

      {pendentePrimeiro && cartaoPendente && (
        <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {pendentes.length === 1
                ? "1 importação precisa de revisão"
                : `${pendentes.length} importações precisam de revisão`}
            </span>
          </p>
          <Link
            to="/cartoes/$cardId"
            params={{ cardId: cartaoPendente.id }}
            className="shrink-0 rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
          >
            Revisar
          </Link>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total das faturas abertas" value={formatCurrency(totalFaturasAbertas)} big />
        <Metric label="Saldo disponível em contas" value={formatCurrency(saldoContas)} big />
        <Metric
          label="Capacidade de pagamento"
          value={formatCurrency(capacidade)}
          tone={capacidade < 0 ? "danger" : "ok"}
          big
        />
        <Metric label="Limite total ativo" value={formatCurrency(totalLimite)} big />
      </div>

      <Card className="mt-4">
        <Badge tone={statusTone}>{status}</Badge>
        <p className="mt-2 text-sm text-muted-foreground">{statusTexto}</p>
      </Card>

      {obrigacoes.length > 0 && (
        <Card className="mt-4">
          <p className="text-sm font-bold">Composição das faturas abertas</p>
          <ul className="mt-2 divide-y divide-border">
            {obrigacoes.map((o) => (
              <li key={o.cardId} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="min-w-0 truncate">
                  {o.nome}
                  <span className="ml-2 text-muted-foreground">
                    {o.aberta ? (o.oficial ? "OFICIAL" : "ESTIMADA") : "PAGA"}
                  </span>
                </span>
                <strong>{formatCurrency(o.valor)}</strong>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 py-2 text-sm">
              <strong>Total</strong>
              <strong>{formatCurrency(totalFaturasAbertas)}</strong>
            </li>
          </ul>
        </Card>
      )}

      <h2 className="mt-8 text-base font-bold">Cartões</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {dados.isLoading ? (
          <Card>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </Card>
        ) : visiveis.length ? (
          visiveis.map((c) => {
            const info = dados.info(c.id);
            const fatura = info?.faturaAtual ?? null;
            const ciclo = dados.faturaDe(c.id, fatura);

            return (
              <Link
                key={c.id}
                to="/cartoes/$cardId"
                params={{ cardId: c.id }}
                className="block rounded-3xl border border-border bg-card p-5 shadow-card transition-colors hover:bg-muted/40"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold">
                      {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">{cardSubtitle(c)}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-primary">Abrir →</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {ciclo.label}
                    </p>
                    <p className="mt-0.5 truncate text-xl font-extrabold">
                      {formatCurrency(ciclo.valor)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Vencimento
                    </p>
                    <p className="mt-0.5 truncate text-xl font-extrabold">
                      {info?.proximoVencimento
                        ? formatDate(info.proximoVencimento)
                        : `dia ${c.dia_vencimento}`}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  {fatura ? `Fatura ${fatura.status.toLowerCase()}` : "Sem fatura aberta no momento"}
                </p>
              </Link>
            );
          })
        ) : (
          <Card>
            <EmptyState
              icon={<CreditCard className="size-5" />}
              title="Nenhum cartão cadastrado"
              description="Os cartões são cadastrados no perfil de cada pessoa, na aba “Cartões”."
              action={
                <Link
                  to="/configuracoes"
                  className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  Ir para Família e Finanças
                </Link>
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}
