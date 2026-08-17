/**
 * GOLDEN FIXTURE — ITAU_CONTA_JAN_JUN_2026.
 *
 * Reproduz o layout real de `itau_extrato_012026.pdf` (colunas posicionais
 * data x30 · descrição x95 · valor x414 · saldo x534) e trava o contrato do
 * parser Itaú: detecção, período, abertura, 17 movimentos, 7 checkpoints
 * DAILY e saldo de referência fora do período.
 *
 * Nada aqui persiste: parser isolado, sem ledger e sem reconciliação.
 */
import { describe, expect, it } from "vitest";
import { parseItauBankStatementLines } from "./itau";
import { detectBankStatement, selectBankStatementParser } from "@/lib/bank-statements/parse";
import { ITAU_CONTA_JAN_JUN_2026 as GOLDEN } from "@/lib/bank-statements/golden";
import type { PdfLine } from "@/lib/pdf-extract";

let y = 800;

function linha(data: string, descricao: string, valor?: string, saldo?: string): PdfLine {
  const cells = [
    { x: 30, text: data },
    { x: 95, text: descricao },
    ...(valor ? [{ x: 414, text: valor }] : []),
    ...(saldo ? [{ x: 534, text: saldo }] : []),
  ].filter((c) => c.text);
  return { y: y--, page: 1, text: cells.map((c) => c.text).join(" "), cells };
}

function texto(t: string): PdfLine {
  return { y: y--, page: 1, text: t, cells: [{ x: 30, text: t }] };
}

const fixture: PdfLine[] = [
  texto("Itaú Unibanco S.A. — itau.com.br"),
  texto("extrato conta / lançamentos"),
  texto("agência: 4635 conta: 025583-1"),
  texto("período de visualização: 01/01/2026 até 30/06/2026"),
  texto("Limite da Conta 0,00"),
  texto("emitido em 16/08/2026"),
  {
    y: y--,
    page: 1,
    text: "data lançamentos valor (R$) saldo (R$)",
    cells: [
      { x: 30, text: "data" },
      { x: 95, text: "lançamentos" },
      { x: 414, text: "valor (R$)" },
      { x: 534, text: "saldo (R$)" },
    ],
  },
  // Saldo POSTERIOR ao período: referência, nunca fechamento.
  linha("13/08/2026", "SALDO DO DIA", undefined, "4,16"),
  // Abertura: imediatamente anterior ao período.
  linha("31/12/2025", "SALDO DO DIA", undefined, "0,00"),

  linha("13/02/2026", "PIX TRANSF Rodrigo13/02", "10,00"),
  linha("13/02/2026", "SALDO DO DIA", undefined, "10,00"),

  linha("18/02/2026", "PIX TRANSF Rodrigo18/02", "2.000,00"),
  linha("18/02/2026", "PIX TRANSF Maria18/02", "2.000,00"),
  linha("18/02/2026", "PIX TRANSF Empresa18/02", "4.514,88"),
  linha("18/02/2026", "PIX TRANSF Aluguel18/02", "2.604,77"),
  linha("18/02/2026", "FATURA PAGA ITAU GOLD", "-11.129,65"),
  linha("18/02/2026", "SALDO DO DIA", undefined, "0,00"),

  linha("17/03/2026", "PIX TRANSF Rodrigo17/03", "6.300,00"),
  linha("17/03/2026", "FATURA PAGA ITAU GOLD", "-6.277,05"),
  linha("17/03/2026", "SALDO DO DIA", undefined, "22,95"),

  linha("16/04/2026", "PIX TRANSF Rodrigo16/04", "4.800,00"),
  linha("16/04/2026", "SALDO DO DIA", undefined, "4.822,95"),

  linha("17/04/2026", "FATURA PAGA ITAU GOLD", "-6.228,56"),
  linha("17/04/2026", "REND PAGO APLIC AUT MAIS", "0,03"),
  linha("17/04/2026", "PIX TRANSF Maria17/04", "1.500,00"),
  linha("17/04/2026", "SALDO DO DIA", undefined, "94,42"),

  linha("18/05/2026", "PIX TRANSF Rodrigo18/05", "5.200,00"),
  linha("18/05/2026", "FATURA PAGA ITAU GOLD", "-5.102,25"),
  linha("18/05/2026", "SALDO DO DIA", undefined, "192,17"),

  linha("17/06/2026", "PIX TRANSF Rodrigo17/06", "5.500,00"),
  linha("17/06/2026", "FATURA PAGA ITAU GOLD", "-5.571,48"),
  linha("17/06/2026", "REND PAGO APLIC AUT MAIS", "0,12"),
  linha("17/06/2026", "SALDO DO DIA", undefined, "120,81"),
];

