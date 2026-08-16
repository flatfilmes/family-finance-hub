import { describe, expect, it } from "vitest";

import { resolveStatementPeriod } from "./period";
import { buildBankAudit, dataNoHistorico } from "@/lib/bank-audit";
import { inferEventDate } from "./event-date";

/** Extratos BB reais: period_start/end gravados como a data do saldo anterior. */
const BB = [
  { id: "jan", saldo_inicial: 4115.02, saldo_final: 3096.75, abertura: "2025-12-29", fechamento: "2026-01-31", qtd: 26 },
  { id: "fev", saldo_inicial: 3096.75, saldo_final: 649.63, abertura: "2026-01-26", fechamento: "2026-02-28", qtd: 17 },
  { id: "mar", saldo_inicial: 649.63, saldo_final: 678.57, abertura: "2026-02-27", fechamento: "2026-03-31", qtd: 18 },
  { id: "abr", saldo_inicial: 678.57, saldo_final: 500.59, abertura: "2026-03-31", fechamento: "2026-04-30", qtd: 23 },
  { id: "mai", saldo_inicial: 500.59, saldo_final: 91.28, abertura: "2026-04-29", fechamento: "2026-05-31", qtd: 26 },
  { id: "jun", saldo_inicial: 91.28, saldo_final: 274.57, abertura: "2026-05-29", fechamento: "2026-06-30", qtd: 12 },
  { id: "jul", saldo_inicial: 274.57, saldo_final: 269.64, abertura: "2026-06-29", fechamento: "2026-07-31", qtd: 19 },
];

const imports = [
  ...BB.map((b) => ({
    id: b.id,
    nome_arquivo: `${b.id}.pdf`,
    periodo_inicio: `2026-${String(BB.indexOf(b) + 1).padStart(2, "0")}-01`,
    periodo_fim: b.fechamento,
    saldo_inicial: b.saldo_inicial,
    saldo_final: b.saldo_final,
    quantidade_lancamentos: b.qtd,
    status: "CONFIRMED",
  })),
  {
    id: "ago",
    nome_arquivo: "ago.pdf",
    periodo_inicio: "2026-08-03",
    periodo_fim: "2026-08-12",
    saldo_inicial: 269.64,
    saldo_final: 4795,
    quantidade_lancamentos: 7,
    status: "CONFIRMED",
  },
];

const checkpoints = [
  ...BB.flatMap((b) => [
    { importId: b.id, data: b.abertura, saldo: b.saldo_inicial },
    { importId: b.id, data: b.fechamento, saldo: b.saldo_final },
  ]),
  { importId: "ago", data: "2026-08-02", saldo: 269.64 },
  { importId: "ago", data: "2026-08-12", saldo: 4795 },
];

describe("resolveStatementPeriod", () => {
  it("nunca usa a data do saldo anterior como mês do extrato", () => {
    const jan = resolveStatementPeriod(imports[0]!, [
      { data: "2025-12-29", saldo: 4115.02 },
      { data: "2026-01-31", saldo: 3096.75 },
    ]);
    expect(jan.mesReferencia).toBe("2026-01");
    expect(jan.aberturaData).toBe("2025-12-29");
    expect(jan.inicio).toBe("2026-01-01");
    expect(jan.fim).toBe("2026-01-31");
    // saldo anterior é OPENING_CHECKPOINT: não conta como saldo diário
    expect(jan.checkpointsDiarios).toHaveLength(1);
  });

  it("não usa checkpoints para fabricar identidade quando o período está ausente", () => {
    const unresolved = resolveStatementPeriod(
      { periodo_inicio: null, periodo_fim: null, saldo_inicial: 4115.02 },
      checkpoints.slice(0, 2),
    );
    expect(unresolved.origem).toBe("INDEFINIDO");
    expect(unresolved.mesReferencia).toBeNull();
  });

  it("preserva o período quando o documento traz período válido", () => {
    const ago = resolveStatementPeriod(imports[7]!, [
      { data: "2026-08-02", saldo: 269.64 },
      { data: "2026-08-12", saldo: 4795 },
    ]);
    expect(ago.origem).toBe("DOCUMENTO");
    expect(ago.mesReferencia).toBe("2026-08");
    expect(ago.aberturaData).toBe("2026-08-02");
  });
});

describe("inferência de data do evento pelo statement", () => {
  it("mantém 04/01 no statement de janeiro/2026, sem herdar o ano da abertura", () => {
    const period = { inicio: "2026-01-01", fim: "2026-01-31" };
    expect(inferEventDate(4, 1, period)).toBe("2026-01-04");
    expect(dataNoHistorico("04/01 12:48 EDUARDO GARCIA", period.inicio, period.fim)).toBe(
      "2026-01-04",
    );
  });

  it("mantém 07/02 no statement de fevereiro, sem usar a abertura de janeiro", () => {
    expect(
      dataNoHistorico("07/02 12:34", "2026-02-01", "2026-02-28"),
    ).toBe("2026-02-07");
  });

  it("aceita 31/12 como evento próximo à abertura do statement de janeiro", () => {
    expect(inferEventDate(31, 12, { inicio: "2026-01-01", fim: "2026-01-31" })).toBe(
      "2025-12-31",
    );
  });
});

describe("buildBankAudit — atribuição temporal", () => {
  const audit = buildBankAudit({
    accountId: "conta",
    transactions: [],
    imports,
    checkpoints,
  });

  it("detecta exatamente os 8 períodos, sem 2025-12", () => {
    expect(audit.meses.map((m) => m.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("usa o saldo anterior apenas como abertura do mês correto", () => {
    expect(audit.meses[0]!.openingBalance).toBe(4115.02);
    expect(audit.meses[6]!.openingBalance).toBe(274.57);
    expect(audit.meses[7]!.openingBalance).toBe(269.64);
  });

  it("não cria lacuna falsa entre junho e agosto", () => {
    expect(audit.resumo.lacunas).toBe(0);
    expect(audit.continuidade.every((c) => c.confere)).toBe(true);
  });
});
