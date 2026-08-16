import { useState } from "react";
import { FileUp, Receipt } from "lucide-react";
import { StatementImportDialog } from "@/components/statement-import-dialog";
import { CardStatementImports } from "@/components/card-statement-imports";

import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { TONE_DOTS, usageTone } from "@/lib/status";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, inputClass } from "@/components/page-header";
import { Badge, DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePayCardInvoice } from "@/hooks/useTransactions";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useRecurringExpenseActions } from "@/hooks/useRecurringExpenses";
import { useMemberName } from "@/components/member-select";
import { filterByMember } from "@/components/member-filter";
import { useViewMode } from "@/components/view-mode";
import { monthKeyLabel } from "@/lib/card-invoices";
import { RECURRENCE_LABELS } from "@/lib/recurring-expenses";
import { ESTADO_CICLO_LABELS, KIND_LABELS, type EstadoCiclo, type Kind } from "@/lib/card-details";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/cartoes/$cardId")({
  head: () => ({
    meta: [
      { title: "Detalhes do cartão — Família Finance AI" },
      {
        name: "description",
        content:
          "Página completa do cartão: fatura atual, composição, lançamentos, parcelamentos, recorrências e projeção das próximas faturas.",
      },
      { property: "og:title", content: "Detalhes do cartão — Família Finance AI" },
      {
        property: "og:description",
        content: "Fatura, limite, lançamentos e pagamento do cartão em uma página completa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CartaoDetalhePage,
});

function CartaoDetalhePage() {
  const { cardId } = Route.useParams();
  const { data: family } = useFamily();
  const dados = useCardsData(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: categorias } = useExpenseCategories();
  const memberName = useMemberName(family?.id);
  const pagar = usePayCardInvoice(family?.id);
  const recorrenciaActions = useRecurringExpenseActions(family?.id);
  const view = useViewMode();

  const [faturaId, setFaturaId] = useState("");
  const [aba, setAba] = useState<"fechada" | "proxima" | "historico">("fechada");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [busca, setBusca] = useState("");
  const [pagando, setPagando] = useState(false);
  const [conta, setConta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState("");
  const [importando, setImportando] = useState(false);

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

  const info = dados.info(cartao.id);
  const limite = Number(cartao.limite) || 0;
  const utilizado = dados.utilizadoDe(cartao.id);
  const disponivel = limite - utilizado;
  const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;

  // Só ciclos reais (fechados/pagos/oficiais) e a fatura em formação entram no seletor.
  const ciclos = dados.ciclosDe(cartao.id);
  const cicloFechado = ciclos.atual;
  const cicloProximo = ciclos.emFormacao;
  const selecionaveis = [ciclos.atual, ciclos.emFormacao, ...ciclos.historico].filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  // Aba operacional: fatura fechada, próxima em formação ou um ciclo do histórico.
  const doHistorico = ciclos.historico.find((c) => c.invoice.id === faturaId) ?? null;
  const cicloSelecionado =
    (aba === "proxima" ? cicloProximo : aba === "historico" ? doHistorico : cicloFechado) ??
    cicloFechado ??
    cicloProximo ??
    selecionaveis[0] ??
    null;
  const fatura = cicloSelecionado?.invoice ?? null;
  const estadoSelecionado: EstadoCiclo | null = cicloSelecionado?.estado ?? null;
  const toneEstado = (estado: EstadoCiclo) =>
    estado === "PAGA" ? "ok" : estado === "VENCIDA" ? "danger" : estado === "EM_FORMACAO" ? "muted" : "warn";
  const optionLabel = (c: (typeof selecionaveis)[number]) =>
    `${monthKeyLabel(c.competencia)} · ${formatCurrency(c.valor)} · ${ESTADO_CICLO_LABELS[c.estado]}`;

  const linhas = dados.linhasDe(cartao.id, fatura);
  const filtradas = linhas.filter(
    (l) =>
      (!filtroTipo || l.kind === filtroTipo) &&
      (!filtroCategoria || l.categoriaId === filtroCategoria) &&
      matchesSearch(busca, l.estabelecimento),
  );
  const soma = (kind: Kind) =>
    filtradas.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.valor, 0);
  const totalFatura = filtradas.reduce((acc, l) => acc + l.valor, 0);
  const categoriaNome = (id: string | null) =>
    (categorias ?? []).find((c) => c.id === id)?.nome ?? "—";

  // O que já está entrando na próxima fatura (ciclo em formação).
  const linhasProxima = cicloProximo ? dados.linhasDe(cartao.id, cicloProximo.invoice) : [];
  const somaProxima = (kind: Kind) =>
    linhasProxima.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.valor, 0);
  const totalProxima = linhasProxima.reduce((acc, l) => acc + l.valor, 0);

  const proximas = dados.proximasDe(cartao.id);
  const parcelamentos = dados.parcelamentosDe(cartao.id);
  const recorrencias = dados.recorrenciasDoCartao(cartao.id);
  // Restante comprometido = soma das parcelas ainda não quitadas (nunca o total original).
  const restanteParcelas = parcelamentos.reduce((acc, p) => acc + p.restante, 0);

  // Fonte de verdade: fatura oficial importada e confirmada do ciclo > cálculo interno.
  const faturaCiclo = dados.faturaDe(cartao.id, fatura);
  const faturaFechadaCiclo = dados.faturaDe(cartao.id, cicloFechado?.invoice ?? null);
  const composicao = dados.composicaoDe(cartao.id);


  // Capacidade de pagamento: mesma fórmula da visão geral, aplicada às contas do titular.
  const contasAutorizadas = filterByMember(accounts ?? [], cartao.member_id ?? "sem").filter(
    (a) => a.ativo,
  );
  const saldoContas = contasAutorizadas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const valorFaturaAberta = fatura && fatura.status !== "PAGA" ? faturaCiclo.valor : 0;

  const capacidade = saldoContas - valorFaturaAberta;
  const statusPagamento =
    capacidade < 0 ? "Crítico" : capacidade < valorFaturaAberta * 0.2 ? "Atenção" : "Seguro";
  const statusTone = capacidade < 0 ? "danger" : statusPagamento === "Atenção" ? "warn" : "ok";

  const contasParaPagar = (accounts ?? []).filter((a) => a.ativo);
  const podePagar = !view.isViewer;

  async function confirmarPagamento() {
    setErro("");
    if (!fatura) return;
    if (!conta) {
      setErro("Escolha a conta bancária de origem.");
      return;
    }
    try {
      await pagar.mutateAsync({ invoiceId: fatura.id, bankAccountId: conta, data: dataPagamento });
      setPagando(false);
      setConta("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível pagar a fatura.");
    }
  }

  return (
    <div>
      <DetailHeader
        backTo="/cartoes"
        backLabel="Voltar para Cartões"
        title={cartao.nome_cartao}
        subtitle={`${memberName(cartao.member_id)} · ${cartao.banco}`}
        badges={
          <>
            <Badge tone={cartao.ativo ? "ok" : "muted"}>{cartao.ativo ? "Ativo" : "Inativo"}</Badge>
            <Badge>Fechamento dia {cartao.dia_fechamento}</Badge>
            <Badge>Vencimento dia {cartao.dia_vencimento}</Badge>
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setImportando(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
            >
              <FileUp className="size-3.5" /> Importar fatura
            </button>
            {cartao.member_id ? (
              <Link
                to="/membro/$memberId"
                params={{ memberId: cartao.member_id }}
                className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
              >
                Ver perfil do titular
              </Link>
            ) : null}
          </>
        }
      />

      {importando && (
        <StatementImportDialog
          cards={dados.cards}
          cardIdInicial={cartao.id}
          onClose={() => setImportando(false)}
        />
      )}



      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={faturaCiclo.label}
          value={formatCurrency(faturaCiclo.valor)}
          hint={
            faturaCiclo.vencimento
              ? `Vence em ${formatDate(faturaCiclo.vencimento)}${faturaCiclo.oficial ? " · fatura oficial importada" : " · estimativa interna"}`
              : undefined
          }
          big
        />
        <Metric
          label="Limite utilizado"
          value={formatCurrency(utilizado)}
          hint={`Fatura do ciclo ${formatCurrency(composicao.faturaAtual)} + parcelas futuras ${formatCurrency(composicao.parcelasFuturas)} + outras parcelas em aberto ${formatCurrency(composicao.outros)} + compras sem parcela ${formatCurrency(composicao.comprasSemParcela)}`}
          big
        />

        <Metric
          label="Limite disponível"
          value={formatCurrency(disponivel)}
          tone={disponivel < 0 ? "danger" : "ok"}
          big
        />
        <Metric label="Limite total" value={formatCurrency(limite)} big />
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${TONE_DOTS[usageTone(uso)]}`}
          style={{ width: `${uso}%` }}
        />
      </div>

      <Card className="mt-6">
        <SectionTitle
          title="Capacidade de pagamento"
          hint="Compara a fatura em aberto com o saldo das contas do titular."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label={faturaCiclo.label} value={formatCurrency(valorFaturaAberta)} />
          <Metric label="Saldo nas contas do titular" value={formatCurrency(saldoContas)} />
          <Metric
            label="Sobra após pagar"
            value={formatCurrency(capacidade)}
            tone={capacidade < 0 ? "danger" : "ok"}
          />
        </div>
        <div className="mt-3">
          <Badge tone={statusTone}>{statusPagamento}</Badge>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionTitle title="Fatura" hint="Escolha a competência para ver total e lançamentos." />
          {estadoSelecionado && (
            <Badge tone={toneEstado(estadoSelecionado)}>{ESTADO_CICLO_LABELS[estadoSelecionado]}</Badge>
          )}
        </div>

        <div className="mb-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar lançamento"
            placeholder="Estabelecimento ou descrição"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Competência">
            <select
              className={inputClass}
              value={fatura?.id ?? ""}
              onChange={(e) => setFaturaId(e.target.value)}
              aria-label="Fatura"
            >
              {selecionaveis.length === 0 && <option value="">Nenhuma fatura</option>}
              {ciclos.atual && (
                <optgroup label="Fatura atual">
                  <option value={ciclos.atual.invoice.id}>{optionLabel(ciclos.atual)}</option>
                </optgroup>
              )}
              {ciclos.emFormacao && (
                <optgroup label="Próxima fatura">
                  <option value={ciclos.emFormacao.invoice.id}>
                    {optionLabel(ciclos.emFormacao)}
                  </option>
                </optgroup>
              )}
              {ciclos.historico.length > 0 && (
                <optgroup label="Histórico">
                  {ciclos.historico.map((c) => (
                    <option key={c.invoice.id} value={c.invoice.id}>
                      {optionLabel(c)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Tipo de lançamento">
            <select
              className={inputClass}
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              aria-label="Tipo de lançamento"
            >
              <option value="">Todos</option>
              <option value="normais">Normal</option>
              <option value="parceladas">Parcelada</option>
              <option value="recorrentes">Recorrente</option>
            </select>
          </Field>
          <Field label="Categoria">
            <select
              className={inputClass}
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              aria-label="Categoria"
            >
              <option value="">Todas</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {fatura && (
          <p className="mt-3 text-xs text-muted-foreground">
            Ciclo de {formatDate(fatura.data_inicio_ciclo)} a {formatDate(fatura.data_fechamento)} ·
            fechamento {formatDate(fatura.data_fechamento)} · vencimento{" "}
            {formatDate(fatura.data_vencimento)}
            {estadoSelecionado === "EM_FORMACAO"
              ? " · valor parcial, o ciclo ainda não fechou"
              : cicloSelecionado?.oficial
                ? " · fatura oficial importada"
                : " · valor calculado pelo sistema"}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Compras normais" value={formatCurrency(soma("normais"))} />
          <Metric label="Parcelamentos" value={formatCurrency(soma("parceladas"))} />
          <Metric label="Recorrências" value={formatCurrency(soma("recorrentes"))} />
          <Metric label="Total da fatura" value={formatCurrency(totalFatura)} big />
        </div>

        {podePagar && fatura && fatura.status !== "PAGA" && Number(fatura.valor_total) > 0 && (
          <div className="mt-4 rounded-2xl bg-muted/50 p-4">
            {pagando ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Conta de origem">
                  <select
                    className={inputClass}
                    value={conta}
                    onChange={(e) => setConta(e.target.value)}
                    aria-label="Conta bancária de origem"
                  >
                    <option value="">Selecione</option>
                    {contasParaPagar.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.banco} · {a.nome_conta} ({formatCurrency(Number(a.saldo_atual))})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data do pagamento">
                  <input
                    type="date"
                    className={inputClass}
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                  />
                </Field>
                <Field label="Valor">
                  <input
                    className={inputClass}
                    value={formatCurrency(Number(fatura.valor_total))}
                    readOnly
                    aria-label="Valor da fatura"
                  />
                </Field>
                <div className="flex flex-wrap items-end gap-3 sm:col-span-3">
                  <button
                    type="button"
                    onClick={() => void confirmarPagamento()}
                    disabled={pagar.isPending}
                    className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {pagar.isPending ? "Pagando..." : "Confirmar pagamento"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPagando(false);
                      setErro("");
                    }}
                    className="rounded-full border border-border px-5 py-2 text-xs font-semibold text-muted-foreground"
                  >
                    Cancelar
                  </button>
                </div>
                {erro && (
                  <p className="text-xs font-semibold text-destructive sm:col-span-3">{erro}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPagando(true)}
                className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
              >
                Pagar fatura
              </button>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              O pagamento gera apenas uma movimentação bancária do tipo pagamento de cartão — nunca
              uma nova compra.
            </p>
          </div>
        )}
        {fatura?.status === "PAGA" && (
          <p className="mt-4 text-xs font-semibold text-emerald-600">Fatura paga</p>
        )}
      </Card>

      <CardStatementImports
        familyId={family.id}
        cardId={cartao.id}
        onImportar={() => setImportando(true)}
      />



      <Card className="mt-4">
        <SectionTitle title="Lançamentos da fatura" />
        {filtradas.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title="Nenhum lançamento nesta fatura"
            description="Compras no cartão, parcelas e recorrências deste ciclo aparecem aqui assim que forem registradas."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2">Categoria</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Parcela</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtradas.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                      {formatDate(l.data)}
                    </td>
                    <td className="px-2 py-2.5 font-semibold">{l.estabelecimento}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">
                      {categoriaNome(l.categoriaId)}
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{KIND_LABELS[l.kind]}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">{l.parcela}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-bold">
                      {formatCurrency(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="Compromissos futuros"
            hint="Projeção de parcelas e recorrências dos próximos meses — não são faturas fechadas."
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
                      Projetado · parcelamentos {formatCurrency(m.parcelas)} · recorrências{" "}
                      {formatCurrency(m.recorrencias)}
                    </span>
                  </span>
                  <span className="text-sm font-bold">{formatCurrency(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Parcelamentos ativos" />
          {parcelamentos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum parcelamento em andamento.</p>
          ) : (
            <ul className="divide-y divide-border">
              {parcelamentos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.descricao}</span>
                    <span className="block text-xs text-muted-foreground">
                      Parcela {p.numeroAtual}/{p.total} · {formatCurrency(p.valorParcela)}/mês
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
      </div>

      <Card className="mt-4">
        <SectionTitle title="Cobranças recorrentes" />
        {recorrencias.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma cobrança recorrente neste cartão.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recorrencias.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {RECURRENCE_LABELS[r.periodicidade]} ·{" "}
                    {r.ativo
                      ? `próxima cobrança ${formatDate(r.proxima_cobranca)}`
                      : `cancelada em ${r.data_cancelamento ? formatDate(r.data_cancelamento) : "—"}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={r.ativo ? "ok" : "muted"}>{r.ativo ? "Ativo" : "Cancelado"}</Badge>
                  <span className="text-sm font-bold">{formatCurrency(Number(r.valor) || 0)}</span>
                  {podePagar &&
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
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
