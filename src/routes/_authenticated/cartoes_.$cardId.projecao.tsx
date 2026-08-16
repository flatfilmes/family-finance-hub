import { createFileRoute } from "@tanstack/react-router";

import { Card } from "@/components/page-header";
import { Badge, DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { NoFamily } from "@/components/no-family";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useRecurringExpenseActions } from "@/hooks/useRecurringExpenses";
import { useViewMode } from "@/components/view-mode";
import { monthKeyLabel } from "@/lib/card-invoices";
import { RECURRENCE_LABELS, monthlyValue } from "@/lib/recurring-expenses";
import { recurringForecast } from "@/lib/card-recurrences";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/cartoes_/$cardId/projecao")({
  head: () => ({
    meta: [
      { title: "Projeção do cartão — Família Finance AI" },
      {
        name: "description",
        content:
          "Análise detalhada do futuro do cartão: compromissos por mês, parcelamentos em andamento e cobranças recorrentes.",
      },
      { property: "og:title", content: "Projeção do cartão — Família Finance AI" },
      {
        property: "og:description",
        content: "Parcelamentos, recorrências e compromissos futuros do cartão em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjecaoCartaoPage,
});

function ProjecaoCartaoPage() {
  const { cardId } = Route.useParams();
  const { data: family } = useFamily();
  const dados = useCardsData(family?.id);
  const recorrenciaActions = useRecurringExpenseActions(family?.id);
  const view = useViewMode();

  if (!family) return <NoFamily />;

  const cartao = dados.cards.find((c) => c.id === cardId) ?? null;
  if (!cartao) {
    return (
      <div>
        <DetailHeader backTo="/cartoes" backLabel="Voltar para Cartões" title="Cartão não encontrado" />
        <Card>
          <p className="text-sm text-muted-foreground">
            Este cartão não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const proximas = dados.proximasDe(cartao.id);
  const parcelamentos = dados.parcelamentosDe(cartao.id);
  const recorrencias = dados.recorrenciasDoCartao(cartao.id);
  const ativas = recorrencias.filter((r) => r.ativo);
  const restanteParcelas = parcelamentos.reduce((acc, p) => acc + p.restante, 0);
  const previstoMes = ativas.reduce((acc, r) => acc + monthlyValue(r), 0);
  const podeEditar = !view.isViewer;

  return (
    <div>
      <DetailHeader
        backTo="/cartoes/$cardId"
        backParams={{ cardId: cartao.id }}
        backLabel="Voltar para o cartão"
        title="Projeção completa"
        subtitle={`${cartao.nome_cartao} · ${cartao.banco}`}
        badges={<Badge tone="warn">Projeção — não são faturas fechadas</Badge>}
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Parcelas futuras"
            value={formatCurrency(restanteParcelas)}
            hint="Soma das parcelas ainda não quitadas"
          />
          <Metric
            label="Recorrências previstas"
            value={`${formatCurrency(previstoMes)}/mês`}
            hint={`${ativas.length} cobrança(s) ativa(s)`}
          />
          <Metric
            label="Parcelamentos em andamento"
            value={String(parcelamentos.length)}
            hint="Séries com parcelas em aberto"
          />
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle
          title="Compromissos futuros por ciclo"
          hint="Projeção de parcelas e recorrências atribuídas pela regra de fechamento do cartão."
        />
        {proximas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum compromisso futuro registrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {proximas.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{monthKeyLabel(m.key)}</span>
                  <span className="block text-xs text-muted-foreground">
                    parcelamentos {formatCurrency(m.parcelas)} · recorrências{" "}
                    {formatCurrency(m.recorrencias)}
                  </span>
                </span>
                <span className="text-sm font-bold">{formatCurrency(m.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4" id="parcelamentos">
        <SectionTitle
          title="Parcelamentos ativos"
          hint={`${parcelamentos.length} em andamento · ${formatCurrency(restanteParcelas)} comprometido`}
        />
        {parcelamentos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum parcelamento em andamento.</p>
        ) : (
          <ul className="divide-y divide-border">
            {parcelamentos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{p.descricao}</span>
                  <span className="block text-xs text-muted-foreground">
                    Parcela atual {p.numeroAtual}/{p.total} · {formatCurrency(p.valorParcela)}/mês
                    {p.proximaCobranca && p.proximaParcela
                      ? ` · próxima parcela ${p.proximaParcela}/${p.total} na fatura de ${monthKeyLabel(p.proximaCobranca.slice(0, 7))}`
                      : " · última parcela já faturada"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {p.pagas} paga(s) · {p.restantesQtd} parcela(s) restante(s)
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-bold">{formatCurrency(p.restante)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    restante comprometido
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4" id="recorrencias">
        <SectionTitle
          title="Cobranças recorrentes"
          hint={`${ativas.length} ativa(s) neste cartão · ${formatCurrency(previstoMes)}/mês`}
        />
        {recorrencias.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma cobrança recorrente neste cartão.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recorrencias.map((r) => {
              const previsao = recurringForecast(r, cartao);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{r.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {RECURRENCE_LABELS[r.periodicidade]} ·{" "}
                      {r.ativo
                        ? previsao.data
                          ? `próxima ${formatDate(previsao.data)} · fatura prevista ${monthKeyLabel(previsao.competencia!)}`
                          : "sem próxima cobrança"
                        : `cancelada em ${r.data_cancelamento ? formatDate(r.data_cancelamento) : "—"}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={r.ativo ? "ok" : "muted"}>{r.ativo ? "Ativo" : "Cancelado"}</Badge>
                    <span className="text-sm font-bold">
                      {formatCurrency(Number(r.valor) || 0)}
                    </span>
                    {podeEditar &&
                      (r.ativo ? (
                        <button
                          type="button"
                          onClick={() => void recorrenciaActions.cancel.mutateAsync(r.id)}
                          className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
                        >
                          Cancelar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void recorrenciaActions.reactivate.mutateAsync(r.id)}
                          className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
                        >
                          Reativar
                        </button>
                      ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Cancelar mantém todo o histórico já lançado e apenas interrompe as próximas competências.
        </p>
      </Card>
    </div>
  );
}