describe("Golden ITAU_CONTA_JAN_JUN_2026", () => {
  const textos = fixture.map((l) => l.text);
  const parsed = parseItauBankStatementLines(fixture);

  it("detecta ITAU e não Banco do Brasil", () => {
    const d = detectBankStatement(textos);
    expect(d.status).toBe("PASS");
    expect(d.bank).toBe("ITAU");
    expect(selectBankStatementParser(d.bank).name).toBe("ITAU_BANK_STATEMENT");
  });

  it("período vem de 'período de visualização'", () => {
    expect(parsed.periodoInicio).toBe(GOLDEN.periodStart);
    expect(parsed.periodoFim).toBe(GOLDEN.periodEnd);
  });

  it("identifica agência e conta", () => {
    expect(parsed.identificacao?.agencia).toBe(GOLDEN.agency);
    expect(parsed.identificacao?.conta).toBe(GOLDEN.account);
  });

  it("abertura 31/12/2025 = 0,00 sem mudar o período", () => {
    expect(parsed.saldoInicial).toBe(GOLDEN.opening.amount);
  });

  it("17 movimentos, nenhum fora do período", () => {
    expect(parsed.movimentos.length).toBe(GOLDEN.transactions);
    for (const m of parsed.movimentos) {
      expect(m.data! >= GOLDEN.periodStart).toBe(true);
      expect(m.data! <= GOLDEN.periodEnd).toBe(true);
    }
  });

  it("7 checkpoints DAILY e nenhum saldo fora do período entre eles", () => {
    const cps = parsed.checkpoints ?? [];
    expect(cps.length).toBe(GOLDEN.dailyCheckpoints);
    expect(cps.some((c) => c.data === GOLDEN.reference.date)).toBe(false);
    expect(cps.some((c) => c.data === GOLDEN.opening.date)).toBe(false);
    expect(cps[cps.length - 1]).toMatchObject({
      data: GOLDEN.lastHistoricalBalance.date,
      saldo: GOLDEN.lastHistoricalBalance.amount,
    });
  });

  it("saldo de 13/08/2026 é referência, nunca fechamento", () => {
    expect(parsed.saldoReferenciaAtual).toEqual({
      data: GOLDEN.reference.date,
      saldo: GOLDEN.reference.amount,
    });
    expect(parsed.saldoFinal).toBe(GOLDEN.lastHistoricalBalance.amount);
  });

  it("valores usam o sinal do próprio número — nada rejeitado por falta de (+)/(-)", () => {
    expect(parsed.rejeitados.some((r) => /sinal/i.test(r.reason ?? ""))).toBe(false);
    expect(parsed.movimentos.find((m) => m.valor === 5500)).toBeDefined();
    expect(parsed.movimentos.find((m) => m.valor === -5571.48)).toBeDefined();
    expect(parsed.movimentos.find((m) => m.valor === 0.12)).toBeDefined();
  });

  it("abertura + movimentos fecham em cada saldo do dia", () => {
    for (const c of parsed.checkpoints ?? []) {
      const soma = parsed.movimentos
        .filter((m) => m.data! <= c.data)
        .reduce((a, m) => a + m.valor, parsed.saldoInicial ?? 0);
      expect(Number((soma - c.saldo).toFixed(2))).toBe(0);
    }
  });
});
