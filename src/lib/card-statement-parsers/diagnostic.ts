/**
 * Dry run do parser de FATURA DE CARTÃO para o Modo diagnóstico PDF.
 * Roda a leitura atual em memória: não cria importação, compra nem transação.
 *
 * A semântica aqui é de FATURA — nunca de conta bancária: não existe saldo
 * anterior, saldo final nem checkpoint diário. O validator correto é o de
 * cartão (CARD_STATEMENT_VALID), que reconcilia os itens efetivamente
 * cobrados com o total impresso na fatura.
 */
import { readCardStatementPdf } from "@/lib/card-statement-parsers";
import type { StatementEntry } from "@/lib/card-statement-parsers/types";
import type { ParserDryRunResult } from "@/lib/pdf-diagnostic/diagnostic-types";

/** Categoria econômica da linha da fatura (nunca movimentação bancária). */
export type CardItemCategory =
  | "PURCHASE"
  | "CREDIT_REVERSAL"
  | "INSTALLMENT"
  | "CARD_FEE_INTEREST_IOF"
  | "PAYMENT"
  | "METADATA_SUMMARY";

export function classifyCardItem(entry: StatementEntry): CardItemCategory {
  if (entry.tipo_sugerido === "PAGAMENTO") return "PAYMENT";
  if (entry.tipo_sugerido === "ESTORNO" || entry.valor < 0) return "CREDIT_REVERSAL";
  if (entry.tipo_sugerido === "JUROS" || entry.tipo_sugerido === "TAXA")
    return "CARD_FEE_INTEREST_IOF";
  if (entry.total_parcelas && entry.total_parcelas > 1) return "INSTALLMENT";
  return "PURCHASE";
}

const arred = (v: number) => Math.round(v * 100) / 100;

