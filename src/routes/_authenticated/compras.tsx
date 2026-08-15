import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
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
  usePurchaseItemCategories,
  usePurchaseItems,
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
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  PURCHASE_KINDS,
  PURCHASE_KIND_HINTS,
  UNIDADES,
  createPurchase,
  deletePurchase,
  itemTotal,
  purchaseTotal,
  usesBankAccount,
  type NewPurchaseItem,
} from "@/lib/purchases";
import { DocumentosSection, NovaCompraOptions } from "@/components/purchase-capture";
import { PurchaseDetail } from "@/components/purchase-detail";
import { VisaoConsumo } from "@/components/purchase-consumption";

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
  const [items, setItems] = useState<NewPurchaseItem[]>([{ ...emptyItem }]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const view = useViewMode();
  const membroResponsavel = view.isAdmin ? memberId : view.myMemberId;

  const [filtroMembro, setFiltroMembro] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroPagamento, setFiltroPagamento] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroMes, setFiltroMes] = useState("");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const total = purchaseTotal(items);

  const escopo = view.scoped(filtroMembro);
  const porEscopo = filterByMember(purchases ?? [], escopo).filter(
    (p) =>
      (!filtroPagamento || p.forma_pagamento === filtroPagamento) &&
      (!filtroTipo || p.tipo_compra === filtroTipo) &&
      (!filtroMes || p.data_compra.slice(0, 7) === filtroMes),
  );
  const itemCategorias = usePurchaseItemCategories(porEscopo.map((p) => p.id));
  const lista = filtroCategoria
    ? porEscopo.filter((p) =>
        (itemCategorias.data ?? []).some(
          (i) => i.purchase_id === p.id && i.categoria_id === filtroCategoria,
        ),
      )
    : porEscopo;
  const compraDetalhe = lista.find((p) => p.id === detalhe) ?? null;
  const totalListado = lista.reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

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
    setItems([{ ...emptyItem }]);
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
        },
        items: items.filter((i) => i.descricao_produto.trim() !== ""),
      }),
    onSuccess: () => {
      toast.success("Compra registrada.");
      reset();
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["purchases", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: deletePurchase,
    onSuccess: () => {
      toast.success("Compra excluída.");
      queryClient.invalidateQueries({ queryKey: ["purchases", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
          onManual={() => {
            setShowForm(true);
            setShowOptions(false);
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
        <h2 className="text-base font-bold">Filtros</h2>
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

      <DocumentosSection
        familyId={family.id}
        memberId={view.myMemberId}
        createdBy={user?.id}
        podeLancar={view.podeLancar}
        escopo={escopo}
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
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma compra encontrada com os filtros atuais. Toda movimentação financeira começa por
            uma compra — registre a primeira.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {lista.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                    className="flex min-w-52 flex-1 items-center gap-2 text-left"
                    aria-expanded={expanded === p.id}
                  >
                    {expanded === p.id ? (
                      <ChevronUp className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                    <span>
                      <span className="block text-sm font-semibold">{p.estabelecimento}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(p.data_compra)} · {memberName(p.member_id)} ·{" "}
                        {PAYMENT_METHOD_LABELS[p.forma_pagamento]} ·{" "}
                        {PURCHASE_TYPE_LABELS[p.tipo_compra]}
                      </span>
                    </span>
                  </button>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${PAYMENT_STATUS_CLASSES[p.status_pagamento]}`}
                  >
                    {PAYMENT_STATUS_LABELS[p.status_pagamento]}
                  </span>
                  <span className="text-sm font-bold">{formatCurrency(Number(p.valor_total))}</span>
                  {view.podeLancar && (
                    <button
                      aria-label={`Excluir compra em ${p.estabelecimento}`}
                      onClick={() => remove.mutate(p.id)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {expanded === p.id && <PurchaseItems purchaseId={p.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PurchaseItems({ purchaseId }: { purchaseId: string }) {
  const { data: items, isLoading } = usePurchaseItems(purchaseId);

  if (isLoading) return <p className="mt-3 text-xs text-muted-foreground">Carregando itens...</p>;
  if ((items ?? []).length === 0)
    return <p className="mt-3 text-xs text-muted-foreground">Nenhum produto registrado.</p>;

  return (
    <ul className="mt-3 space-y-1.5 rounded-2xl bg-muted/50 p-4">
      {(items ?? []).map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium">{i.descricao_produto}</span>
          <span className="text-muted-foreground">
            {Number(i.quantidade)} {i.unidade} × {formatCurrency(Number(i.valor_unitario))} ={" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(Number(i.valor_total))}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
