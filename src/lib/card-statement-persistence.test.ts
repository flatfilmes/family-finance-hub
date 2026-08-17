import { describe, expect, it } from "vitest";
import {
  cardStatementPersistenceDryRun,
  invoiceFingerprint,
  type CardRow,
  type ExistingImport,
  type InvoiceCanonical,
  type OfficialItem,
} from "@/lib/card-statement-persistence";

const invoice: InvoiceCanonical = {
  issuer: "NUBANK",
  holder: "RODRIGO NUNES AMADOR",
  cardLast4: "9982",
  cardLast4s: ["9982", "7274"],
  periodStart: "2026-07-10",
  periodEnd: "2026-08-10",
  closingDate: "2026-08-10",
  nextClosingDate: "2026-09-10",
  dueDate: "2026-08-17",
  issueDate: "2026-08-10",
  invoiceTotal: 155.99,
  previousInvoiceTotal: 15.53,
  previousPayment: { data: "2026-07-15", valor: -15.53 },
};

const item = (o: Partial<OfficialItem> & { description: string; amount: number }): OfficialItem => ({
  category: "PURCHASE",
  date: "2026-08-09",
  installmentCurrent: null,
  installmentTotal: null,
  cardLast4: "9982",
  ...o,
});

const itens: OfficialItem[] = [
  item({ description: "Padaria Dama Doce", amount: 9.04 }),
  item({ description: "Padaria Dama Doce", amount: 20.25 }),
  item({ description: "Mercado Sao Luiz", amount: 40.5, date: "2026-07-20" }),
  item({ description: "Posto Ipiranga", amount: 86.2, date: "2026-07-28", cardLast4: "7274" }),
];

const cards: CardRow[] = [
  { id: "card-nu", banco: "Nubank", nome_cartao: "Nubank 9982", ativo: true, member_id: null },
  { id: "card-outro", banco: "Itaú", nome_cartao: "Itaú 5484", ativo: true, member_id: null },
];

describe("CARD_STATEMENT_PERSISTENCE_DRY_RUN", () => {
  it("mapeia o cartão Nubank pelo final e mantém UMA fatura consolidada", () => {
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: itens,
      cards,
      purchases: [],
      statementItems: [],
      imports: [],
    });
    expect(r.cardMapping.status).toBe("CARD_MAPPED");
    expect(r.cardMapping.selectedCardId).toBe("card-nu");
    expect(r.invoice.consolidated).toBe(true);
    expect(r.invoice.cardLast4s).toEqual(["9982", "7274"]);
    expect(r.persisted).toBe(false);
  });

  it("não deduplica as duas compras legítimas da Padaria no mesmo dia", () => {
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: itens,
      cards,
      purchases: [
        {
          id: "p-9",
          data_compra: "2026-08-09",
          valor_total: 9.04,
          estabelecimento: "Padaria Dama Doce",
          credit_card_id: "card-nu",
        },
        {
          id: "p-20",
          data_compra: "2026-08-09",
          valor_total: 20.25,
          estabelecimento: "Padaria Dama Doce",
          credit_card_id: "card-nu",
        },
      ],
      statementItems: [],
      imports: [],
    });
    const padarias = r.items.filter((i) => i.amount === 9.04 || i.amount === 20.25);
    expect(padarias.map((p) => p.matchedPurchaseId).sort()).toEqual(["p-20", "p-9"]);
    expect(r.summary.wouldDuplicate).toBe(0);
  });

  it("preserva o total oficial e trata o pagamento anterior como metadado", () => {
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: [
        ...itens,
        item({ category: "PAYMENT", description: "Pagamento fatura anterior", amount: -15.53 }),
      ],
      cards,
      purchases: [],
      statementItems: [],
      imports: [],
    });
    expect(r.items).toHaveLength(4);
    expect(r.totals.declaredInvoiceTotal).toBe(155.99);
    expect(r.totals.canonicalEconomicTotalAfter).toBe(155.99);
    expect(r.previousPayment.treatment).toBe("METADATA_ONLY");
  });

  it("reconhece a mesma fatura já importada e não gera efeito econômico novo", () => {
    const fingerprint = invoiceFingerprint({
      cardId: "card-nu",
      issuer: "NUBANK",
      closingDate: "2026-08-10",
      dueDate: "2026-08-17",
      invoiceTotal: 155.99,
    });
    const imports: ExistingImport[] = [
      {
        id: "imp-1",
        credit_card_id: "card-nu",
        fingerprint,
        data_fechamento: "2026-08-10",
        data_vencimento: "2026-08-17",
        valor_total_fatura: 155.99,
        status: "CONFIRMED",
        nome_arquivo: "Nubank_2026-08-17.pdf",
      },
    ];
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: itens,
      cards,
      purchases: [],
      statementItems: itens.map((i, idx) => ({
        id: `si-${idx}`,
        import_id: "imp-1",
        credit_card_id: "card-nu",
        data_lancamento: i.date,
        descricao_original: i.description,
        descricao_normalizada: i.description.toUpperCase(),
        valor: i.amount,
        parcela_atual: null,
        total_parcelas: null,
        purchase_id_matched: `p-${idx}`,
      })),
      imports,
    });
    expect(r.identity.status).toBe("SAME_STATEMENT_ALREADY_IMPORTED");
    expect(r.items.every((i) => i.status === "EXACT_MATCH")).toBe(true);
    expect(r.summary.wouldCreatePurchases).toBe(0);
    expect(r.secondImport.newEconomicPurchases).toBe(0);
    expect(r.secondImport.duplicateEconomicEffects).toBe(0);
  });

  it("exige revisão quando dois cartões do emissor respondem pelos finais", () => {
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: itens,
      cards: [
        ...cards,
        { id: "card-nu2", banco: "Nubank", nome_cartao: "Nubank 7274", ativo: true, member_id: null },
      ],
      purchases: [],
      statementItems: [],
      imports: [],
    });
    expect(r.cardMapping.status).toBe("CARD_MAPPING_REVIEW_REQUIRED");
    expect(r.status).toBe("CARD_MAPPING_REVIEW_REQUIRED");
    expect(r.readyForRealPersistence).toBe(false);
  });

  it("classifica todos os itens e nunca prevê duplicação", () => {
    const r = cardStatementPersistenceDryRun({
      invoice,
      items: itens,
      cards,
      purchases: [],
      statementItems: [],
      imports: [],
    });
    expect(r.items).toHaveLength(4);
    expect(r.items.every((i) => !!i.status)).toBe(true);
    expect(r.summary.wouldDuplicate).toBe(0);
    expect(r.summary.newItems).toBe(4);
  });
});
