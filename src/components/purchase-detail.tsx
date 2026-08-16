import { X } from "lucide-react";
import { useMemberName } from "@/components/member-select";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useExpenseCategories } from "@/hooks/useExpenses";
import {
  usePurchaseInstallments,
  usePurchaseItems,
  useUpdatePurchaseItemCategory,
} from "@/hooks/usePurchases";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/lib/finance";
import { PAYMENT_METHOD_LABELS, PURCHASE_TYPE_LABELS, formatDate } from "@/lib/expenses";
import {
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
  isRecorrente,
  proximaCobranca,
  type Purchase,
} from "@/lib/purchases";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Detalhe completo de uma compra: dados gerais, pagamento, produtos, parcelas e recorrência. */
export function PurchaseDetail({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const memberName = useMemberName(purchase.family_id);
  const { data: cards } = useCreditCards(purchase.family_id);
  const { data: contas } = useBankAccounts(purchase.family_id);
  const { data: categorias } = useExpenseCategories();
  const { data: items, isLoading: loadingItems } = usePurchaseItems(purchase.id);
  const { data: parcelas } = usePurchaseInstallments(purchase.id);
  const permissoes = usePermissions();
  const atualizarCategoria = useUpdatePurchaseItemCategory(purchase.id);
  const podeEditarCategoria =
    permissoes.isAdmin ||
    (permissoes.podeLancar && purchase.member_id === permissoes.myMemberId);

  const cartao = (cards ?? []).find((c) => c.id === purchase.credit_card_id);
  const conta = (contas ?? []).find((c) => c.id === purchase.bank_account_id);
  const categoriaNome = (id: string | null) =>
    (categorias ?? []).find((c) => c.id === id)?.nome ?? "Sem categoria";

  const listaParcelas = parcelas ?? [];
  const pagas = listaParcelas.filter((p) => p.status === "PAGO").length;
  const proximas = listaParcelas.filter((p) => p.status !== "PAGO").slice(0, 6);
  const recorrente = isRecorrente(purchase.tipo_compra);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalhes da compra em ${purchase.estabelecimento}`}
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl space-y-4 rounded-3xl bg-card p-6 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">{purchase.estabelecimento}</h2>
            <p className="text-sm text-muted-foreground">
              {formatDate(purchase.data_compra)} · {PURCHASE_TYPE_LABELS[purchase.tipo_compra]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <Section title="Informações gerais">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Estabelecimento" value={purchase.estabelecimento} />
            <Info label="Responsável" value={memberName(purchase.member_id)} />
            <Info label="Data" value={formatDate(purchase.data_compra)} />
            <Info label="Valor total" value={formatCurrency(Number(purchase.valor_total))} />
            <Info label="Tipo de compra" value={PURCHASE_TYPE_LABELS[purchase.tipo_compra]} />
            {purchase.observacao && <Info label="Observação" value={purchase.observacao} />}
          </div>
        </Section>

        <Section title="Pagamento">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info
              label="Forma de pagamento"
              value={PAYMENT_METHOD_LABELS[purchase.forma_pagamento]}
            />
            <Info
              label="Conta bancária"
              value={conta ? `${conta.banco} · ${conta.nome_conta}` : "—"}
            />
            <Info label="Cartão" value={cartao ? `${cartao.nome_cartao} · ${cartao.banco}` : "—"} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status financeiro
              </p>
              <span
                className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${PAYMENT_STATUS_CLASSES[purchase.status_pagamento]}`}
              >
                {PAYMENT_STATUS_LABELS[purchase.status_pagamento]}
              </span>
            </div>
          </div>
        </Section>

        <Section title="Produtos">
          {loadingItems ? (
            <p className="text-sm text-muted-foreground">Carregando produtos...</p>
          ) : (items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto detalhado nesta compra.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Produto</th>
                    <th className="pb-2 pr-3 font-medium">Qtd.</th>
                    <th className="pb-2 pr-3 font-medium">Un.</th>
                    <th className="pb-2 pr-3 font-medium">Valor unit.</th>
                    <th className="pb-2 pr-3 font-medium">Total</th>
                    <th className="pb-2 font-medium">Categoria</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(items ?? []).map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-3 font-medium">{i.descricao_produto}</td>
                      <td className="py-2 pr-3">{Number(i.quantidade)}</td>
                      <td className="py-2 pr-3">{i.unidade}</td>
                      <td className="py-2 pr-3">{formatCurrency(Number(i.valor_unitario))}</td>
                      <td className="py-2 pr-3 font-semibold">
                        {formatCurrency(Number(i.valor_total))}
                      </td>
                      <td className="py-2">
                        {podeEditarCategoria ? (
                          <select
                            aria-label={`Categoria de ${i.descricao_produto}`}
                            value={i.categoria_id ?? ""}
                            disabled={atualizarCategoria.isPending}
                            onChange={(e) =>
                              atualizarCategoria.mutate({
                                itemId: i.id,
                                categoriaId: e.target.value || null,
                                categoriaSugerida: i.categoria_sugerida ?? null,
                              })
                            }
                            className="w-44 rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          >
                            <option value="">Sem categoria</option>
                            {(categorias ?? []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nome}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-muted-foreground">
                            {categoriaNome(i.categoria_id)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {listaParcelas.length > 0 && (
          <Section title="Parcelamento">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Valor total" value={formatCurrency(Number(purchase.valor_total))} />
              <Info label="Quantidade de parcelas" value={`${listaParcelas.length}x`} />
              <Info
                label="Parcela atual"
                value={`${Math.min(pagas + 1, listaParcelas.length)} de ${listaParcelas.length}`}
              />
              <Info
                label="Valor da parcela"
                value={formatCurrency(Number(listaParcelas[0]?.valor_parcela ?? 0))}
              />
            </div>
            {proximas.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Próximas parcelas
                </p>
                <ul className="mt-2 divide-y divide-border">
                  {proximas.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        Parcela {p.numero_parcela}/{p.total_parcelas} ·{" "}
                        <span className="text-muted-foreground">
                          vence em {formatDate(p.data_vencimento)}
                        </span>
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(Number(p.valor_parcela))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        {recorrente && (
          <Section title="Compra recorrente">
            <div className="grid gap-4 sm:grid-cols-3">
              <Info label="Valor mensal" value={formatCurrency(Number(purchase.valor_total))} />
              <Info
                label="Próxima cobrança"
                value={formatDate(proximaCobranca(purchase.data_compra))}
              />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <span className="mt-1 inline-block rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  Ativa
                </span>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