export const cardStatementDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  const parsed = await readCardStatementPdf(file);
  const entries = parsed.entries ?? [];

  const categorias = entries.map((e) => ({ entry: e, categoria: classifyCardItem(e) }));
  const cobrados = categorias.filter((c) => c.categoria !== "METADATA_SUMMARY");
  const totalCobrado = arred(cobrados.reduce((a, c) => a + c.entry.valor, 0));
  const totalDeclarado = parsed.valor_total_fatura ?? null;
  const diferenca = totalDeclarado === null ? null : arred(totalCobrado - totalDeclarado);
  const valida = diferenca !== null && Math.abs(diferenca) < 0.01;

  const contagem = (categoria: CardItemCategory) =>
    categorias.filter((c) => c.categoria === categoria).length;

  const validation = {
    status: valida
      ? "CARD_STATEMENT_VALID"
      : totalDeclarado === null
        ? "CARD_STATEMENT_TOTAL_NOT_FOUND"
        : "CARD_STATEMENT_TOTAL_MISMATCH",
    declaredInvoiceTotal: totalDeclarado,
    chargedItemsTotal: totalCobrado,
    difference: diferenca,
    problems: valida
      ? []
      : [
          totalDeclarado === null
            ? "A fatura não informou o total oficial para conferência."
            : `Soma dos itens cobrados (${totalCobrado}) diferente do total da fatura (${totalDeclarado}).`,
        ],
  };

  const cardLast4s = [
    ...new Set(entries.map((e) => e.card_last4).filter((v): v is string => Boolean(v))),
  ];

  const invoice = {
    issuer: parsed.emissor,
    holder: parsed.titular,
    cardLast4: parsed.final_cartao,
    cardLast4s,
    // Fechamento da fatura ATUAL: só quando o PDF declara explicitamente.
    // A previsão do próximo fechamento nunca é copiada para cá.
    closingDate: parsed.data_fechamento,
    nextClosingDate: parsed.metadata?.next_closing_date ?? null,
    dueDate: parsed.data_vencimento,
    issueDate: parsed.metadata?.data_emissao ?? null,
    periodStart: parsed.periodo_inicio ?? null,
    periodEnd: parsed.periodo_fim ?? null,
    invoiceTotal: totalDeclarado,
    previousInvoiceTotal: parsed.metadata?.total_fatura_anterior ?? null,
    previousPayment: parsed.metadata?.previous_invoice_payment ?? null,
    creditLimit: parsed.metadata?.limite_credito ?? null,
  };

  const emissor = parsed.emissor ?? null;
  const stages: ParserDryRunResult["pipelineStages"] = [
    { stage: "PDFJS", status: "PASS" },
    { stage: "VISUAL_ROWS", status: "PASS" },
    { stage: "DOCUMENT_TYPE_DETECTION", status: "PASS", detail: "CREDIT_CARD_STATEMENT" },
    {
      stage: "CARD_ISSUER_DETECTION",
      status: emissor ? "PASS" : "FAIL",
      detail: `issuer = ${emissor ?? "UNKNOWN"}`,
    },
    { stage: "CARD_PARSER_SELECTION", status: "PASS", detail: `parser = ${parsed.parser}` },
    { stage: "CARD_PARSER_EXECUTION", status: "PASS", count: entries.length },
    {
      stage: "CARD_VALIDATION",
      status: valida ? "PASS" : "FAIL",
      detail: `${validation.status} · declarado ${totalDeclarado ?? "—"} · itens ${totalCobrado} · diferença ${diferenca ?? "—"}`,
    },
    { stage: "BANK_PARSER", status: "NOT_APPLICABLE" },
    { stage: "BANK_CHECKPOINT_VALIDATION", status: "NOT_APPLICABLE" },
  ];
  const diagnosticStatus = stages.some((s) => s.status === "FAIL") ? "FAIL" : "PASS";

  return {
    parser: parsed.parser,
    bank: emissor,
    family: "CARD_STATEMENT",
    diagnosticStatus,
    persistenceAllowed: false,
    status: "OK",
    error: null,
    parserInfo: {
      status: "FOUND",
      requestedBank: emissor,
      requestedIssuer: emissor,
      name: parsed.parser,
      family: "CARD_STATEMENT",
    },
    cardDetection: {
      status: emissor ? "DETECTED" : "NOT_DETECTED",
      issuer: emissor,
      parser: parsed.parser,
    },
    bankDetection: { status: "NOT_APPLICABLE" },
    pipelineStages: stages,
    counts: { rawItems: 0, rows: entries.length, transactions: 0, checkpoints: 0 },
    output: {
      documentType: "CREDIT_CARD_STATEMENT",
      invoice,
      validation,
      itemCounts: {
        total: entries.length,
        purchases: contagem("PURCHASE"),
        installments: contagem("INSTALLMENT"),
        creditsReversals: contagem("CREDIT_REVERSAL"),
        feesInterestIof: contagem("CARD_FEE_INTEREST_IOF"),
        payments: contagem("PAYMENT"),
        futureInstallmentProjections: (parsed.futuras ?? []).length,
      },
      items: categorias.map(({ entry, categoria }) => ({
        category: categoria,
        date: entry.data_lancamento,
        description: entry.descricao_original,
        amount: entry.valor,
        installmentCurrent: entry.parcela_atual,
        installmentTotal: entry.total_parcelas,
        cardLast4: entry.card_last4 ?? null,
        suggestedKind: entry.tipo_sugerido,
      })),
      // Metadados que NUNCA viram lançamento (opções de parcelamento, limites).
      paymentOptionMetadata: parsed.blocos ?? [],
      futureInstallments: parsed.futuras ?? [],
      subtotals: parsed.subtotais ?? [],
      metadata: parsed.metadata ?? {},
      diagnosticStatus,
      parserFamily: "CARD_STATEMENT",
      extractionStatus: parsed.extraction_status ?? "READY",
      persistenceAllowed: false,
      // Semântica de fatura: nenhum saldo/checkpoint bancário existe aqui.
      bankTransactions: 0,
      bankCheckpoints: 0,
    },
    debug: {
      accepted: categorias.map(({ entry, categoria }) => ({
        raw: entry.descricao_original,
        valor: entry.valor,
        detalhe: [
          entry.data_lancamento,
          categoria,
          entry.parcela_atual ? `${entry.parcela_atual}/${entry.total_parcelas}` : null,
          entry.card_last4 ? `•••• ${entry.card_last4}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      rejected: (parsed.rejeitadas ?? []).map((r) => ({
        raw: r.texto,
        page: r.page ?? null,
        reason: r.motivo,
      })),
      metadata: [
        { campo: "documentType", valor: "CREDIT_CARD_STATEMENT" },
        { campo: "parser", valor: parsed.parser },
        { campo: "lancamentos", valor: entries.length },
        { campo: "total_itens_cobrados", valor: totalCobrado },
        { campo: "valor_total_fatura", valor: totalDeclarado },
        { campo: "diferenca", valor: diferenca },
        { campo: "vencimento", valor: parsed.data_vencimento },
        { campo: "final_cartao", valor: parsed.final_cartao },
        { campo: "validacao", valor: validation.status },
        { campo: "next_closing_date", valor: parsed.metadata?.next_closing_date ?? null },
        { campo: "data_fechamento_atual", valor: parsed.data_fechamento },
        { campo: "extraction_status", valor: parsed.extraction_status ?? null },
      ],
    },
  };
};
