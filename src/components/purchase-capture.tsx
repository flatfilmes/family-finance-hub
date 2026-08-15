import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Eye, FileText, ImagePlus, PencilLine, Plus, QrCode, Trash2, Upload } from "lucide-react";
import { Card, Field, PrimaryButton, inputClass } from "@/components/page-header";
import { MemberSelect, useMemberName } from "@/components/member-select";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useDocuments, useImportItems, usePurchaseImports } from "@/hooks/useDocuments";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { usePurchases } from "@/hooks/usePurchases";
import { filterByMember } from "@/components/member-filter";
import { formatCurrency } from "@/lib/finance";
import { PAYMENT_METHOD_LABELS, formatDate, type PaymentMethod } from "@/lib/expenses";
import { UNIDADES, usesBankAccount, type NewPurchaseItem } from "@/lib/purchases";
import {
  DOCUMENT_STATUS_CLASSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  confirmDocumentPurchase,
  deleteDocument,
  getDocumentUrl,
  processDocumentPdf,
  rejectDocument,
  uploadDocument,
  type DocumentType,
  type DocumentExtraction,
  type FinancialDocument,
  type PurchaseImport,
} from "@/lib/documents";

type Origem = "manual" | "nota" | "qrcode";

type ModoEnvio = "camera" | "imagem" | "pdf";

const MODOS: Record<ModoEnvio, { titulo: string; accept: string; capture: boolean; tipo: DocumentType }> = {
  camera: { titulo: "Tirar foto da nota", accept: "image/*", capture: true, tipo: "NOTA_FISCAL" },
  imagem: { titulo: "Enviar imagem", accept: "image/*", capture: false, tipo: "NOTA_FISCAL" },
  pdf: { titulo: "Enviar PDF", accept: "application/pdf", capture: false, tipo: "PDF_FATURA" },
};

/** Escolha da origem da compra: manual, envio de nota fiscal e QR Code (futuro). */
export function NovaCompraOptions({
  familyId,
  memberId,
  createdBy,
  podeLancar,
  onManual,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  podeLancar: boolean;
  onManual: () => void;
}) {
  const [origem, setOrigem] = useState<Origem | null>(null);

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
          "Foto ou PDF da nota guardado para conferência.",
        )}
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
          <EnvioNotaFiscal familyId={familyId} memberId={memberId} createdBy={createdBy} />
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

