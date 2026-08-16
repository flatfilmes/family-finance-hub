import { describe, expect, it } from "vitest";
import { parseItauBankStatementLines, isItauBankStatement } from "./itau";
import { marcarDuplicados, buildExistingMovementKeys, checkpointsInéditos } from "@/lib/bank-statements/dedupe";
import type { PdfLine } from "@/lib/pdf-extract";

/** Monta uma linha nas colunas reais do extrato Itaú. */
function linha(data: string, descricao: string, valor?: string, saldo?: string): PdfLine {
  const cells = [
    { x: 40, text: data },
    { x: 90, text: descricao },
    ...(valor ? [{ x: 380, text: valor }] : []),
    ...(saldo ? [{ x: 470, text: saldo }] : []),
  ].filter((c) => c.text);
  return {
    y: 0,
    page: 1,
    text: cells.map((c) => c.text).join(" "),
    cells,
  };
}

const cabecalho: PdfLine[] = [
  { y: 9, page: 1, text: "Itaú Unibanco — extrato conta", cells: [{ x: 40, text: "Itaú Unibanco — extrato conta" }] },
  {
    y: 8,
    page: 1,
    text: "agência: 4635 conta: 025583-1",
    cells: [{ x: 40, text: "agência: 4635" }, { x: 200, text: "conta: 025583-1" }],
  },
  {
    y: 7,
    page: 1,
    text: "período de visualização: 01/01/2026 até 30/06/2026",
    cells: [{ x: 40, text: "período de visualização: 01/01/2026 até 30/06/2026" }],
  },
  {
    y: 6,
    page: 1,
    text: "data lançamentos valor (R$) saldo (R$)",
    cells: [
      { x: 40, text: "data" },
      { x: 90, text: "lançamentos" },
      { x: 380, text: "valor (R$)" },
      { x: 470, text: "saldo (R$)" },
    ],
  },
];

const primeiroPdf: PdfLine[] = [
  ...cabecalho,
  linha("13/08/2026", "SALDO DO DIA", undefined, "4,16"),
  linha("31/12/2025", "SALDO DO DIA", undefined, "0,00"),
  linha("13/02/2026", "PIX TRANSF Rodrigo13/02", "10,00"),
  linha("13/02/2026", "SALDO DO DIA", undefined, "10,00"),
  linha("18/02/2026", "PIX TRANSF Maria18/02", "-10,00"),
  linha("18/02/2026", "SALDO DO DIA", undefined, "0,00"),
  linha("17/03/2026", "PIX TRANSF Rodrigo17/03", "22,95"),
  linha("17/03/2026", "SALDO DO DIA", undefined, "22,95"),
  linha("16/04/2026", "PIX TRANSF Rodrigo16/04", "4.800,00"),
  linha("16/04/2026", "SALDO DO DIA", undefined, "4.822,95"),
  linha("17/04/2026", "FATURA PAGA ITAU GOLD", "-4.728,53"),
  linha("17/04/2026", "SALDO DO DIA", undefined, "94,42"),
  linha("18/05/2026", "PIX TRANSF Rodrigo18/05", "5.200,00"),
  linha("18/05/2026", "FATURA PAGA ITAU GOLD", "-5.102,25"),
  linha("18/05/2026", "SALDO DO DIA", undefined, "192,17"),
  linha("17/06/2026", "PIX TRANSF Rodrigo17/06", "5.500,00"),
  linha("17/06/2026", "REND PAGO APLIC AUT MAIS", "0,12"),
  linha("17/06/2026", "FATURA PAGA ITAU GOLD", "-5.571,48"),
  linha("17/06/2026", "SALDO DO DIA", undefined, "120,81"),
];

