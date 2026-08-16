import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { Badge, Metric } from "@/components/detail-page";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { useStickyState } from "@/hooks/useStickyState";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "./receitas";

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
  const { data: accounts } = useBankAccounts(family?.id);
  const memberName = useMemberName(family?.id);
  const view = useViewMode();

  const [filtroMembro, setFiltroMembro] = useStickyState("cartoes:membro", "");
  const [filtroBanco, setFiltroBanco] = useStickyState("cartoes:banco", "");
  const [mes, setMes] = useStickyState("cartoes:mes", "");

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set(dados.cards.map((c) => c.banco))).sort();

  const lista = filterByMember(dados.cards, view.scoped(filtroMembro)).filter((c) =>
    filtroBanco ? c.banco === filtroBanco : true,
  );

  const visiveis = lista.filter((c) => {
    if (!mes) return true;
    const venc = dados.info(c.id)?.proximoVencimento;
    return !!venc && venc.startsWith(mes);
  });

  const contasAtivas = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter(
    (a) => a.ativo,
  );

  const totalLimite = visiveis
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const totalFaturasAbertas = visiveis.reduce((acc, c) => {
    const fatura = dados.info(c.id)?.faturaAtual;
    return acc + (fatura && fatura.status !== "PAGA" ? Number(fatura.valor_total) || 0 : 0);
  }, 0);
  const totalUtilizado = visiveis.reduce((acc, c) => acc + dados.utilizadoDe(c.id), 0);
  const saldoContas = contasAtivas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const capacidade = saldoContas - totalFaturasAbertas;
  const statusPagamento =
    capacidade < 0 ? "vermelho" : capacidade < totalFaturasAbertas * 0.2 ? "amarelo" : "verde";
  const statusTexto = {
    verde: "Saldo em contas cobre as faturas abertas com folga.",
    amarelo: "Saldo cobre as faturas, mas com margem pequena.",
    vermelho: "Saldo disponível não cobre todas as faturas abertas.",
  }[statusPagamento];
  const statusTone = ({ verde: "ok", amarelo: "warn", vermelho: "danger" } as const)[
    statusPagamento
  ];

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Visão geral do crédito. Clique em um cartão para abrir a página completa com fatura, lançamentos e projeções."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <Badge tone={statusTone}>{statusPagamento.toUpperCase()}</Badge>
        <p className="mt-2 text-sm text-muted-foreground">{statusTexto}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Limite utilizado somado: {formatCurrency(totalUtilizado)}
        </p>
      </Card>

      <Card className="mt-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {view.isAdmin ? (
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          ) : (
            <div className="flex items-end">
              <ViewModeSwitch mode={view.mode} onChange={view.setMode} canSwitch={false} />
            </div>
          )}
          <Field label="Banco">
            <select
              className={inputClass}
              value={filtroBanco}
              onChange={(e) => setFiltroBanco(e.target.value)}
              aria-label="Banco"
            >
              <option value="">Todos</option>
              {bancos.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período (vencimento)">
            <input
              type="month"
              className={inputClass}
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="mt-4 grid gap-4">
        {dados.isLoading ? (
          <Card>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </Card>
        ) : visiveis.length ? (
          visiveis.map((c) => {
            const info = dados.info(c.id);
            const limite = Number(c.limite) || 0;
            const utilizado = dados.utilizadoDe(c.id);
            const disponivel = limite - utilizado;
            const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;
            const fatura = info?.faturaAtual ?? null;

            return (
              <Link
                key={c.id}
                to="/cartoes/$cardId"
                params={{ cardId: c.id }}
                className="block rounded-3xl border border-border bg-card p-6 shadow-card transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold">
                      {c.banco} · {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Titular: {memberName(c.member_id)} ·{" "}
                      {fatura
                        ? `fatura ${fatura.status.toLowerCase()}`
                        : "sem fatura aberta no momento"}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-primary">Abrir cartão completo</span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Limite" value={formatCurrency(limite)} />
                  <Metric label="Utilizado" value={formatCurrency(utilizado)} />
                  <Metric
                    label="Disponível"
                    value={formatCurrency(disponivel)}
                    tone={disponivel < 0 ? "danger" : "ok"}
                  />
                  <Metric label="Fatura atual" value={formatCurrency(info?.valorFaturaAtual ?? 0)} />
                  <Metric
                    label="Vence"
                    value={
                      info?.proximoVencimento
                        ? formatDate(info.proximoVencimento)
                        : `dia ${c.dia_vencimento}`
                    }
                  />
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${uso >= 100 ? "bg-red-500" : uso >= 80 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${uso}%` }}
                  />
                </div>
              </Link>
            );
          })
        ) : (
          <Card>
            <p className="text-sm text-muted-foreground">
              Nenhum cartão encontrado. Abra o perfil de uma pessoa em Configurações e cadastre o
              cartão na aba “Cartões”.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
