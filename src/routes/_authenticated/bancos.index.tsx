import { useState } from "react";
import { ArrowLeftRight, Landmark, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader, inputClass } from "@/components/page-header";
import { Metric } from "@/components/detail-page";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useBankOverview } from "@/hooks/useFinancialReadModel";
import { useViewMode } from "@/components/view-mode";
import { useStickyState } from "@/hooks/useStickyState";
import { formatCurrency } from "@/lib/finance";
import { currentMonth, monthLabel } from "@/lib/expenses";
import { NoFamily } from "@/components/no-family";
import { TransferDialog } from "@/components/transfer-dialog";

export const Route = createFileRoute("/_authenticated/bancos/")({
  head: () => ({
    meta: [
      { title: "Bancos da Família — Família Finance AI" },
      {
        name: "description",
        content:
          "Visão consolidada das contas bancárias: saldos, entradas, saídas e pagamentos de cartão por pessoa.",
      },
      { property: "og:title", content: "Bancos da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Saldo total, movimentações e histórico de cada conta bancária da família.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancosPage,
});

function BancosPage() {
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: accounts, isLoading } = useBankAccounts(family?.id);
  const view = useViewMode();

  const [periodo, setPeriodo] = useStickyState("bancos:periodo", currentMonth());
  const [transferOpen, setTransferOpen] = useState(false);
  const banco = useBankOverview(family?.id, view.scoped(""), periodo);

  if (!family) return <NoFamily />;

  // Visão geral simples: sem busca nem filtros de pessoa/banco.
  // O escopo do perfil (membro/visualizador) continua sendo respeitado.
  // Saldo e fluxo vêm do ledger canônico — nunca de compras.
  const lista = banco.contas;
  const { saldoTotal, entradas, saidas, pagamentosCartao, liquido } = banco.overview;

  const grupos = (members ?? [])
    .map((m) => ({ membro: m, contas: lista.filter((a) => a.member_id === m.id) }))
    .filter((g) => g.contas.length > 0);
  const semTitular = lista.filter((a) => !a.member_id);

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <PageHeader
          title="Bancos da família"
          subtitle="Visão geral das contas. Clique em uma conta para abrir extrato, importações e ferramentas."
        />
        <label className="mt-1 flex shrink-0 flex-col items-end">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Período</span>
          <input
            type="month"
            aria-label="Período"
            className={`${inputClass} w-auto py-2`}
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/configuracoes"
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Adicionar conta
        </Link>
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          disabled={(accounts ?? []).filter((a) => a.ativo).length < 2}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        >
          <ArrowLeftRight className="size-4" />
          Transferir entre contas
        </button>
      </div>

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        familyId={family.id}
        accounts={(accounts ?? []).filter((a) => a.ativo)}
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Saldo total em contas" value={formatCurrency(saldoTotal)} big />
        <Metric label="Entradas do período" value={formatCurrency(entradas)} />
        <Metric label="Saídas do período" value={formatCurrency(saidas)} />
        <Metric label="Pagamentos de cartão" value={formatCurrency(pagamentosCartao)} />
        <Metric
          label="Saldo líquido do período"
          value={formatCurrency(liquido)}
          tone={liquido < 0 ? "danger" : "ok"}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Movimentações de {periodo ? monthLabel(periodo) : "todo o histórico"}, a partir das
        movimentações confirmadas.
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Carregando...</p>
      ) : lista.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={<Landmark className="size-5" />}
            title="Nenhuma conta bancária ainda"
            description="As contas são cadastradas no perfil de cada pessoa, na aba “Contas bancárias”."
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
      ) : (
        <div className="mt-6 grid gap-6">
          {grupos.map(({ membro, contas }) => (
            <section key={membro.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <h2 className="truncate text-base font-bold">{membro.nome}</h2>
                <Link
                  to="/membro/$memberId"
                  params={{ memberId: membro.id }}
                  className="shrink-0 text-xs font-semibold text-primary hover:underline"
                >
                  Ver perfil financeiro
                </Link>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {contas.map((a) => (
                  <ContaCard
                    key={a.id}
                    id={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                  />
                ))}
              </div>
            </section>
          ))}

          {semTitular.length > 0 && (
            <section>
              <h2 className="text-base font-bold">Contas da família (sem titular)</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {semTitular.map((a) => (
                  <ContaCard
                    key={a.id}
                    id={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ContaCard({
  id,
  banco,
  nome,
  ativo,
  saldo,
}: {
  id: string;
  banco: string;
  nome: string;
  ativo: boolean;
  saldo: number;
}) {
  return (
    <Link
      to="/bancos/$accountId"
      params={{ accountId: id }}
      className="block rounded-3xl border border-border bg-card p-5 shadow-card transition-colors hover:bg-muted/40"
    >
      <p className="truncate text-sm font-bold">
        {nome}
        {ativo ? "" : " · inativa"}
      </p>
      <p className="truncate text-xs text-muted-foreground">{banco}</p>
      <p className="mt-3 text-2xl font-extrabold">{formatCurrency(saldo)}</p>
      <span className="mt-2 inline-block text-xs font-semibold text-primary">Abrir conta →</span>
    </Link>
  );
}
