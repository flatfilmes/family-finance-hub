import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, FileText, PencilLine, QrCode, Trash2 } from "lucide-react";
import { Card, Field, PrimaryButton, inputClass } from "@/components/page-header";
import { useMemberName } from "@/components/member-select";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useDocuments, useImportItems, usePurchaseImports } from "@/hooks/useDocuments";
import { filterByMember } from "@/components/member-filter";
import { formatCurrency } from "@/lib/finance";
import { PAYMENT_METHOD_LABELS, formatDate, type PaymentMethod } from "@/lib/expenses";
import { UNIDADES, usesBankAccount, type NewPurchaseItem } from "@/lib/purchases";
import {
  DOCUMENT_STATUS_CLASSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  confirmImport,
  deleteDocument,
  rejectImport,
  type PurchaseImport,
} from "@/lib/documents";

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

type Origem = "manual" | "nota" | "qrcode";

/** Escolha da origem da compra: manual hoje, nota fiscal e QR Code preparados para o futuro. */
export function NovaCompraOptions({ onManual }: { onManual: () => void }) {
  const [origem, setOrigem] = useState<Origem | null>(null);

  const option = (key: Origem, icon: React.ReactNode, titulo: string, texto: string) => (
    <button
      key={key}
      type="button"
      onClick={() => (key === "manual" ? onManual() : setOrigem(key))}
      className={`flex flex-1 items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        origem === key ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
      }`}
    >
      <span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span>
      <span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          {titulo}
          {key !== "manual" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              Em breve
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{texto}</span>
      </span>
    </button>
  );

  return (
    <Card>
      <h2 className="text-base font-bold">Como você quer registrar a compra?</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {option(
          "manual",
          <PencilLine className="size-5" />,
          "Cadastrar manualmente",
          "Preencher estabelecimento, pagamento e produtos.",
        )}
        {option(
          "nota",
          <Camera className="size-5" />,
          "Enviar nota fiscal",
          "Foto ou PDF da nota vira uma compra detalhada.",
        )}
        {option(
          "qrcode",
          <QrCode className="size-5" />,
          "Ler QR Code",
          "Leitura do QR Code da NFC-e direto do cupom.",
        )}
      </div>
      {origem && origem !== "manual" && (
        <p className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
          A estrutura de captura já está pronta: documentos enviados ficam guardados, os produtos
          extraídos passam por uma tela de conferência e só viram compra depois da sua confirmação.
          A leitura automática {origem === "nota" ? "da nota fiscal" : "do QR Code NFC-e"} será
          ligada em uma próxima etapa.
        </p>
      )}
    </Card>
  );
}

/** Documentos enviados e rascunhos aguardando confirmação. */
export function DocumentosSection({
  familyId,
  memberId,
  createdBy,
  podeLancar,
  escopo,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  podeLancar: boolean;
  escopo: string;
}) {
  const queryClient = useQueryClient();
  const { data: documents, isLoading } = useDocuments(familyId);
  const { data: imports } = usePurchaseImports(familyId);
  const memberName = useMemberName(familyId);
  const [revisando, setRevisando] = useState<PurchaseImport | null>(null);

  const docs = filterByMember(documents ?? [], escopo);
  const drafts = filterByMember(imports ?? [], escopo);
  const pendentes = drafts.filter((i) => i.status === "PENDENTE_APROVACAO");
  const importadas = drafts.filter((i) => i.status === "APROVADO");

  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      toast.success("Documento removido.");
      void queryClient.invalidateQueries({ queryKey: ["documents", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: rejectImport,
    onSuccess: () => {
      toast.success("Importação descartada.");
      setRevisando(null);
      void queryClient.invalidateQueries({ queryKey: ["purchase-imports", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Card className="mt-4">
        <h2 className="text-base font-bold">Documentos pendentes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Notas, cupons e comprovantes enviados que ainda não viraram compra.
        </p>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : docs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhum documento enviado ainda. Quando o envio de notas e a leitura de QR Code forem
            ligados, eles aparecem aqui aguardando confirmação.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {docs.map((d) => {
              const draft = pendentes.find((i) => i.document_id === d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-48 flex-1">
                    <span className="block text-sm font-semibold">
                      {d.nome_arquivo || DOCUMENT_TYPE_LABELS[d.tipo_documento]}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {DOCUMENT_TYPE_LABELS[d.tipo_documento]} · {memberName(d.member_id)} ·{" "}
                      {formatDate(d.created_at.slice(0, 10))}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${DOCUMENT_STATUS_CLASSES[d.status]}`}
                  >
                    {DOCUMENT_STATUS_LABELS[d.status]}
                  </span>
                  {draft && podeLancar && (
                    <button
                      type="button"
                      onClick={() => setRevisando(draft)}
                      className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Confira sua compra
                    </button>
                  )}
                  {podeLancar && (
                    <button
                      type="button"
                      aria-label="Remover documento"
                      onClick={() => remove.mutate(d.id)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {revisando && (
        <ConfiraSuaCompra
          familyId={familyId}
          memberId={memberId}
          createdBy={createdBy}
          draft={revisando}
          onClose={() => setRevisando(null)}
          onReject={() => reject.mutate(revisando.id)}
        />
      )}

      {importadas.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-base font-bold">Compras importadas</h2>
          <ul className="mt-3 divide-y divide-border">
            {importadas.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-sm font-semibold">{i.estabelecimento}</span>
                <span className="text-xs text-muted-foreground">
                  {i.data_compra ? formatDate(i.data_compra) : "Sem data"} ·{" "}
                  {formatCurrency(Number(i.valor_total))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Tela de conferência: dados extraídos podem ser editados antes de virar compra oficial. */
function ConfiraSuaCompra({
  familyId,
  memberId,
  createdBy,
  draft,
  onClose,
  onReject,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  draft: PurchaseImport;
  onClose: () => void;
  onReject: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: itensExtraidos, isLoading } = useImportItems(draft.id);
  const { data: cards } = useCreditCards(familyId);
  const { data: contas } = useBankAccounts(familyId);

  const [estabelecimento, setEstabelecimento] = useState(draft.estabelecimento);
  const [dataCompra, setDataCompra] = useState(
    draft.data_compra ?? new Date().toISOString().slice(0, 10),
  );
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>("PIX");
  const [cartaoId, setCartaoId] = useState("");
  const [contaId, setContaId] = useState("");
  const [items, setItems] = useState<NewPurchaseItem[]>([]);

  useEffect(() => {
    setItems(
      (itensExtraidos ?? []).map((i) => ({
        product_id: "",
        descricao_produto: i.descricao_produto,
        quantidade: String(Number(i.quantidade)),
        unidade: i.unidade,
        valor_unitario: String(Number(i.valor_unitario)),
        categoria_id: i.categoria_sugerida ?? "",
      })),
    );
  }, [itensExtraidos]);

  const responsavel = draft.member_id ?? memberId;
  const total = items.reduce(
    (acc, i) => acc + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0),
    0,
  );

  const confirm = useMutation({
    mutationFn: () =>
      confirmImport({
        importId: draft.id,
        documentId: draft.document_id,
        purchase: {
          family_id: familyId,
          member_id: responsavel || null,
          created_by: createdBy ?? null,
          estabelecimento: estabelecimento.trim(),
          data_compra: dataCompra,
          tipo_compra: "COMPRA_NORMAL",
          forma_pagamento: formaPagamento,
          credit_card_id: formaPagamento === "CREDITO" ? cartaoId || null : null,
          bank_account_id: usesBankAccount(formaPagamento) ? contaId || null : null,
        },
        items,
      }),
    onSuccess: () => {
      toast.success("Compra confirmada a partir do documento.");
      onClose();
      for (const key of ["purchases", "documents", "purchase-imports", "bank-accounts"]) {
        void queryClient.invalidateQueries({ queryKey: [key, familyId] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setItem = (index: number, patch: Partial<NewPurchaseItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <Card className="mt-4">
      <h2 className="text-base font-bold">Confira sua compra</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Confirme os dados encontrados no documento. Você pode editar antes de salvar.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Estabelecimento">
          <input
            value={estabelecimento}
            onChange={(e) => setEstabelecimento(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Data">
          <input
            type="date"
            value={dataCompra}
            onChange={(e) => setDataCompra(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Forma de pagamento">
          <select
            value={formaPagamento}
            onChange={(e) => setFormaPagamento(e.target.value as PaymentMethod)}
            className={inputClass}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        {formaPagamento === "CREDITO" ? (
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
        ) : usesBankAccount(formaPagamento) ? (
          <Field label="Conta bancária">
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecione</option>
              {filterByMember(contas ?? [], responsavel)
                .filter((c) => c.ativo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.banco} · {c.nome_conta}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
      </div>

      <h3 className="mt-5 text-sm font-bold">Produtos encontrados</h3>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Carregando produtos...</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhum produto foi extraído deste documento.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <Field label="Produto">
                <input
                  value={item.descricao_produto}
                  onChange={(e) => setItem(index, { descricao_produto: e.target.value })}
                  className={inputClass}
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
                />
              </Field>
              <div className="flex items-end">
                <p className="text-sm font-semibold">
                  {formatCurrency(
                    (Number(item.quantidade) || 0) * (Number(item.valor_unitario) || 0),
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          Valor total:{" "}
          <span className="text-lg font-extrabold text-foreground">{formatCurrency(total)}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onReject}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Fechar
          </button>
          <PrimaryButton
            type="button"
            disabled={confirm.isPending}
            onClick={() => {
              if (!estabelecimento.trim()) {
                toast.error("Informe o estabelecimento.");
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
              confirm.mutate();
            }}
          >
            {confirm.isPending ? "Confirmando..." : "Confirmar compra"}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}
