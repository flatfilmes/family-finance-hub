/**
 * GOLDEN DATASET — BANCO DO BRASIL (Jan–Ago/2026).
 *
 * Estes são os valores oficiais conferidos nos 8 PDFs reais. Eles são o
 * contrato do parser: qualquer mudança de período, abertura, contagem de
 * movimentos ou fechamento é REGRESSÃO e derruba o teste bloqueante.
 *
 * Nada aqui toca banco de dados: é o resultado esperado do parser isolado.
 */
export type GoldenStatement = {
  monthKey: string;
  periodStart: string;
  periodEnd: string;
  opening: number;
  transactions: number;
  closing: number;
};

export const BB_GOLDEN_2026: GoldenStatement[] = [
  { monthKey: "2026-01", periodStart: "2026-01-01", periodEnd: "2026-01-31", opening: 4115.02, transactions: 26, closing: 3096.75 },
  { monthKey: "2026-02", periodStart: "2026-02-01", periodEnd: "2026-02-28", opening: 3096.75, transactions: 17, closing: 649.63 },
  { monthKey: "2026-03", periodStart: "2026-03-01", periodEnd: "2026-03-31", opening: 649.63, transactions: 18, closing: 678.57 },
  { monthKey: "2026-04", periodStart: "2026-04-01", periodEnd: "2026-04-30", opening: 678.57, transactions: 23, closing: 500.59 },
  { monthKey: "2026-05", periodStart: "2026-05-01", periodEnd: "2026-05-31", opening: 500.59, transactions: 26, closing: 91.28 },
  { monthKey: "2026-06", periodStart: "2026-06-01", periodEnd: "2026-06-30", opening: 91.28, transactions: 12, closing: 274.57 },
  { monthKey: "2026-07", periodStart: "2026-07-01", periodEnd: "2026-07-31", opening: 274.57, transactions: 19, closing: 269.64 },
  { monthKey: "2026-08", periodStart: "2026-08-01", periodEnd: "2026-08-16", opening: 269.64, transactions: 7, closing: 4795.0 },
];

export function goldenFor(monthKey: string): GoldenStatement | undefined {
  return BB_GOLDEN_2026.find((g) => g.monthKey === monthKey);
}

/**
 * GOLDEN DATASET — ITAÚ (extrato conta, Jan–Jun/2026).
 *
 * Valores conferidos no PDF real `itau_extrato_012026.pdf`. O saldo de
 * 13/08/2026 é REFERÊNCIA (posterior ao período) e nunca fechamento.
 */
export type GoldenItauStatement = {
  id: string;
  bank: "ITAU";
  agency: string;
  account: string;
  periodStart: string;
  periodEnd: string;
  opening: { date: string; amount: number };
  transactions: number;
  dailyCheckpoints: number;
  lastHistoricalBalance: { date: string; amount: number };
  closing: { date: string; amount: number; derived: boolean };
  reference: { date: string; amount: number };
};

export const ITAU_CONTA_JAN_JUN_2026: GoldenItauStatement = {
  id: "ITAU_CONTA_JAN_JUN_2026",
  bank: "ITAU",
  agency: "4635",
  account: "025583-1",
  periodStart: "2026-01-01",
  periodEnd: "2026-06-30",
  opening: { date: "2025-12-31", amount: 0 },
  transactions: 17,
  dailyCheckpoints: 7,
  lastHistoricalBalance: { date: "2026-06-17", amount: 120.81 },
  closing: { date: "2026-06-30", amount: 120.81, derived: true },
  reference: { date: "2026-08-13", amount: 4.16 },
};
