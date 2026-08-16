import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, PencilLine, Plus, QrCode, Trash2, Upload } from "lucide-react";
import { Card, Field, PrimaryButton, inputClass } from "@/components/page-header";
import { MemberSelect } from "@/components/member-select";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useDocumentExtraction, useExtractionItems } from "@/hooks/useDocuments";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { filterByMember } from "@/components/member-filter";
import { formatCurrency } from "@/lib/finance";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/expenses";
import { UNIDADES, usesBankAccount, type NewPurchaseItem } from "@/lib/purchases";
import { suggestCategoryId } from "@/lib/category-suggest";
import {
  confirmDocumentPurchase,
  discardDocument,
  processDocumentPdf,
  purgeDocumentFile,
  uploadDocument,
  type FinancialDocument,
} from "@/lib/documents";
import type { Confianca } from "@/lib/pdf-extract";

const ACEITA = "image/jpeg,image/jpg,image/png,image/webp,application/pdf";

const FORMAS_REVISAO: PaymentMethod[] = ["PIX", "DINHEIRO", "CREDITO", "DEBITO", "BOLETO"];

const linhaVazia = (): NewPurchaseItem => ({
  product_id: "",
  descricao_produto: "",
  quantidade: "1",
  unidade: "UN",
  valor_unitario: "",
  categoria_id: "",
  categoria_sugerida: "",
});

/** Destaque discreto usado apenas em campos com leitura duvidosa. */
function AvisoCampo({ texto }: { texto: string }) {
  return <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">{texto}</p>;
}

type Origem = "manual" | "nota" | "qrcode";

/**
 * Nova compra: manual, envio de nota (foto ou arquivo) e QR Code.
 * A nota é apenas fonte temporária — vira compra e o arquivo é apagado.
 */
