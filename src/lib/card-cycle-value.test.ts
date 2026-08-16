import { describe, expect, it } from "vitest";
import { classificarCiclosDoCartao } from "@/lib/card-details";

const CARD = "card-1";

function invoice(mes: string, valor: number) {
  return {
    id: `inv-${mes}`,
    credit_card_id: CARD,
    status: "ABERTA",
    data_fechamento: `2026-${mes}-10`,
    data_vencimento: `2026-${mes}-17`,
    valor_total: valor,
  };
}

const importacaoAgosto = {
  id: "imp-ago",
  credit_card_id: CARD,
  status: "CONFIRMED",
  valor_total_fatura: 6577.67,
  data_vencimento: "2026-08-17",
  data_fechamento: "2026-09-10",
  periodo_fim: null,
  created_at: "2026-08-16T10:12:16Z",
};

describe("valor exibido por ciclo", () => {
  const ciclos = classificarCiclosDoCartao({
    invoices: [invoice("08", 2675.71), invoice("09", 1487.73), invoice("10", 826.88)],
    imports: [importacaoAgosto],
    hoje: new Date("2026-08-16T12:00:00Z"),
  });
  const de = (mes: string) => ciclos.find((c) => c.competencia === `2026-${mes}`)!;

  it("agosto usa a fatura oficial confirmada", () => {
    expect(de("08").valor).toBe(6577.67);
    expect(de("08").fonte).toBe("OFFICIAL_STATEMENT");
    expect(de("08").estado).toBe("FECHADA");
  });

  it("setembro em formação usa a estimativa interna", () => {
    expect(de("09").valor).toBe(1487.73);
    expect(de("09").fonte).toBe("ESTIMATED");
    expect(de("09").estado).toBe("EM_FORMACAO");
  });

  it("outubro é projeção", () => {
    expect(de("10").valor).toBe(826.88);
    expect(de("10").fonte).toBe("PROJECTED");
    expect(de("10").estado).toBe("PROJETADA");
  });

  it("importação desfeita não vale como oficial", () => {
    const semOficial = classificarCiclosDoCartao({
      invoices: [invoice("08", 2675.71)],
      imports: [{ ...importacaoAgosto, status: "UNDONE" }],
      hoje: new Date("2026-08-16T12:00:00Z"),
    });
    expect(semOficial[0]!.fonte).toBe("ESTIMATED");
    expect(semOficial[0]!.valor).toBe(2675.71);
  });
});
