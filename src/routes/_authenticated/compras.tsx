import { useState } from "react";
import { SearchInput, matchesSearch } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { AddButton } from "@/components/form-dialog";
import { PAYMENT_STATUS_TONES } from "@/lib/status";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { MemberSelect, useMemberName } from "@/components/member-select";
import { useViewMode } from "@/components/view-mode";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useExpenseCategories } from "@/hooks/useExpenses";
import {
  useProducts,
  usePurchaseInstallmentsByPurchases,
  usePurchaseItemCategories,
  usePurchases,
} from "@/hooks/usePurchases";
import { formatCurrency } from "@/lib/finance";
import {
  PAYMENT_METHOD_LABELS,
  PURCHASE_TYPE_LABELS,
  formatDate,
  type PaymentMethod,
  type PurchaseType,
} from "@/lib/expenses";
import {
  PAGAR_DEPOIS,
  PAYMENT_FILTER_LABELS,
  PAYMENT_METHOD_SHORT,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_SHORT,
  PURCHASE_KINDS,
  PURCHASE_KIND_HINTS,
  UNIDADES,
  createPurchase,
  isAtrasada,
  isPendentePagamento,
  itemTotal,
  matchesPaymentFilter,
  parcelaDoPeriodo,
  progressoParcelamento,
  purchaseTotal,
  usesBankAccount,
  type NewPurchaseItem,
  type PaymentFilter,
  type Purchase,
} from "@/lib/purchases";
import {
  PagamentosPendentesCard,
  RegistrarPagamentoDialog,
} from "@/components/purchase-payment";
import {
  RECURRENCES,
  RECURRENCE_LABELS,
  type ExpenseRecurrence,
} from "@/lib/recurring-expenses";
import { isRecorrente } from "@/lib/purchases";
import { NovaCompraOptions } from "@/components/purchase-capture";
import { PurchaseDetail } from "@/components/purchase-detail";
import { VisaoConsumo } from "@/components/purchase-consumption";
import { DeletePurchaseDialog } from "@/components/purchase-delete";
import { PossiveisDuplicidades } from "@/components/purchase-duplicates";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({
    meta: [
      { title: "Compras — Família Finance AI" },
      {
        name: "description",
        content:
          "Registre compras completas com todos os produtos, quantidades e valores para acompanhar o consumo da família.",
      },
      { property: "og:title", content: "Compras — Família Finance AI" },
      {
        property: "og:description",
        content: "Histórico de compras detalhado por produto, responsável e forma de pagamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Compras,
});

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

const emptyItem: NewPurchaseItem = {
  product_id: "",
  descricao_produto: "",
  quantidade: "1",
  unidade: "UN",
  valor_unitario: "",
  categoria_id: "",
};

const today = () => new Date().toISOString().slice(0, 10);

function Compras() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: family } = useFamily();
  const { data: purchases, isLoading } = usePurchases(family?.id);
  const { data: cards } = useCreditCards(family?.id);
  const { data: contas } = useBankAccounts(family?.id);
  const { data: products } = useProducts();
  const { data: categorias } = useExpenseCategories();
  const memberName = useMemberName(family?.id);

  const [estabelecimento, setEstabelecimento] = useState("");
  const [dataCompra, setDataCompra] = useState(today());
  const [memberId, setMemberId] = useState("");
  const [tipoCompra, setTipoCompra] = useState<PurchaseType>("COMPRA_NORMAL");
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>("DINHEIRO");
  const [cartaoId, setCartaoId] = useState("");
  const [contaId, setContaId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [periodicidade, setPeriodicidade] = useState<ExpenseRecurrence>("MENSAL");
  const [dataPrevista, setDataPrevista] = useState("");

  const [items, setItems] = useState<NewPurchaseItem[]>([{ ...emptyItem }]);
  const [showForm, setShowForm] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const view = useViewMode();
  const membroResponsavel = view.isAdmin ? memberId : view.myMemberId;

  const [busca, setBusca] = useState("");
  const [filtroMembro, setFiltroMembro] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroPagamento, setFiltroPagamento] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroMes, setFiltroMes] = useState("");
  const [filtroFatura, setFiltroFatura] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<PaymentFilter>("");
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [pagando, setPagando] = useState<Purchase | null>(null);

  const total = purchaseTotal(items);

  const escopo = view.scoped(filtroMembro);
  const porEscopo = filterByMember(purchases ?? [], escopo).filter(
    (p) =>
      (!filtroPagamento || p.forma_pagamento === filtroPagamento) &&
      matchesPaymentFilter(p, filtroStatus) &&
      (!filtroTipo || p.tipo_compra === filtroTipo) &&
      (!filtroMes || p.data_compra.slice(0, 7) === filtroMes) &&
      matchesSearch(busca, p.estabelecimento, p.observacao),
  );
  const itemCategorias = usePurchaseItemCategories(porEscopo.map((p) => p.id));
  const parcelasDaLista = usePurchaseInstallmentsByPurchases(porEscopo.map((p) => p.id));
  const parcelasDe = (purchaseId: string) =>
    (parcelasDaLista.data ?? []).filter((p) => p.purchase_id === purchaseId);
  /** Competências de fatura disponíveis (mês de vencimento das parcelas). */
  const faturasDisponiveis = [
    ...new Set((parcelasDaLista.data ?? []).map((p) => p.data_vencimento.slice(0, 7))),
  ].sort();
  const porCategoria = filtroCategoria
    ? porEscopo.filter((p) =>
        (itemCategorias.data ?? []).some(
          (i) => i.purchase_id === p.id && i.categoria_id === filtroCategoria,
        ),
      )
    : porEscopo;
  // Filtro por fatura ≠ filtro por mês da compra: aqui vale o ciclo em que a parcela cai.
  const lista = filtroFatura
    ? porCategoria.filter((p) =>
        parcelasDe(p.id).some((i) => i.data_vencimento.startsWith(filtroFatura)),
      )
    : porCategoria;
  const compraDetalhe = lista.find((p) => p.id === detalhe) ?? null;
  /** Parcela do período de uma compra parcelada (base do valor em destaque). */
  const parcelaDaCompra = (purchaseId: string) => {
    const parcela = parcelaDoPeriodo(parcelasDe(purchaseId), filtroFatura || filtroMes);
    return parcela && parcela.total_parcelas > 1 ? parcela : null;
  };
  /** Estado derivado do parcelamento: a compra nunca some depois da 1ª parcela paga. */
  const progressoDaCompra = (purchaseId: string) => progressoParcelamento(parcelasDe(purchaseId));
  const temFiltro = Boolean(
    busca ||
      filtroMembro ||
      filtroCategoria ||
      filtroPagamento ||
      filtroTipo ||
      filtroMes ||
      filtroFatura ||
      filtroStatus,
  );
  const limparFiltros = () => {
    setBusca("");
    setFiltroMembro("");
    setFiltroCategoria("");
    setFiltroPagamento("");
    setFiltroTipo("");
    setFiltroMes("");
    setFiltroFatura("");
    setFiltroStatus("");
  };
  const totalListado = lista.reduce((acc, p) => {
    const parcela = parcelaDaCompra(p.id);
    return acc + (parcela ? parcela.valor_parcela : Number(p.valor_total) || 0);
  }, 0);



  const setItem = (index: number, patch: Partial<NewPurchaseItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const reset = () => {
    setEstabelecimento("");
    setDataCompra(today());
    setMemberId("");
    setTipoCompra("COMPRA_NORMAL");
    setFormaPagamento("DINHEIRO");
    setCartaoId("");
    setContaId("");
    setObservacao("");
    setParcelas("1");
    setPeriodicidade("MENSAL");
    setDataPrevista("");
    setItems([{ ...emptyItem }]);
  };

  const invalidateFinanceiro = () => {
    for (const key of [
      "purchases",
      "bank-accounts",
      "transactions",
      "card-invoices",
      "expense-installments",
      "recurring-expenses",
      "expenses",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key, family?.id] });
    }
  };

  const create = useMutation({
    mutationFn: () =>
      createPurchase({
        purchase: {
          family_id: family!.id,
          member_id: membroResponsavel || null,
          created_by: user?.id ?? null,
          estabelecimento: estabelecimento.trim(),
          data_compra: dataCompra,
          tipo_compra: tipoCompra,
          forma_pagamento: formaPagamento,
          credit_card_id: formaPagamento === "CREDITO" ? cartaoId || null : null,
          bank_account_id: usesBankAccount(formaPagamento) ? contaId || null : null,
          observacao: observacao.trim() || null,
          data_prevista_pagamento:
            formaPagamento === PAGAR_DEPOIS ? dataPrevista || null : null,
        },
        items: items.filter((i) => i.descricao_produto.trim() !== ""),
        parcelas: Number(parcelas) || 1,
        periodicidade,
        cards: cards ?? [],
      }),
    onSuccess: () => {
      toast.success("Compra registrada.");
      reset();
      setShowForm(false);
      invalidateFinanceiro();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [excluindo, setExcluindo] = useState<Purchase | null>(null);


  if (!family) {
    return (
      <div>
        <PageHeader title="Compras" subtitle="Registre suas compras detalhadas por produto." />
        <Card>
          <p className="text-sm text-muted-foreground">
            Crie sua família em “Minha Família” para começar a registrar compras.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Compras"
          subtitle="Histórico das compras da família, com cada produto, quantidade e valor."
        />
        {view.podeLancar && (
        <button
          type="button"
          onClick={() => {
            setShowOptions((v) => !v);
            setShowForm(false);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
        >
          {showOptions || showForm ? "Fechar" : "+ Nova compra"}
        </button>
        )}
      </div>

      {showOptions && view.podeLancar && (
        <NovaCompraOptions
          familyId={family.id}
          memberId={view.myMemberId}
          createdBy={user?.id}
          podeLancar={view.podeLancar}
          onManual={() => {
            setShowForm(true);
            setShowOptions(false);
          }}
          onConfirmed={() => {
            setShowOptions(false);
            invalidateFinanceiro();
          }}
        />
      )}


      {showForm && view.podeLancar && (
      <Card>
        <h2 className="text-base font-bold">Nova compra</h2>
        <form
          className="mt-4 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (items.every((i) => i.descricao_produto.trim() === "")) {
              toast.error("Adicione ao menos um produto.");
              return;
            }
            if (!membroResponsavel) {
              toast.error("Selecione quem fez a compra.");
              return;
            }
            if (formaPagamento === "CREDITO" && !cartaoId) {
              toast.error("Selecione o cartão usado na compra.");
              return;
            }
            if (usesBankAccount(formaPagamento) && !contaId) {
              toast.error("Selecione a conta bancária usada no pagamento.");
              return;
            }
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Estabelecimento">
              <input
                required
                value={estabelecimento}
                onChange={(e) => setEstabelecimento(e.target.value)}
                className={inputClass}
                placeholder="Supermercado Bom Preço"
              />
            </Field>
            <Field label="Data da compra">
              <input
                required
                type="date"
                value={dataCompra}
                onChange={(e) => setDataCompra(e.target.value)}
                className={inputClass}
              />
            </Field>
            <MemberSelect
              familyId={family.id}
              value={membroResponsavel}
              onChange={(v) => view.isAdmin && setMemberId(v)}
              label="Quem comprou"
              disabled={!view.isAdmin}
            />
            <Field label="Tipo de compra">
              <select
                value={tipoCompra}
                onChange={(e) => setTipoCompra(e.target.value as PurchaseType)}
                className={inputClass}
              >
                {PURCHASE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PURCHASE_TYPE_LABELS[k]} — {PURCHASE_KIND_HINTS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Forma de pagamento">
              <select
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value as PaymentMethod)}
                className={inputClass}
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {PAYMENT_METHOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            {formaPagamento === "CREDITO" && (
              <Field label="Cartão">
                <select
                  value={cartaoId}
                  onChange={(e) => setCartaoId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {(cards ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome_cartao} · {c.banco}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {usesBankAccount(formaPagamento) && (
              <Field label="Conta bancária">
                <select
                  value={contaId}
                  onChange={(e) => setContaId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione</option>
                  {filterByMember(contas ?? [], membroResponsavel)
                    .filter((c) => c.ativo)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.banco} · {c.nome_conta}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {formaPagamento === PAGAR_DEPOIS && (
              <Field label="Previsão de pagamento (opcional)">
                <input
                  type="date"
                  value={dataPrevista}
                  onChange={(e) => setDataPrevista(e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
            {tipoCompra === "COMPRA_PARCELADA" && (
              <Field label="Quantidade de parcelas">
                <input
                  type="number"
                  min="1"
                  max="48"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
            {isRecorrente(tipoCompra) && (
              <Field label="Periodicidade">
                <select
                  value={periodicidade}
                  onChange={(e) => setPeriodicidade(e.target.value as ExpenseRecurrence)}
                  className={inputClass}
                >
                  {RECURRENCES.map((r) => (
                    <option key={r} value={r}>
                      {RECURRENCE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Observação">
              <input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className={inputClass}
                placeholder="Opcional"
              />
            </Field>
          </div>

          <div>
            <h3 className="text-sm font-bold">Produtos</h3>
            <div className="mt-3 space-y-3">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-6"
                >
                  <Field label="Produto">
                    <input
                      list="produtos-catalogo"
                      value={item.descricao_produto}
                      onChange={(e) => {
                        const nome = e.target.value;
                        const match = (products ?? []).find(
                          (p) => p.nome.toLowerCase() === nome.toLowerCase(),
                        );
                        setItem(index, {
                          descricao_produto: nome,
                          product_id: match?.id ?? "",
                          ...(match
                            ? {
                                unidade: match.unidade_medida,
                                categoria_id: match.categoria_id ?? item.categoria_id,
                              }
                            : {}),
                        });
                      }}
                      className={inputClass}
                      placeholder="Arroz"
                    />
                  </Field>
                  <Field label="Quantidade">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={item.quantidade}
                      onChange={(e) => setItem(index, { quantidade: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Unidade">
                    <select
                      value={item.unidade}
                      onChange={(e) => setItem(index, { unidade: e.target.value })}
                      className={inputClass}
                    >
                      {UNIDADES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Valor unitário">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.valor_unitario}
                      onChange={(e) => setItem(index, { valor_unitario: e.target.value })}
                      className={inputClass}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Categoria">
                    <select
                      value={item.categoria_id}
                      onChange={(e) => setItem(index, { categoria_id: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">Sem categoria</option>
                      {(categorias ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-sm font-semibold">{formatCurrency(itemTotal(item))}</p>
                    {items.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remover produto"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <datalist id="produtos-catalogo">
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.nome} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, { ...emptyItem }])}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
            >
              <Plus className="size-4" /> Adicionar produto
            </button>
          </div>

          <p className="rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
            {formaPagamento === "CREDITO"
              ? "Cartão de crédito: nada sai da conta agora — a compra vira compromisso futuro no cartão."
              : formaPagamento === "BOLETO"
                ? "Boleto: a compra fica registrada como obrigação financeira pendente."
                : usesBankAccount(formaPagamento)
                  ? "O valor será debitado do saldo da conta bancária selecionada."
                  : "Dinheiro: registra a saída do caixa da família."}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Valor total da compra:{" "}
              <span className="text-lg font-extrabold text-foreground">
                {formatCurrency(total)}
              </span>
            </p>
            <PrimaryButton type="submit" disabled={create.isPending}>
              {create.isPending ? "Salvando..." : "Salvar compra"}
            </PrimaryButton>
          </div>
        </form>
      </Card>
      )}

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">Buscar e filtrar</h2>
          {temFiltro && (
            <button
              type="button"
              onClick={limparFiltros}
              className="text-xs font-semibold text-primary"
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="mt-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar compra"
            placeholder="Estabelecimento ou observação"
          />
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {view.isAdmin && (
            <MemberFilter
              familyId={family.id}
              value={filtroMembro}
              onChange={setFiltroMembro}
              label="Pessoa responsável"
            />
          )}
          <Field label="Tipo de compra">
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className={inputClass}
            >
              <option value="">Todas</option>
              {PURCHASE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PURCHASE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              className={inputClass}
            >
              <option value="">Todas</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Forma de pagamento">
            <select
              value={filtroPagamento}
              onChange={(e) => setFiltroPagamento(e.target.value)}
              className={inputClass}
            >
              <option value="">Todas</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status de pagamento">
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as PaymentFilter)}
              className={inputClass}
            >
              {(Object.keys(PAYMENT_FILTER_LABELS) as PaymentFilter[]).map((f) => (
                <option key={f} value={f}>
                  {PAYMENT_FILTER_LABELS[f]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período (mês)">
            <input
              type="month"
              value={filtroMes}
              onChange={(e) => setFiltroMes(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>





      <PagamentosPendentesCard
        familyId={family.id}
        purchases={filterByMember(purchases ?? [], escopo)}
        podeLancar={view.podeLancar}
        onRegistrar={setPagando}
      />

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Histórico de compras</h2>
          <span className="text-sm font-semibold text-primary">
            Total filtrado: {formatCurrency(totalListado)}
          </span>
        </div>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : lista.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<ShoppingBag className="size-5" />}
              title={temFiltro ? "Nenhuma compra com esses filtros" : "Nenhuma compra registrada"}
              description={
                temFiltro
                  ? "Ajuste a busca, o período ou os filtros para encontrar o que procura."
                  : "Toda movimentação financeira começa por uma compra. Registre a primeira para o Dashboard começar a fazer sentido."
              }
              action={
                temFiltro ? (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="min-h-11 rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Limpar filtros
                  </button>
                ) : view.podeLancar ? (
                  <AddButton onClick={() => setShowOptions(true)}>Nova compra</AddButton>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {lista.map((p) => {
              const parcela = parcelaDaCompra(p.id);
              return (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setDetalhe(p.id)}
                    className="flex min-w-52 flex-1 items-center gap-2 text-left"
                    aria-label={`Ver detalhes da compra em ${p.estabelecimento}`}
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        {p.estabelecimento}
                        {parcela && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                            {parcela.numero_parcela}/{parcela.total_parcelas}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(p.data_compra)} · {memberName(p.member_id)} ·{" "}
                        {PAYMENT_METHOD_SHORT[p.forma_pagamento]} ·{" "}
                        {PURCHASE_TYPE_LABELS[p.tipo_compra]}
                        {isPendentePagamento(p) &&
                          (p.data_prevista_pagamento
                            ? ` · previsto para ${formatDate(p.data_prevista_pagamento)}`
                            : " · sem data prevista")}
                        {isAtrasada(p) && " · atrasada"}
                      </span>
                    </span>
                  </button>
                  <StatusBadge
                    tone={PAYMENT_STATUS_TONES[p.status_pagamento]}
                    title={PAYMENT_STATUS_LABELS[p.status_pagamento]}
                  >
                    {PAYMENT_STATUS_SHORT[p.status_pagamento]}
                  </StatusBadge>
                  <span className="text-right">
                    <span className="block text-sm font-bold">
                      {formatCurrency(parcela ? parcela.valor_parcela : Number(p.valor_total))}
                    </span>
                    {parcela && (
                      <span className="block text-xs text-muted-foreground">
                        Total da compra: {formatCurrency(Number(p.valor_total))}
                      </span>
                    )}
                  </span>

                  {view.podeLancar && isPendentePagamento(p) && (
                    <button
                      type="button"
                      onClick={() => setPagando(p)}
                      className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Registrar pagamento
                    </button>
                  )}
                  {view.podeLancar && (
                    <button
                      aria-label={`Excluir compra em ${p.estabelecimento}`}
                      onClick={() => setExcluindo(p)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </li>
              );
            })}

          </ul>
        )}
      </Card>

      <PossiveisDuplicidades purchases={lista} onMerged={invalidateFinanceiro} />

      <VisaoConsumo purchaseIds={lista.map((p) => p.id)} />

      {compraDetalhe && (
        <PurchaseDetail purchase={compraDetalhe} onClose={() => setDetalhe(null)} />
      )}

      {pagando && (
        <RegistrarPagamentoDialog purchase={pagando} onClose={() => setPagando(null)} />
      )}

      {excluindo && (
        <DeletePurchaseDialog
          purchase={excluindo}
          onClose={() => setExcluindo(null)}
          onDeleted={invalidateFinanceiro}
        />
      )}
    </div>
  );
}