export function NovaCompraOptions({
  familyId,
  memberId,
  createdBy,
  podeLancar,
  onManual,
  onConfirmed,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  podeLancar: boolean;
  onManual: () => void;
  onConfirmed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [doc, setDoc] = useState<FinancialDocument | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const enviar = useMutation({
    mutationFn: async (arquivo: File) => {
      const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
      const novo = await uploadDocument({
        familyId,
        memberId: memberId || null,
        createdBy: createdBy ?? null,
        file: arquivo,
        tipo: ehPdf ? "PDF_FATURA" : "NOTA_FISCAL",
      });
      if (ehPdf) {
        try {
          await processDocumentPdf({ doc: novo, file: arquivo });
        } catch {
          /* segue para revisão manual */
        }
      }
      return novo;
    },
    onSuccess: (novo) => {
      setDoc(novo);
      void queryClient.invalidateQueries({ queryKey: ["document-extraction"] });
      void queryClient.invalidateQueries({ queryKey: ["document-extraction-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const option = (key: Origem, icon: React.ReactNode, titulo: string, texto: string, breve = false) => (
    <button
      key={key}
      type="button"
      onClick={() => (key === "manual" ? onManual() : setOrigem(origem === key ? null : key))}
      className={`flex flex-1 items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        origem === key ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
      }`}
    >
      <span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span>
      <span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          {titulo}
          {breve && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              Em breve
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{texto}</span>
      </span>
    </button>
  );

  if (doc) {
    return (
      <ConferirCompra
        key={doc.id}
        familyId={familyId}
        memberId={memberId}
        createdBy={createdBy}
        doc={doc}
        onClose={() => setDoc(null)}
        onConfirmed={() => {
          setDoc(null);
          setOrigem(null);
          onConfirmed?.();
        }}
      />
    );
  }

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
        {option("nota", <Camera className="size-5" />, "Enviar nota", "Foto ou arquivo da nota, lido automaticamente.")}
        {option(
          "qrcode",
          <QrCode className="size-5" />,
          "Ler QR Code",
          "Leitura do QR Code da NFC-e direto do cupom.",
          true,
        )}
      </div>

      {origem === "nota" &&
        (podeLancar ? (
          <div className="mt-4 rounded-2xl border border-border p-4">
            {enviar.isPending ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Loader2 className="size-4 animate-spin" />
                Lendo sua compra...
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Tire uma foto ou envie o arquivo da nota. Nós lemos os dados, você confere e a compra
                  é criada — o arquivo original é apagado em seguida.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Camera className="size-4" />
                    Tirar foto da nota
                  </button>
                  <button
                    type="button"
                    onClick={() => arquivoRef.current?.click()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
                  >
                    <Upload className="size-4" />
                    Enviar arquivo
                  </button>
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) enviar.mutate(f);
                  }}
                />
                <input
                  ref={arquivoRef}
                  type="file"
                  accept={ACEITA}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) enviar.mutate(f);
                  }}
                />
              </>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
            Seu perfil é somente leitura, então o envio de notas fica desabilitado.
          </p>
        ))}

      {origem === "qrcode" && (
        <p className="mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
          A leitura do QR Code da NFC-e será ligada em uma próxima etapa.
        </p>
      )}
    </Card>
  );
}

/** Conferência rápida: o usuário valida o que foi lido e confirma em um clique. */
function ConferirCompra({
  familyId,
  memberId,
  createdBy,
  doc,
  onClose,
  onConfirmed,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  doc: FinancialDocument;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { data: extracao } = useDocumentExtraction(doc.id);
  const { data: itensPdf } = useExtractionItems(extracao?.id);
  const { data: cards } = useCreditCards(familyId);
  const { data: contas } = useBankAccounts(familyId);
  const { data: categorias } = useExpenseCategories();

  const [responsavel, setResponsavel] = useState(doc.member_id ?? memberId);
  const [estabelecimento, setEstabelecimento] = useState("");
  const [dataCompra, setDataCompra] = useState(doc.created_at.slice(0, 10));
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod | "">("");
  const [cartaoId, setCartaoId] = useState("");
  const [contaId, setContaId] = useState("");
  const [items, setItems] = useState<NewPurchaseItem[]>([linhaVazia()]);

  const brutos = (extracao?.dados_brutos_json ?? null) as {
    confianca?: {
      estabelecimento?: Confianca;
      data_compra?: Confianca;
      valor_total?: Confianca;
      forma_pagamento?: Confianca;
      items?: Confianca;
    };
    pagamento_descricao?: string | null;
    tipo_documento_detectado?: { codigo?: string; confianca?: number; seguro?: boolean } | null;
  } | null;
  const confianca = brutos?.confianca ?? {};
  const tipoDetectado = brutos?.tipo_documento_detectado ?? null;
  const valorLido = Number(extracao?.valor_total ?? 0);
  const duvidoso = (nivel?: Confianca) => nivel === "BAIXA" || nivel === "MEDIA";

  const produtosLidos = useMemo<NewPurchaseItem[]>(() => {
    const lista = categorias ?? [];
    return (itensPdf ?? []).map((i) => {
      const sugerida = i.categoria_sugerida ?? suggestCategoryId(i.descricao_produto, lista) ?? "";
      return {
        product_id: "",
        descricao_produto: i.descricao_produto,
        quantidade: String(Number(i.quantidade) || 1),
        unidade: i.unidade || "UN",
        valor_unitario: String(Number(i.valor_unitario) || 0),
        categoria_id: sugerida,
        categoria_sugerida: sugerida,
      };
    });
  }, [itensPdf, categorias]);

  useEffect(() => {
    if (!extracao) return;
    if (extracao.estabelecimento) setEstabelecimento((v) => v || extracao.estabelecimento!);
    if (extracao.data_compra) setDataCompra(extracao.data_compra);
    if (extracao.member_id) setResponsavel((v) => v || extracao.member_id!);
    if (extracao.forma_pagamento && FORMAS_REVISAO.includes(extracao.forma_pagamento)) {
      setFormaPagamento(extracao.forma_pagamento);
    }
  }, [extracao]);

  useEffect(() => {
    if (produtosLidos.length > 0) {
      setItems(produtosLidos);
      return;
    }
    if (extracao && valorLido > 0) {
      setItems((prev) => {
        const vazio = prev.every((i) => i.descricao_produto.trim() === "" && !i.valor_unitario);
        if (!vazio) return prev;
        return [
          {
            ...linhaVazia(),
            descricao_produto: extracao.estabelecimento
              ? `Compra em ${extracao.estabelecimento}`
              : "Compra",
            valor_unitario: String(valorLido),
          },
        ];
      });
    }
  }, [produtosLidos, extracao, valorLido]);

  const somaProdutos = items.reduce(
    (acc, i) => acc + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0),
    0,
  );
  const total = somaProdutos > 0 ? somaProdutos : valorLido;
  const divergente = valorLido > 0 && somaProdutos > 0 && Math.abs(somaProdutos - valorLido) >= 0.02;

  const confirmar = useMutation({
    mutationFn: async () => {
      const purchase = await confirmDocumentPurchase({
        documentId: doc.id,
        purchase: {
          family_id: familyId,
          member_id: responsavel || null,
          created_by: createdBy ?? null,
          estabelecimento: estabelecimento.trim(),
          data_compra: dataCompra,
          tipo_compra: "COMPRA_NORMAL",
          forma_pagamento: (formaPagamento || "PIX") as PaymentMethod,
          credit_card_id: formaPagamento === "CREDITO" ? cartaoId || null : null,
          bank_account_id: formaPagamento && usesBankAccount(formaPagamento) ? contaId || null : null,
        },
        items,
        cards: cards ?? [],
      });
      // Compra criada com sucesso: o arquivo original não é mais necessário.
      await purgeDocumentFile(doc);
      return purchase;
    },
    onSuccess: () => {
      toast.success("Compra criada. A nota original foi descartada.");
      onConfirmed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: () => discardDocument(doc),
    onSuccess: () => {
      toast.success("Envio cancelado e arquivo removido.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setItem = (index: number, patch: Partial<NewPurchaseItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <Card>
      <h2 className="text-base font-bold">Confira sua compra</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {extracao
          ? "Lemos os dados da nota. Confira rapidamente e confirme."
          : "Não conseguimos ler esta nota automaticamente. Preencha os dados abaixo para criar a compra."}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Estabelecimento">
          <input
            value={estabelecimento}
            onChange={(e) => setEstabelecimento(e.target.value)}
            placeholder="Ex.: Mercado Silva"
            className={inputClass}
          />
          {extracao && (!extracao.estabelecimento || duvidoso(confianca.estabelecimento)) && (
            <AvisoCampo texto="Confirme o estabelecimento." />
          )}
        </Field>
        <Field label="Data">
          <input
            type="date"
            value={dataCompra}
            onChange={(e) => setDataCompra(e.target.value)}
            className={inputClass}
          />
          {extracao && (!extracao.data_compra || duvidoso(confianca.data_compra)) && (
            <AvisoCampo texto="Confirme a data da compra." />
          )}
        </Field>
        <MemberSelect familyId={familyId} value={responsavel} onChange={setResponsavel} />
        <Field label="Forma de pagamento">
          <select
            value={formaPagamento}
            onChange={(e) => setFormaPagamento(e.target.value as PaymentMethod | "")}
            className={inputClass}
          >
            <option value="">Selecione</option>
            {FORMAS_REVISAO.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {extracao && (!extracao.forma_pagamento || duvidoso(confianca.forma_pagamento)) && (
            <AvisoCampo texto="Confirme como você pagou." />
          )}
        </Field>
        {formaPagamento === "CREDITO" ? (
          <Field label="Cartão">
            <select value={cartaoId} onChange={(e) => setCartaoId(e.target.value)} className={inputClass}>
              <option value="">Selecione</option>
              {filterByMember(cards ?? [], responsavel).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome_cartao} · {c.banco}
                </option>
              ))}
            </select>
          </Field>
        ) : formaPagamento && usesBankAccount(formaPagamento) ? (
          <Field label="Conta bancária">
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} className={inputClass}>
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

      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-bold">Produtos</h3>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, linhaVazia()])}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" />
          Adicionar produto
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-6"
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
            <Field label="Categoria">
              <select
                value={item.categoria_id}
                onChange={(e) =>
                  setItem(index, {
                    categoria_id: e.target.value,
                    categoria_sugerida:
                      item.categoria_sugerida ??
                      suggestCategoryId(item.descricao_produto, categorias ?? []) ??
                      "",
                  })
                }
                className={inputClass}
              >
                <option value="">Selecione uma categoria</option>
                {(categorias ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
              {item.categoria_id === "" && (
                <AvisoCampo texto="Não conseguimos identificar a categoria deste produto." />
              )}
            </Field>
            <div className="flex items-end justify-between gap-2">
              <p className="text-sm font-semibold">
                {formatCurrency((Number(item.quantidade) || 0) * (Number(item.valor_unitario) || 0))}
              </p>
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

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm text-muted-foreground">
          <p>
            Valor total:{" "}
            <span className="text-lg font-extrabold text-foreground">{formatCurrency(total)}</span>
          </p>
          {divergente && (
            <AvisoCampo
              texto={`Confirme este valor: produtos somam ${formatCurrency(somaProdutos)} e a nota indica ${formatCurrency(valorLido)}.`}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={cancelar.isPending}
            onClick={() => cancelar.mutate()}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-60"
          >
            {cancelar.isPending ? "Cancelando..." : "Cancelar"}
          </button>
          <PrimaryButton
            type="button"
            disabled={confirmar.isPending}
            onClick={() => {
              if (!estabelecimento.trim()) {
                toast.error("Informe o estabelecimento.");
                return;
              }
              if (!responsavel) {
                toast.error("Selecione o responsável pela compra.");
                return;
              }
              if (items.every((i) => i.descricao_produto.trim() === "")) {
                toast.error("Informe ao menos um produto.");
                return;
              }
              if (total <= 0) {
                toast.error("O valor total precisa ser maior que zero.");
                return;
              }
              if (!formaPagamento) {
                toast.error("Selecione a forma de pagamento.");
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
              confirmar.mutate();
            }}
          >
            {confirmar.isPending ? "Confirmando..." : "Confirmar tudo"}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}
