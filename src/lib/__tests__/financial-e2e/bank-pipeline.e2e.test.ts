/**
 * FASE 3F — E2E do trilho bancário.
 * documento → roteamento → parser → canônico → validator → candidatos →
 * reconciliação → plano → confirmação → efeito econômico.
 */
import { describe, expect, it } from "vitest";
import { DOCUMENT_PARSER_REGISTRY } from "@/lib/document-parsers/registry";
import { routeDocumentParser } from "@/lib/document-parsers/routing";
import { toCanonicalStatement } from "@/lib/bank-statements/canonical";
import { validateStatement } from "@/lib/bank-statements/validate";
import { buildExistingMovementIndex, classificarDuplicados } from "@/lib/bank-statements/dedupe";
import type { ParsedBankMovement, ParsedBankStatement } from "@/lib/bank-statements/types";
import { bankMovementsToCandidates } from "@/lib/financial-evidence/candidates";
import { reconcileFinancialCandidates } from "@/lib/financial-evidence/reconcile";
import { transactionsToRecords } from "@/lib/financial-evidence/existing";
import { buildConfirmationPlan } from "@/lib/financial-evidence/plan";
import { confirmFinancialCandidates } from "@/lib/financial-evidence/confirm";
import { buildDailyBankLedger } from "@/lib/bank-ledger";
import { ACCOUNT_A, coveredPeriod, createWorld, reviewContext } from "./world";

const mov = (
  data: string,
  descricao: string,
  valor: number,
  tipo: ParsedBankMovement["tipo"] = valor >= 0 ? "ENTRADA" : "SAIDA",
): ParsedBankMovement => ({
  data,
  descricaoOriginal: descricao,
  descricaoNormalizada: descricao.toUpperCase(),
  valor,
  tipo,
});

const diaAnterior = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function extrato(input: {
  saldoInicialData?: string;
  inicio: string;
  fim: string;
  saldoInicial: number;
  saldoFinal: number;
  movimentos: ParsedBankMovement[];
  checkpoints?: Array<{ data: string; saldo: number }>;
}): ParsedBankStatement {
  return {
    parser: "EXTRATO_BANCO_DO_BRASIL_PDF",
    periodoInicio: input.inicio,
    periodoFim: input.fim,
    saldoInicial: input.saldoInicial,
    saldoInicialData: input.saldoInicialData ?? diaAnterior(input.inicio),
    saldoFinal: input.saldoFinal,
    saldoFinalData: input.fim,
    movimentos: input.movimentos,
    checkpoints: (input.checkpoints ?? []).map((c) => ({ ...c, tipo: "DAILY" as const })),
    identificacao: { banco: "BANCO DO BRASIL", agencia: "1234", conta: "56789-0", titular: "TEST USER" },
    aceitos: input.movimentos.map((m) => ({ raw: `${m.data} ${m.descricaoOriginal}`, valor: m.valor })),
    rejeitados: [],
  };
}

const BB_DOC = { textos: ["BANCO DO BRASIL", "bb.com.br", "Extrato de conta corrente", "Saldo do dia"] };

/** Extrato A do cenário: 01/08 → 17/08. */
const EXTRATO_A = extrato({
  inicio: "2026-08-01",
  fim: "2026-08-17",
  saldoInicial: 0,
  saldoFinal: 780,
  movimentos: [
    mov("2026-08-01", "DEPOSITO INICIAL", 1000),
    mov("2026-08-05", "MERCADO CENTRAL", -100),
    mov("2026-08-10", "PADARIA DO ZE", -50),
    mov("2026-08-15", "FARMACIA SAUDE", -70),
  ],
  checkpoints: [
    { data: "2026-08-01", saldo: 1000 },
    { data: "2026-08-05", saldo: 900 },
    { data: "2026-08-10", saldo: 850 },
    { data: "2026-08-15", saldo: 780 },
  ],
});

