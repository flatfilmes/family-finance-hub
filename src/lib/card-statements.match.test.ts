import { describe, expect, it } from "vitest";
import { matchEntry, classifyReviewItem } from "@/lib/card-statements";

const base = {
  descricao_original: "",
  descricao_normalizada: "",
  estabelecimento_sugerido: null,
  data_lancamento: "2026-08-05",
  valor: 0,
  parcela_atual: null,
  total_parcelas: null,
  tipo_sugerido: "COMPRA" as const,
  categoria_banco: null,
  card_last4: null,
};

const cand = {
  purchases: [],
  installments: [
    { id: "i8", purchase_id: "p1", numero_parcela: 8, total_parcelas: 10, valor_parcela: 100 } as never,
    { id: "i7", purchase_id: "p1", numero_parcela: 7, total_parcelas: 10, valor_parcela: 100 } as never,
  ],
  recurring: [
    { id: "r1", nome: "Google Workspace", valor: 141.77, ativo: true } as never,
  ],
  installmentPurchases: { p1: { id: "p1", estabelecimento: "LOJAS RENNER" } },
};

describe("match", () => {
  it("reconhece parcela seguinte 08/10", () => {
    const r = matchEntry({ ...base, descricao_original: "LOJAS RENNER 08/10", valor: 100, parcela_atual: 8, total_parcelas: 10 }, cand, new Set());
    expect(r.match_status).toBe("MATCHED");
    expect(r.installment_id_matched).toBe("i8");
    expect(classifyReviewItem({ ...r, tipo_sugerido: "COMPRA" })).toBe("PARCELA_IDENTIFICADA");
  });
  it("reconhece recorrencia com pequeno reajuste", () => {
    const r = matchEntry({ ...base, descricao_original: "GOOGLE WORKSPACE", valor: 142.5 }, cand, new Set());
    expect(r.match_status).toBe("MATCHED");
    expect(r.recurring_expense_id_matched).toBe("r1");
    expect(classifyReviewItem({ ...r, tipo_sugerido: "COMPRA" })).toBe("RECORRENTE_IDENTIFICADO");
  });
  it("compra nova continua nova", () => {
    const r = matchEntry({ ...base, descricao_original: "PADARIA CENTRAL", valor: 32.9 }, cand, new Set());
    expect(r.match_status).toBe("UNMATCHED");
    expect(classifyReviewItem({ ...r, tipo_sugerido: "COMPRA" })).toBe("NOVO");
  });
});