describe("parser ITAU_BANK_STATEMENT", () => {
  const parsed = parseItauBankStatementLines(primeiroPdf);

  it("reconhece o layout Itaú", () => {
    expect(isItauBankStatement(primeiroPdf.map((l) => l.text))).toBe(true);
    expect(parsed.parser).toBe("ITAU_BANK_STATEMENT");
  });

  it("usa o período declarado, não a maior data do documento", () => {
    expect(parsed.periodoInicio).toBe("2026-01-01");
    expect(parsed.periodoFim).toBe("2026-06-30");
  });

  it("abre com o último saldo anterior ao período", () => {
    expect(parsed.saldoInicial).toBe(0);
  });

  it("trata saldo fora do período como referência atual, nunca checkpoint", () => {
    expect(parsed.saldoReferenciaAtual).toEqual({ data: "2026-08-13", saldo: 4.16 });
    expect(parsed.checkpoints?.some((c) => c.data === "2026-08-13")).toBe(false);
    expect(parsed.checkpoints?.some((c) => c.data === "2025-12-31")).toBe(false);
  });

  it("guarda todos os saldos diários do período", () => {
    const mapa = Object.fromEntries((parsed.checkpoints ?? []).map((c) => [c.data, c.saldo]));
    expect(mapa).toMatchObject({
      "2026-02-13": 10,
      "2026-02-18": 0,
      "2026-03-17": 22.95,
      "2026-04-16": 4822.95,
      "2026-04-17": 94.42,
      "2026-05-18": 192.17,
      "2026-06-17": 120.81,
    });
    expect(parsed.saldoFinal).toBe(120.81);
  });

  it("nunca cria transação a partir de SALDO DO DIA", () => {
    expect(parsed.movimentos.some((m) => /saldo do dia/i.test(m.descricaoOriginal))).toBe(false);
  });

  it("classifica PIX, pagamento de fatura e rendimento", () => {
    const pix = parsed.movimentos.find((m) => m.descricaoOriginal.startsWith("PIX"))!;
    const fatura = parsed.movimentos.find((m) => m.descricaoOriginal.includes("FATURA PAGA"))!;
    const rend = parsed.movimentos.find((m) => m.descricaoOriginal.includes("REND PAGO"))!;
    expect(pix.semantica).toBe("PIX");
    expect(fatura.semantica).toBe("CARD_PAYMENT");
    expect(fatura.valor).toBeLessThan(0);
    expect(rend.semantica).toBe("INVESTMENT_INCOME");
    expect(rend.valor).toBe(0.12);
  });

  it("fecha a auditoria: abertura + movimentos = cada saldo do dia", () => {
    let saldo = parsed.saldoInicial ?? 0;
    for (const c of parsed.checkpoints ?? []) {
      saldo = parsed.movimentos
        .filter((m) => m.data! <= c.data)
        .reduce((a, m) => a + m.valor, parsed.saldoInicial ?? 0);
      expect(Number((saldo - c.saldo).toFixed(2))).toBe(0);
    }
  });
});

describe("segundo PDF (período sobreposto)", () => {
  const segundo: PdfLine[] = [
    ...cabecalho.slice(0, 2),
    {
      y: 7,
      page: 1,
      text: "período de visualização: 18/05/2026 até 16/08/2026",
      cells: [{ x: 40, text: "período de visualização: 18/05/2026 até 16/08/2026" }],
    },
    cabecalho[3]!,
    linha("17/05/2026", "SALDO DO DIA", undefined, "94,42"),
    linha("18/05/2026", "PIX TRANSF Rodrigo18/05", "5.200,00"),
    linha("18/05/2026", "FATURA PAGA ITAU GOLD", "-5.102,25"),
    linha("18/05/2026", "SALDO DO DIA", undefined, "192,17"),
    linha("17/06/2026", "PIX TRANSF Rodrigo17/06", "5.500,00"),
    linha("17/06/2026", "REND PAGO APLIC AUT MAIS", "0,12"),
    linha("17/06/2026", "FATURA PAGA ITAU GOLD", "-5.571,48"),
    linha("17/06/2026", "SALDO DO DIA", undefined, "120,81"),
    linha("17/07/2026", "FATURA PAGA ITAU GOLD", "-116,66"),
    linha("17/07/2026", "SALDO DO DIA", undefined, "4,15"),
    linha("13/08/2026", "REND PAGO APLIC AUT MAIS", "0,01"),
    linha("13/08/2026", "SALDO DO DIA", undefined, "4,16"),
  ];
  const parsed = parseItauBankStatementLines(segundo);

  it("lê período, abertura e checkpoints próprios", () => {
    expect(parsed.periodoInicio).toBe("2026-05-18");
    expect(parsed.periodoFim).toBe("2026-08-16");
    expect(parsed.saldoInicial).toBe(94.42);
    expect((parsed.checkpoints ?? []).map((c) => c.saldo)).toEqual([192.17, 120.81, 4.15, 4.16]);
  });

  it("deduplica movimentos já lidos no primeiro extrato", () => {
    const jaExistentes = buildExistingMovementKeys(
      parseItauBankStatementLines(primeiroPdf).movimentos.map((m) => ({
        data_movimento: m.data,
        valor: m.valor,
        descricao_original: m.descricaoOriginal,
      })),
    );
    const duplicados = marcarDuplicados(parsed.movimentos, jaExistentes);
    const novos = parsed.movimentos.filter((_, i) => !duplicados[i]);
    expect(novos.map((m) => m.descricaoOriginal)).toEqual([
      "FATURA PAGA ITAU GOLD",
      "REND PAGO APLIC AUT MAIS",
    ]);
  });

  it("reutiliza checkpoints idênticos já existentes", () => {
    const existentes = [
      { data: "2026-05-18", saldo: 192.17 },
      { data: "2026-06-17", saldo: 120.81 },
    ];
    expect(checkpointsInéditos(parsed.checkpoints ?? [], existentes).map((c) => c.data)).toEqual([
      "2026-07-17",
      "2026-08-13",
    ]);
  });
});