describe("E2E_BANK_STATEMENT_INITIAL_IMPORT", () => {
  it("roteia para o parser da própria instituição e nenhum outro", () => {
    const rota = routeDocumentParser({
      registry: DOCUMENT_PARSER_REGISTRY,
      contextInstitution: "BANCO_DO_BRASIL",
      documentType: "BANK_STATEMENT",
      input: BB_DOC,
    });
    expect(rota.status).toBe("PASS");
    expect(rota.parserKey).toBe("BB_STATEMENT_V1");
    expect(rota.formatVersion).toBe(1);
    expect(rota.candidates.every((c) => c.key.startsWith("BB_"))).toBe(true);

    const rotaErrada = routeDocumentParser({
      registry: DOCUMENT_PARSER_REGISTRY,
      contextInstitution: "ITAU",
      documentType: "BANK_STATEMENT",
      input: BB_DOC,
    });
    expect(rotaErrada.status).toBe("DOCUMENT_INSTITUTION_MISMATCH");
    expect(rotaErrada.parserKey).toBeNull();
  });

  it("canônico + validator: abertura, movimentos, checkpoints e fechamento conferem", () => {
    const canonical = toCanonicalStatement(EXTRATO_A, {
      statementId: "stmt-a",
      accountId: ACCOUNT_A,
      bank: "BANCO DO BRASIL",
      account: "56789-0",
    });
    const validacao = validateStatement(canonical);

    expect(canonical.openingBalance.amount).toBe(0);
    expect(canonical.transactions).toHaveLength(4);
    expect(canonical.checkpoints.filter((c) => c.type === "DAILY")).toHaveLength(4);
    expect(canonical.closingBalance.amount).toBe(780);
    expect(validacao.status).toBe("PARSED_STATEMENT_VALID");
    expect(validacao.math.difference).toBe(0);
    expect(validacao.checkpoints.every((c) => c.ok)).toBe(true);
  });

  it("confirma o extrato inicial sem efeito duplicado e o ledger fecha no saldo do documento", async () => {
    const world = createWorld();
    const candidatos = bankMovementsToCandidates(EXTRATO_A.movimentos, {
      evidenceId: "ev-extrato-a",
      bankAccountId: ACCOUNT_A,
    });
    const resultado = reconcileFinancialCandidates({ candidates: candidatos, existing: [] });
    expect(resultado.summary.newItem).toBe(4);

    const ctx = reviewContext({
      evidenceImportId: "ev-extrato-a",
      sourceType: "BANK_STATEMENT_PDF",
      bankAccountId: ACCOUNT_A,
      creditCardId: null,
      contextLabel: "Conta Principal Teste",
    });
    const planos = resultado.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctx }));
    expect(planos.every((p) => p.confirmable)).toBe(true);

    const outcomes = await confirmFinancialCandidates(planos, ctx, world.deps);
    expect(outcomes.every((o) => o.status === "CONFIRMED")).toBe(true);
    expect(world.state.transactions).toHaveLength(4);
    expect(world.netWorth()).toBe(780);

    const ledger = buildDailyBankLedger({
      accountId: ACCOUNT_A,
      transactions: world.state.transactions,
      startDate: "2026-08-01",
      endDate: "2026-08-17",
      openingBalance: 0,
      checkpoints: (EXTRATO_A.checkpoints ?? []).map((c) => ({ data: c.data, saldo: c.saldo })),
    });
    expect(ledger.closingBalance).toBe(780);
    expect(ledger.difference).toBe(0);
  });
});