/** Upload da nota: foto, imagem ou PDF. Sem leitura automática nesta versão. */
function EnvioNotaFiscal({
  familyId,
  memberId,
  createdBy,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<ModoEnvio>("imagem");
  const [file, setFile] = useState<File | null>(null);

  const enviar = useMutation({
    mutationFn: async () => {
      const arquivo = file!;
      const doc = await uploadDocument({
        familyId,
        memberId: memberId || null,
        createdBy: createdBy ?? null,
        file: arquivo,
        tipo: MODOS[modo].tipo,
      });
      const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
      if (!ehPdf) return { doc, lido: false };
      try {
        await processDocumentPdf({ doc, file: arquivo });
        return { doc, lido: true };
      } catch {
        return { doc, lido: false, erro: true };
      }
    },
    onSuccess: (r) => {
      toast.success(
        r.lido
          ? "PDF lido. Confira a sugestão de compra em “Notas pendentes”."
          : r.erro
            ? "Nota enviada, mas não foi possível ler o PDF. Revise manualmente."
            : "Nota enviada. Ela ficará em “Notas pendentes” aguardando revisão.",
      );
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["documents", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const icone: Record<ModoEnvio, React.ReactNode> = {
    camera: <Camera className="size-4" />,
    imagem: <ImagePlus className="size-4" />,
    pdf: <FileText className="size-4" />,
  };

  return (
    <div className="mt-4 rounded-2xl border border-border p-4">
      <p className="text-sm font-bold">Enviar nota fiscal</p>
      <p className="mt-1 text-xs text-muted-foreground">
        O arquivo fica guardado com segurança na pasta da família. Em PDF, o sistema já lê
        estabelecimento, data, valor e produtos e monta uma sugestão de compra para você conferir.
      </p>


      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(MODOS) as ModoEnvio[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setModo(m);
              setFile(null);
            }}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
              modo === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {icone[m]}
            {MODOS[m].titulo}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Arquivo">
          <input
            key={modo}
            type="file"
            accept={MODOS[modo].accept}
            {...(MODOS[modo].capture ? { capture: "environment" as const } : {})}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={inputClass}
          />
        </Field>
        <PrimaryButton
          type="button"
          disabled={!file || enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          <Upload className="size-4" />
          {enviar.isPending ? "Enviando..." : "Enviar nota fiscal"}
        </PrimaryButton>
      </div>
    </div>
  );
}
const FORMAS_REVISAO: PaymentMethod[] = ["PIX", "DINHEIRO", "CREDITO", "DEBITO", "BOLETO"];

const linhaVazia = (): NewPurchaseItem => ({
  product_id: "",
  descricao_produto: "",
  quantidade: "1",
  unidade: "UN",
  valor_unitario: "",
  categoria_id: "",
});

/** Fila de revisão e histórico dos documentos enviados. */
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
  const { data: purchases } = usePurchases(familyId);
  const memberName = useMemberName(familyId);
  const [revisando, setRevisando] = useState<FinancialDocument | null>(null);

  const docs = filterByMember(documents ?? [], escopo);
  const drafts = filterByMember(imports ?? [], escopo);
  const pendentes = docs.filter(
    (d) =>
      d.status === "ENVIADO" ||
      d.status === "PROCESSADO" ||
      d.status === "PROCESSANDO" ||
      d.status === "ERRO",
  );
  const processados = docs.filter((d) => d.status === "CONFIRMADO" || d.status === "REJEITADO");

  const invalidar = () => {
    for (const key of ["documents", "purchase-imports", "purchases", "bank-accounts", "expenses"]) {
      void queryClient.invalidateQueries({ queryKey: [key, familyId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["document-extraction"] });
    void queryClient.invalidateQueries({ queryKey: ["document-extraction-items"] });
  };

  const remove = useMutation({
    mutationFn: (doc: { id: string; url_arquivo: string | null }) => deleteDocument(doc),
    onSuccess: () => {
      toast.success("Documento removido.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reprocessar = useMutation({
    mutationFn: (doc: FinancialDocument) => processDocumentPdf({ doc }),
    onSuccess: () => {
      toast.success("PDF lido novamente.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejeitar = useMutation({
    mutationFn: rejectDocument,
    onSuccess: () => {
      toast.success("Documento rejeitado.");
      setRevisando(null);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const abrirArquivo = async (path: string) => {
    try {
      const url = await getDocumentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir.");
    }
  };

  return (
    <>
      <Card className="mt-4">
        <h2 className="text-base font-bold">Notas pendentes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Documentos enviados que ainda não viraram compra. Revise para confirmar.
        </p>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : pendentes.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma nota aguardando revisão. Use “Enviar nota fiscal” em “+ Nova compra”.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {pendentes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="size-4 text-muted-foreground" />
                <span className="min-w-48 flex-1">
                  <span className="block text-sm font-semibold">
                    {d.nome_arquivo || DOCUMENT_TYPE_LABELS[d.tipo_documento]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {DOCUMENT_TYPE_LABELS[d.tipo_documento]} · {memberName(d.member_id)} · enviado em{" "}
                    {formatDate(d.created_at.slice(0, 10))}
                  </span>
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${DOCUMENT_STATUS_CLASSES[d.status]}`}
                >
                  {DOCUMENT_STATUS_LABELS[d.status]}
                </span>
                {d.url_arquivo && (
                  <button
                    type="button"
                    onClick={() => void abrirArquivo(d.url_arquivo!)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <Eye className="size-3.5" />
                    Ver documento
                  </button>
                )}
                {podeLancar && /\.pdf$/i.test(d.nome_arquivo ?? "") && (
                  <button
                    type="button"
                    disabled={reprocessar.isPending}
                    onClick={() => reprocessar.mutate(d)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    <ScanLine className="size-3.5" />
                    {reprocessar.isPending ? "Lendo..." : "Ler PDF"}
                  </button>
                )}

                {podeLancar && (
                  <button
                    type="button"
                    onClick={() => setRevisando(revisando?.id === d.id ? null : d)}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Revisar documento
                  </button>
                )}
                {podeLancar && (
                  <button
                    type="button"
                    aria-label="Remover documento"
                    onClick={() => remove.mutate({ id: d.id, url_arquivo: d.url_arquivo })}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {revisando && (
        <RevisarDocumento
          key={revisando.id}
          familyId={familyId}
          memberId={memberId}
          createdBy={createdBy}
          doc={revisando}
          draft={drafts.find((i) => i.document_id === revisando.id && i.status === "PENDENTE_APROVACAO") ?? null}
          onVerArquivo={() => revisando.url_arquivo && void abrirArquivo(revisando.url_arquivo)}
          onClose={() => setRevisando(null)}
          onReject={() => rejeitar.mutate(revisando.id)}
          onConfirmed={() => {
            setRevisando(null);
            invalidar();
          }}
        />
      )}

      {processados.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-base font-bold">Documentos processados</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Histórico dos documentos já revisados e das compras geradas.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {processados.map((d) => {
              const compra = (purchases ?? []).find((p) => p.id === d.purchase_id);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-48 flex-1">
                    <span className="block text-sm font-semibold">
                      {d.nome_arquivo || DOCUMENT_TYPE_LABELS[d.tipo_documento]}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {compra
                        ? `${compra.estabelecimento} · ${formatDate(compra.data_compra)} · ${formatCurrency(Number(compra.valor_total))}`
                        : "Sem compra gerada"}{" "}
                      · {memberName(d.member_id)}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${DOCUMENT_STATUS_CLASSES[d.status]}`}
                  >
                    {DOCUMENT_STATUS_LABELS[d.status]}
                  </span>
                  {d.url_arquivo && (
                    <button
                      type="button"
                      onClick={() => void abrirArquivo(d.url_arquivo!)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                    >
                      <Eye className="size-3.5" />
                      Ver documento
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Tela de revisão manual: o usuário confere e completa os dados antes de gerar a compra. */
function RevisarDocumento({
  familyId,
  memberId,
  createdBy,
  doc,
  draft,
  onVerArquivo,
  onClose,
  onReject,
  onConfirmed,
}: {
  familyId: string;
  memberId: string;
  createdBy?: string | undefined;
  doc: FinancialDocument;
  draft: PurchaseImport | null;
  onVerArquivo: () => void;
  onClose: () => void;
  onReject: () => void;
  onConfirmed: () => void;
}) {
  const { data: itensExtraidos } = useImportItems(draft?.id);
  const { data: cards } = useCreditCards(familyId);
  const { data: contas } = useBankAccounts(familyId);
  const { data: categorias } = useExpenseCategories();
  const memberName = useMemberName(familyId);

  const [responsavel, setResponsavel] = useState(draft?.member_id ?? doc.member_id ?? memberId);
  const [estabelecimento, setEstabelecimento] = useState(draft?.estabelecimento ?? "");
  const [dataCompra, setDataCompra] = useState(
    draft?.data_compra ?? doc.created_at.slice(0, 10),
  );
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>("PIX");
  const [cartaoId, setCartaoId] = useState("");
  const [contaId, setContaId] = useState("");
  const [items, setItems] = useState<NewPurchaseItem[]>([linhaVazia()]);

  useEffect(() => {
    if (!itensExtraidos || itensExtraidos.length === 0) return;
    setItems(
      itensExtraidos.map((i) => ({
        product_id: "",
        descricao_produto: i.descricao_produto,
        quantidade: String(Number(i.quantidade)),
        unidade: i.unidade,
        valor_unitario: String(Number(i.valor_unitario)),
        categoria_id: i.categoria_sugerida ?? "",
      })),
    );
  }, [itensExtraidos]);

  const total = items.reduce(
    (acc, i) => acc + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0),
    0,
  );

  const confirmar = useMutation({
    mutationFn: () =>
      confirmDocumentPurchase({
        documentId: doc.id,
        importId: draft?.id ?? null,
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
        cards: cards ?? [],
      }),
    onSuccess: () => {
      toast.success("Compra criada a partir do documento.");
      onConfirmed();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setItem = (index: number, patch: Partial<NewPurchaseItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Revisar documento</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {doc.nome_arquivo || DOCUMENT_TYPE_LABELS[doc.tipo_documento]} ·{" "}
            {DOCUMENT_TYPE_LABELS[doc.tipo_documento]} · enviado por {memberName(doc.member_id)} em{" "}
            {formatDate(doc.created_at.slice(0, 10))}
          </p>
        </div>
        {doc.url_arquivo && (
          <button
            type="button"
            onClick={onVerArquivo}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
          >
            <Eye className="size-3.5" />
            Ver documento
          </button>
        )}
      </div>

      <h3 className="mt-5 text-sm font-bold">Dados da compra</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Estabelecimento">
          <input
            value={estabelecimento}
            onChange={(e) => setEstabelecimento(e.target.value)}
            placeholder="Ex.: Mercado Silva"
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
        <MemberSelect familyId={familyId} value={responsavel} onChange={setResponsavel} />
        <Field label="Forma de pagamento">
          <select
            value={formaPagamento}
            onChange={(e) => setFormaPagamento(e.target.value as PaymentMethod)}
            className={inputClass}
          >
            {FORMAS_REVISAO.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
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
        ) : usesBankAccount(formaPagamento) ? (
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
        <p className="text-sm text-muted-foreground">
          Valor total:{" "}
          <span className="text-lg font-extrabold text-foreground">{formatCurrency(total)}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onReject}
            className="rounded-full border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
          >
            Rejeitar documento
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
            {confirmar.isPending ? "Confirmando..." : "Confirmar compra"}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}
