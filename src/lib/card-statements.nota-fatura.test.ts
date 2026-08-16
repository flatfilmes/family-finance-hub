import { describe, expect, it } from "vitest";
import { matchEntry, similaridadeFornecedor } from "@/lib/card-statements";
import type { StatementEntry } from "@/lib/card-statement-parsers";

const compraDaNota = {
  id: "compra-nf",
  family_id: "fam",
  estabelecimento: "NS2.COM INTERNET S.A.",
  valor_total: 618.37,
  data_compra: "2026-08-07",
} as never;

const lancamentoFatura: StatementEntry = {
  data_lancamento: "2026-08-07",
  descricao_original: "MLP*Netshoes-NS2CO",
  descricao_normalizada: "mlp netshoes ns2co",
  estabelecimento_sugerido: "Netshoes",
  valor: 77.34,
  parcela_atual: 1,
  total_parcelas: 8,
  tipo_sugerido: "COMPRA",
} as StatementEntry;

describe("nota fiscal x fatura do cartão", () => {
  it("reconhece o mesmo fornecedor com nomes diferentes", () => {
    expect(similaridadeFornecedor("NS2.COM INTERNET S.A.", "MLP*Netshoes-NS2CO")).toBeGreaterThan(
      0.3,
    );
  });

  it("associa a parcela da fatura à compra da nota, sem criar compra nova", () => {
    const resultado = matchEntry(
      lancamentoFatura,
      {
        purchases: [compraDaNota],
        installments: [],
        recurring: [],
        installmentPurchases: {},
      },
      new Set(),
    );
    expect(resultado.purchase_id_matched).toBe("compra-nf");
    expect(["MATCHED", "POSSIBLE_MATCH"]).toContain(resultado.match_status);
  });

  it("não associa quando o valor total não fecha com parcela x total", () => {
    const resultado = matchEntry(
      lancamentoFatura,
      {
        purchases: [{ ...(compraDaNota as object), id: "outra", valor_total: 120 } as never],
        installments: [],
        recurring: [],
        installmentPurchases: {},
      },
      new Set(),
    );
    expect(resultado.purchase_id_matched).toBeNull();
  });
});
