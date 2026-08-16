import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useCardOverview } from "@/hooks/useCardInvoices";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePurchases } from "@/hooks/usePurchases";
import { usePayCardInvoice } from "@/hooks/useTransactions";
import { useExpenseCategories, useExpenses } from "@/hooks/useExpenses";
import { useCardInvoices, useInstallments } from "@/hooks/useCardInvoices";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import {
  monthKeyLabel,
  upcomingInstallmentMonths,
  type CardInvoice,
  type ExpenseInstallment,
} from "@/lib/card-invoices";
import { RECURRENCE_LABELS } from "@/lib/recurring-expenses";
import { useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import type { Expense } from "@/lib/expenses";
import type { Purchase } from "@/lib/purchases";
import { Modal } from "./bancos";
import { NoFamily } from "./receitas";

export const Route = createFileRoute("/_authenticated/cartoes")({
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

type Kind = "normais" | "parceladas" | "recorrentes";

/** Agrupa as compras do cartão por natureza (normal, parcelada, recorrente). */
function kindOf(tipo: string): Kind {
  if (tipo === "COMPRA_PARCELADA" || tipo === "PARCELADO") return "parceladas";
  if (tipo === "COMPRA_RECORRENTE" || tipo === "CONTA_RECORRENTE") return "recorrentes";
  return "normais";
}

const KIND_LABELS: Record<Kind, string> = {
  normais: "Normal",
  parceladas: "Parcelada",
  recorrentes: "Recorrente",
};

type LinhaFatura = {
  id: string;
  data: string;
  estabelecimento: string;
  memberId: string | null;
  categoriaId: string | null;
  kind: Kind;
  parcela: string;
  valor: number;
};

function CartoesPage() {
  const { data: family } = useFamily();
  const { data: cards, isLoading } = useCreditCards(family?.id);
  const overview = useCardOverview(family?.id, cards ?? []);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const memberName = useMemberName(family?.id);
  const pagar = usePayCardInvoice(family?.id);
  const { data: despesas } = useExpenses(family?.id);
  const { data: categorias } = useExpenseCategories();
  const { data: faturas } = useCardInvoices(family?.id);
  const { data: parcelas } = useInstallments(family?.id);
  const { data: recorrentes } = useRecurringExpenses(family?.id);

  const [filtroMembro, setFiltroMembro] = useState("");
  const view = useViewMode();
  const [filtroBanco, setFiltroBanco] = useState("");
  const [mes, setMes] = useState("");
  const [cartaoAberto, setCartaoAberto] = useState("");

  const despesaPorId = useMemo(() => {
    const m = new Map<string, Expense>();
    for (const e of despesas ?? []) m.set(e.id, e);
    return m;
  }, [despesas]);
  const compraPorId = useMemo(() => {
    const m = new Map<string, Purchase>();
    for (const p of purchases ?? []) m.set(p.id, p);
    return m;
  }, [purchases]);

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set((cards ?? []).map((c) => c.banco))).sort();

  const lista = filterByMember(cards ?? [], view.scoped(filtroMembro)).filter((c) =>
    filtroBanco ? c.banco === filtroBanco : true,
  );

  const info = (id: string) => overview.porCartao.find((o) => o.card.id === id);
  const visiveis = lista.filter((c) => {
    if (!mes) return true;
    const venc = info(c.id)?.proximoVencimento;
    return !!venc && venc.startsWith(mes);
  });

  const comprasDoCartao = (cardId: string) =>
    (purchases ?? []).filter((p) => p.credit_card_id === cardId);

  /** Compras que já viraram parcelas na fatura — não podem ser somadas de novo. */
  const comprasComParcelas = new Set(
    (despesas ?? []).map((e) => e.purchase_id).filter(Boolean) as string[],
  );

  const utilizadoDe = (cardId: string) => {
    const dados = info(cardId);
    const compras = comprasDoCartao(cardId)
      .filter((p) => p.status_pagamento === "COMPROMETIDO" && !comprasComParcelas.has(p.id))
      .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);
    return (dados?.valorFaturaAtual ?? 0) + (dados?.parcelasFuturas ?? 0) + compras;
  };

  const faturasDoCartao = (cardId: string) =>
    (faturas ?? []).filter((i) => i.credit_card_id === cardId);

  /** Próximas faturas do cartão (parcelas pendentes por mês de vencimento). */
  const proximasObrigacoes = (cardId: string) => {
    const doCartao = (parcelas ?? []).filter(
      (p) =>
        p.status === "PENDENTE" && faturasDoCartao(cardId).some((i) => i.id === p.card_invoice_id),
    );
    return upcomingInstallmentMonths(doCartao, 3);
  };

  const recorrenciasDoCartao = (cardId: string) =>
    (recorrentes ?? []).filter((r) => r.credit_card_id === cardId && r.ativo);

  /** Linhas da fatura: parcelas ligadas à fatura + compras ainda sem parcela gerada. */
  const linhasDaFatura = (cardId: string, invoice: CardInvoice | null): LinhaFatura[] => {
    const linhas: LinhaFatura[] = [];
    const doInvoice = invoice
      ? (parcelas ?? []).filter((p) => p.card_invoice_id === invoice.id)
      : ([] as ExpenseInstallment[]);

    for (const parcela of doInvoice) {
      const despesa = despesaPorId.get(parcela.expense_id);
      const compra = despesa?.purchase_id ? compraPorId.get(despesa.purchase_id) : undefined;
      const tipo = (compra?.tipo_compra ?? despesa?.tipo_compra ?? "COMPRA_NORMAL") as string;
      linhas.push({
        id: parcela.id,
        data: compra?.data_compra ?? despesa?.data_compra ?? parcela.data_vencimento,
        estabelecimento: compra?.estabelecimento ?? despesa?.descricao ?? "Lançamento",
        memberId: compra?.member_id ?? despesa?.member_id ?? null,
        categoriaId: despesa?.categoria_id ?? null,
        kind: kindOf(tipo),
        parcela:
          (parcela.total_parcelas || 1) > 1
            ? `${parcela.numero_parcela}/${parcela.total_parcelas}`
            : "—",
        valor: Number(parcela.valor_parcela) || 0,
      });
    }

    for (const compra of comprasDoCartao(cardId)) {
      if (comprasComParcelas.has(compra.id)) continue;
      if (compra.status_pagamento !== "COMPROMETIDO") continue;
      linhas.push({
        id: compra.id,
        data: compra.data_compra,
        estabelecimento: compra.estabelecimento,
        memberId: compra.member_id,
        categoriaId: null,
        kind: kindOf(compra.tipo_compra as string),
        parcela: "—",
        valor: Number(compra.valor_total) || 0,
      });
    }

    return linhas.sort((a, b) => (a.data < b.data ? 1 : -1));
  };

  const contasAtivas = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter(
    (a) => a.ativo,
  );

  const totalLimite = visiveis
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const totalFaturasAbertas = visiveis.reduce((acc, c) => {
    const fatura = info(c.id)?.faturaAtual;
    return acc + (fatura && fatura.status !== "PAGA" ? Number(fatura.valor_total) || 0 : 0);
  }, 0);
  const totalUtilizado = visiveis.reduce((acc, c) => acc + utilizadoDe(c.id), 0);
  const saldoContas = contasAtivas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const capacidade = saldoContas - totalFaturasAbertas;
  const statusPagamento =
    capacidade < 0 ? "vermelho" : capacidade < totalFaturasAbertas * 0.2 ? "amarelo" : "verde";
  const statusTexto = {
    verde: "Saldo em contas cobre as faturas abertas com folga.",
    amarelo: "Saldo cobre as faturas, mas com margem pequena.",
    vermelho: "Saldo disponível não cobre todas as faturas abertas.",
  }[statusPagamento];
  const statusClasse = {
    verde: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    amarelo: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    vermelho: "bg-red-500/15 text-red-700 dark:text-red-400",
  }[statusPagamento];

  const cartao = visiveis.find((c) => c.id === cartaoAberto) ?? null;

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Painel de crédito: faturas, limites e capacidade de pagamento. O cadastro do cartão continua no perfil da pessoa."
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
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${statusClasse}`}>
          {statusPagamento.toUpperCase()}
        </span>
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
        {isLoading ? (
          <Card>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </Card>
        ) : visiveis.length ? (
          visiveis.map((c) => {
            const dados = info(c.id);
            const limite = Number(c.limite) || 0;
            const utilizado = utilizadoDe(c.id);
            const disponivel = limite - utilizado;
            const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;
            const fatura = dados?.faturaAtual ?? null;

            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold">
                      {c.banco} · {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Titular: {memberName(c.member_id)} ·{" "}
                      {fatura
                        ? `fatura ${fatura.status.toLowerCase()}`
                        : "sem fatura aberta no momento"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCartaoAberto(c.id)}
                      className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
                    >
                      Detalhes do cartão
                    </button>
                    {c.member_id && (
                      <Link
                        to="/membro/$memberId"
                        params={{ memberId: c.member_id }}
                        className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                      >
                        Ver perfil
                      </Link>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Limite" value={formatCurrency(limite)} />
                  <Metric label="Utilizado" value={formatCurrency(utilizado)} />
                  <Metric
                    label="Disponível"
                    value={formatCurrency(disponivel)}
                    tone={disponivel < 0 ? "danger" : "ok"}
                  />
                  <Metric
                    label="Fatura atual"
                    value={formatCurrency(dados?.valorFaturaAtual ?? 0)}
                  />
                  <Metric
                    label="Vence"
                    value={
                      dados?.proximoVencimento
                        ? formatDate(dados.proximoVencimento)
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
              </Card>
            );
          })
        ) : (
          <Card>
            <p className="text-sm text-muted-foreground">
              Nenhum cartão encontrado. Abra o perfil de uma pessoa em Minha Família e cadastre o
              cartão na aba “Cartões”.
            </p>
          </Card>
        )}
      </div>

      {cartao && (
        <Modal
          title={`${cartao.banco} · ${cartao.nome_cartao}`}
          onClose={() => setCartaoAberto("")}
        >
          <DetalheCartao
            titular={memberName(cartao.member_id)}
            limite={Number(cartao.limite) || 0}
            utilizado={utilizadoDe(cartao.id)}
            faturaAtual={info(cartao.id)?.faturaAtual ?? null}
            faturas={faturasDoCartao(cartao.id)}
            linhas={(invoice) => linhasDaFatura(cartao.id, invoice)}
            proximas={proximasObrigacoes(cartao.id)}
            recorrencias={recorrenciasDoCartao(cartao.id)}
            categorias={categorias ?? []}
            memberName={memberName}
            contas={contasAtivas}
            podePagar={!view.isViewer}
            pagar={pagar}
          />
        </Modal>
      )}
    </div>
  );
}

function DetalheCartao({
  titular,
  limite,
  utilizado,
  faturaAtual,
  faturas,
  linhas,
  proximas,
  recorrencias,
  categorias,
  memberName,
  contas,
  podePagar,
  pagar,
}: {
  titular: string;
  limite: number;
  utilizado: number;
  faturaAtual: CardInvoice | null;
  faturas: CardInvoice[];
  linhas: (invoice: CardInvoice | null) => LinhaFatura[];
  proximas: { key: string; total: number }[];
  recorrencias: { id: string; nome: string; valor: number; periodicidade: string; proxima_cobranca: string }[];
  categorias: { id: string; nome: string }[];
  memberName: (memberId: string | null) => string;
  contas: { id: string; banco: string; nome_conta: string; saldo_atual: number }[];
  podePagar: boolean;
  pagar: ReturnType<typeof usePayCardInvoice>;
}) {
  const [faturaId, setFaturaId] = useState(faturaAtual?.id ?? faturas[0]?.id ?? "");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTitular, setFiltroTitular] = useState("");
  const [pagando, setPagando] = useState(false);
  const [conta, setConta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState("");

  const fatura = faturas.find((f) => f.id === faturaId) ?? faturaAtual;
  const todas = linhas(fatura ?? null);

  const titulares = Array.from(new Set(todas.map((l) => l.memberId)));
  const filtradas = todas.filter(
    (l) =>
      (!filtroTipo || l.kind === filtroTipo) &&
      (!filtroCategoria || l.categoriaId === filtroCategoria) &&
      (!filtroTitular || (l.memberId ?? "sem") === filtroTitular),
  );

  const soma = (kind: Kind) =>
    filtradas.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.valor, 0);
  const totalFatura = filtradas.reduce((acc, l) => acc + l.valor, 0);

  async function confirmarPagamento() {
    setErro("");
    if (!fatura) return;
    if (!conta) {
      setErro("Escolha a conta bancária de origem.");
      return;
    }
    try {
      await pagar.mutateAsync({
        invoiceId: fatura.id,
        bankAccountId: conta,
        data: dataPagamento,
      });
      setPagando(false);
      setConta("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível pagar a fatura.");
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">Titular: {titular}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Fatura atual" value={formatCurrency(Number(fatura?.valor_total ?? 0))} />
        <Metric label="Limite usado" value={formatCurrency(utilizado)} />
        <Metric
          label="Limite disponível"
          value={formatCurrency(limite - utilizado)}
          tone={limite - utilizado < 0 ? "danger" : "ok"}
        />
        <Metric
          label="Fechamento / vencimento"
          value={
            fatura
              ? `${formatDate(fatura.data_fechamento)} · ${formatDate(fatura.data_vencimento)}`
              : "—"
          }
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Field label="Fatura">
          <select
            className={inputClass}
            value={faturaId}
            onChange={(e) => setFaturaId(e.target.value)}
            aria-label="Fatura"
          >
            {faturas.length === 0 && <option value="">Nenhuma fatura</option>}
            {faturas.map((f) => (
              <option key={f.id} value={f.id}>
                Vence {formatDate(f.data_vencimento)} · {f.status.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo de compra">
          <select
            className={inputClass}
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            aria-label="Tipo de compra"
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
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsável">
          <select
            className={inputClass}
            value={filtroTitular}
            onChange={(e) => setFiltroTitular(e.target.value)}
            aria-label="Responsável"
          >
            <option value="">Todos</option>
            {titulares.map((id) => (
              <option key={id ?? "sem"} value={id ?? "sem"}>
                {memberName(id)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="Compras normais" value={formatCurrency(soma("normais"))} />
        <Metric label="Parcelamentos" value={formatCurrency(soma("parceladas"))} />
        <Metric label="Recorrências" value={formatCurrency(soma("recorrentes"))} />
        <Metric label="Total da fatura" value={formatCurrency(totalFatura)} big />
      </div>

      <h3 className="mt-5 text-sm font-bold">Compras da fatura</h3>
      {filtradas.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nenhuma compra vinculada a esta fatura com os filtros atuais.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {filtradas.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{l.estabelecimento}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(l.data)} · {memberName(l.memberId)} · {KIND_LABELS[l.kind]}
                  {l.parcela !== "—" ? ` · ${l.parcela}` : ""}
                </p>
              </div>
              <span className="text-sm font-bold">{formatCurrency(l.valor)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground">Próximas faturas</p>
          <ul className="mt-2 divide-y divide-border">
            {proximas.map((m) => (
              <li key={m.key} className="flex items-center justify-between py-2">
                <span className="text-sm">{monthKeyLabel(m.key)}</span>
                <span className="text-sm font-bold">{formatCurrency(m.total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Considera apenas parcelas e compromissos já registrados.
          </p>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground">Cobranças recorrentes</p>
          {recorrencias.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhuma cobrança recorrente neste cartão.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {recorrencias.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{r.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {RECURRENCE_LABELS[r.periodicidade as keyof typeof RECURRENCE_LABELS]} ·
                      próxima {formatDate(r.proxima_cobranca)}
                    </span>
                  </span>
                  <span className="text-sm font-bold">{formatCurrency(Number(r.valor) || 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {fatura && fatura.status !== "PAGA" && Number(fatura.valor_total) > 0 && podePagar && (
        <div className="mt-5 rounded-2xl bg-muted/50 p-4">
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
                  {contas.map((a) => (
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
              <div className="flex items-end gap-3 sm:col-span-3">
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
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
  big?: boolean;
}) {
  return (
    <div className={big ? "rounded-2xl border border-border bg-card px-4 py-3" : ""}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-extrabold ${big ? "text-xl" : "text-lg"} ${
          tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