describe("E2E_BANK_OVERLAPPING_STATEMENT", () => {
  const EXTRATO_B = extrato({
    inicio: "2026-08-10",
    fim: "2026-08-27",
    saldoInicial: 850,
    saldoFinal: 910,
    movimentos: [
      mov("2026-08-10", "PADARIA DO ZE", -50),
      mov("2026-08-15", "FARMACIA SAUDE", -70),
      mov("2026-08-16", "LIVRARIA CULTURA", -30),
      mov("2026-08-20", "POSTO ABC", -40),
      mov("2026-08-25", "REEMBOLSO EMPRESA", 200),
    ],
  });

  it("compara todo o período sobreposto: recria nada do que já existe", async () => {
    const world = createWorld();
    const candidatosA = bankMovementsToCandidates(EXTRATO_A.movimentos, {
      evidenceId: "ev-extrato-a",
      bankAccountId: ACCOUNT_A,
    });
    const ctxA = reviewContext({
      evidenceImportId: "ev-extrato-a",
      sourceType: "BANK_STATEMENT_PDF",
      bankAccountId: ACCOUNT_A,
      creditCardId: null,
    });
    const resA = reconcileFinancialCandidates({ candidates: candidatosA, existing: [] });
    await confirmFinancialCandidates(
      resA.resolutions.map((r) => buildConfirmationPlan({ resolution: r, context: ctxA })),
      ctxA,
      world.deps,
    );
    const transacoesAntes = world.state.transactions.length;

    const candidatosB = bankMovementsToCandidates(EXTRATO_B.movimentos, {
      evidenceId: "ev-extrato-b",
      bankAccountId: ACCOUNT_A,
    });
    const resB = reconcileFinancialCandidates({
      candidates: candidatosB,
      existing: transactionsToRecords(world.state.transactions),
      coveredPeriods: [coveredPeriod({ evidenceId: "ev-extrato-a", inicio: "2026-08-01", fim: "2026-08-17" })],
    });

    const porDescricao = Object.fromEntries(
      resB.resolutions.map((r) => [r.candidate.description, r.status]),
    );
    expect(porDescricao["PADARIA DO ZE"]).toBe("EXACT_MATCH");
    expect(porDescricao["FARMACIA SAUDE"]).toBe("EXACT_MATCH");
    expect(porDescricao["LIVRARIA CULTURA"]).toBe("NEW_IN_OVERLAP");
    expect(porDescricao["POSTO ABC"]).toBe("NEW_ITEM");
    expect(porDescricao["REEMBOLSO EMPRESA"]).toBe("NEW_ITEM");

    // Os matches existentes não podem aumentar a contagem de transações.
    const planosMatch = resB.resolutions
      .filter((r) => r.status === "EXACT_MATCH")
      .map((r) => buildConfirmationPlan({ resolution: r, context: reviewContext({
        evidenceImportId: "ev-extrato-b",
        sourceType: "BANK_STATEMENT_PDF",
        bankAccountId: ACCOUNT_A,
        creditCardId: null,
      }) }));
    expect(planosMatch.every((p) => p.action === "LINK_TRANSACTION")).toBe(true);
    const outcomes = await confirmFinancialCandidates(
      planosMatch,
      reviewContext({ evidenceImportId: "ev-extrato-b", sourceType: "BANK_STATEMENT_PDF", bankAccountId: ACCOUNT_A, creditCardId: null }),
      world.deps,
    );
    expect(outcomes.every((o) => o.status === "LINKED")).toBe(true);
    expect(world.state.transactions).toHaveLength(transacoesAntes);
  });

  it("dedupe por identidade não reintroduz linhas do período sobreposto", () => {
    const existentes = buildExistingMovementIndex(
      EXTRATO_A.movimentos.map((m, i) => ({
        id: `tx-${i}`,
        data_movimento: m.data!,
        valor: m.valor,
        descricao_original: m.descricaoOriginal,
      })),
    );
    const decisoes = classificarDuplicados(EXTRATO_B.movimentos, existentes);
    expect(decisoes.filter((d) => d.status === "ALREADY_EXISTS")).toHaveLength(2);
    expect(decisoes.filter((d) => d.status === "NEW")).toHaveLength(3);
  });
});

describe("E2E_BANK_LATE_OVERLAP_TRANSACTION", () => {
  it("lançamento retroativo dentro do período coberto é NEW_IN_OVERLAP e nunca ajusta saldo sozinho", () => {
    const world = createWorld();
    const retroativo = bankMovementsToCandidates([mov("2026-08-14", "SEGURO RESIDENCIAL", -90)], {
      evidenceId: "ev-extrato-b",
      bankAccountId: ACCOUNT_A,
    });
    const resultado = reconcileFinancialCandidates({
      candidates: retroativo,
      existing: transactionsToRecords(world.state.transactions),
      coveredPeriods: [coveredPeriod({ evidenceId: "ev-extrato-a", inicio: "2026-08-01", fim: "2026-08-17" })],
    });
    const resolucao = resultado.resolutions[0]!;
    expect(resolucao.status).toBe("NEW_IN_OVERLAP");
    expect(resultado.status).toBe("REVIEW_REQUIRED");

    const ctx = reviewContext({
      evidenceImportId: "ev-extrato-b",
      sourceType: "BANK_STATEMENT_PDF",
      bankAccountId: ACCOUNT_A,
      creditCardId: null,
    });
    // Sem decisão humana, nada é criado.
    const semDecisao = buildConfirmationPlan({ resolution: resolucao, context: ctx });
    expect(semDecisao.action).toBe("REVIEW_REQUIRED");
    expect(semDecisao.confirmable).toBe(false);

    // Com checkpoint incompatível, o bloqueio é explícito e nada é ajustado.
    const comConflito = buildConfirmationPlan({
      resolution: resolucao,
      context: ctx,
      decision: { action: "CREATE_BANK_MOVEMENT" },
      checkpointGuard: { data: "2026-08-15", saldoEsperado: 780, saldoAposCandidato: 690 },
    });
    expect(comConflito.confirmable).toBe(false);
    expect(comConflito.blockers.join(" ")).toContain("HISTORICAL_LEDGER_REVIEW_REQUIRED");
    expect(world.state.transactions).toHaveLength(0);
  });
});
