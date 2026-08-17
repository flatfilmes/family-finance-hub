/**
 * ENGINE ÚNICA DE RECONCILIAÇÃO (Fase 3D).
 *
 * Todo candidato — venha de PDF de extrato, PDF de fatura, print do app ou
 * foto de comprovante — passa exatamente por este caminho. Não existe
 * "reconciliação do banco" e "reconciliação do cartão" com regras diferentes:
 * existe UMA engine e contextos distintos de entrada.
 *
 * Princípios inegociáveis:
 * - Evidência NÃO cria dinheiro. Ela só sugere; a revisão humana decide.
 * - Reimportar a mesma evidência é IDEMPOTENTE (lineage vence qualquer score).
 * - Repetições legítimas (duas compras iguais no mesmo dia) NUNCA são fundidas:
 *   cada registro existente é consumido no máximo uma vez.
 * - Ambiguidade real vira CONFLICT — jamais um palpite silencioso.
 * - Período já coberto por outra evidência vira NEW_IN_OVERLAP: exige revisão
 *   antes de virar fato novo, evitando duplicar meses sobrepostos.
 */
import { semAcento } from "@/lib/card-statement-parsers/generic";
import type {
  CandidateResolution,
  CoveredPeriod,
  EvidenceMatchStatus,
  ExistingEconomicRecord,
  FinancialCandidateEvent,
  ReconciliationSummary,
  UnifiedReconciliationResult,
} from "./types";

const arred = (n: number) => Math.round(n * 100) / 100;

export function normalizarDescricao(texto: string) {
  return semAcento(texto)
    .toUpperCase()
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(COMPRA|CARTAO|DEBITO|CREDITO|PARC|PARCELA|PAGAMENTO|PIX|TED|DOC)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade por sobreposição de tokens (Jaccard) — 0 a 1. */
export function similaridade(a: string, b: string) {
  const ta = new Set(normalizarDescricao(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizarDescricao(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

const diasEntre = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const dentro = (data: string, inicio: string, fim: string) => data >= inicio && data <= fim;

/** Contexto do registro existente precisa bater com o do candidato. */
function mesmoContexto(c: FinancialCandidateEvent, r: ExistingEconomicRecord) {
  if (c.creditCardId && r.creditCardId && c.creditCardId !== r.creditCardId) return false;
  if (c.bankAccountId && r.bankAccountId && c.bankAccountId !== r.bankAccountId) return false;
  return true;
}

export type ScoreDetalhe = { score: number; motivos: string[] } | null;

/** Pontua um par candidato × registro existente. `null` = incompatível. */
export function pontuar(c: FinancialCandidateEvent, r: ExistingEconomicRecord): ScoreDetalhe {
  if (!mesmoContexto(c, r)) return null;
  if (c.direction !== r.direction) return null;

  const motivos: string[] = [];
  let score = 0;

  const dif = Math.abs(arred(Math.abs(c.amount) - Math.abs(r.amount)));
  if (dif <= 0.01) {
    score += 5;
    motivos.push("valor idêntico");
  } else if (dif <= Math.max(0.05, Math.abs(c.amount) * 0.01)) {
    score += 3;
    motivos.push("valor equivalente");
  } else {
    return null;
  }

  const dataCandidato = c.eventDate ?? c.postingDate;
  if (dataCandidato && r.date) {
    const d = diasEntre(dataCandidato, r.date);
    if (d === 0) {
      score += 4;
      motivos.push("mesma data");
    } else if (d <= 2) {
      score += 3;
      motivos.push(`${d} dia(s) de diferença`);
    } else if (d <= 5) {
      score += 2;
      motivos.push(`${d} dias de diferença`);
    } else if (d <= 10) {
      score += 1;
      motivos.push(`${d} dias de diferença`);
    } else {
      return null;
    }
  } else {
    motivos.push("sem data comparável");
  }

  const sim = similaridade(c.description, r.description);
  if (sim >= 0.8) {
    score += 3;
    motivos.push("descrição praticamente igual");
  } else if (sim >= 0.5) {
    score += 2;
    motivos.push("descrição semelhante");
  } else if (sim >= 0.25) {
    score += 1;
    motivos.push("descrição parcialmente semelhante");
  }

  if (c.cardLast4 && r.cardLast4) {
    if (c.cardLast4 === r.cardLast4) {
      score += 2;
      motivos.push(`final ${c.cardLast4}`);
    } else {
      score -= 3;
      motivos.push("final do cartão diferente");
    }
  }

  if (c.installmentCurrent && r.installmentCurrent) {
    if (c.installmentCurrent === r.installmentCurrent && c.installmentTotal === r.installmentTotal) {
      score += 1;
      motivos.push("mesma parcela");
    } else {
      score -= 2;
      motivos.push("parcela diferente");
    }
  }

  return score <= 0 ? null : { score, motivos };
}

function statusPorScore(score: number): EvidenceMatchStatus {
  if (score >= 10) return "EXACT_MATCH";
  if (score >= 7) return "STRONG_MATCH";
  if (score >= 4) return "POSSIBLE_MATCH";
  return "NEW_ITEM";
}

const ACAO: Record<EvidenceMatchStatus, string> = {
  EXACT_MATCH: "Nenhum evento novo: apenas vincularia esta evidência ao registro existente.",
  STRONG_MATCH: "Vincularia como o mesmo evento econômico após confirmação.",
  POSSIBLE_MATCH: "Exige revisão humana antes de conciliar ou criar.",
  NEW_ITEM: "Criaria 1 evento econômico novo a partir desta evidência.",
  NEW_IN_OVERLAP: "Período já coberto por outra evidência — exige revisão antes de criar.",
  CONFLICT: "Bloqueado: dois registros existentes disputam o mesmo lançamento.",
  IGNORED: "Ignorado na revisão.",
};

export function reconcileFinancialCandidates(input: {
  candidates: FinancialCandidateEvent[];
  existing: ExistingEconomicRecord[];
  /** Períodos já cobertos por outras evidências confirmadas do mesmo contexto. */
  coveredPeriods?: CoveredPeriod[];
}): UnifiedReconciliationResult {
  const covered = input.coveredPeriods ?? [];
  /** Consumo estrito: um registro existente atende no máximo um candidato. */
  const consumidos = new Set<string>();

  const resolutions: CandidateResolution[] = input.candidates.map((c) => {
    const chave = (r: ExistingEconomicRecord) => `${r.kind}:${r.id}`;

    // 1. LINHAGEM vence qualquer heurística: a mesma evidência já foi ingerida.
    const porLinhagem = input.existing.find(
      (r) =>
        r.lineageItemKeys?.includes(c.sourceItemKey) ||
        (r.lineageEvidenceIds?.includes(c.evidenceId) &&
          Math.abs(arred(Math.abs(r.amount) - Math.abs(c.amount))) <= 0.01 &&
          r.direction === c.direction &&
          !consumidos.has(chave(r))),
    );
    if (porLinhagem) {
      consumidos.add(chave(porLinhagem));
      return {
        candidate: c,
        status: "EXACT_MATCH",
        score: 12,
        reason: "Esta evidência já originou este registro (reimportação idempotente).",
        actionPreview: ACAO.EXACT_MATCH,
        matched: { kind: porLinhagem.kind, id: porLinhagem.id },
        runnerUp: null,
      };
    }

    const candidatos = input.existing
      .filter((r) => !consumidos.has(chave(r)))
      .map((r) => ({ r, p: pontuar(c, r) }))
      .filter((x): x is { r: ExistingEconomicRecord; p: { score: number; motivos: string[] } } => !!x.p)
      .sort((a, b) => b.p.score - a.p.score);

    const melhor = candidatos[0] ?? null;
    const segundo = candidatos[1] ?? null;

    if (!melhor) {
      const overlap = (() => {
        const data = c.eventDate ?? c.postingDate;
        if (!data) return null;
        return covered.find((p) => p.evidenceId !== c.evidenceId && dentro(data, p.inicio, p.fim)) ?? null;
      })();
      const status: EvidenceMatchStatus = overlap ? "NEW_IN_OVERLAP" : "NEW_ITEM";
      return {
        candidate: c,
        status,
        score: 0,
        reason: overlap
          ? `Sem correspondência, porém a data cai em período já coberto por ${overlap.rotulo}.`
          : "Nenhum evento econômico equivalente encontrado no período.",
        actionPreview: ACAO[status],
        matched: null,
        runnerUp: null,
      };
    }

    const empate = !!segundo && segundo.p.score === melhor.p.score && melhor.p.score >= 6;
    if (empate) {
      return {
        candidate: c,
        status: "CONFLICT",
        score: melhor.p.score,
        reason: `Dois registros existentes com a mesma pontuação (${melhor.r.kind} e ${segundo.r.kind}).`,
        actionPreview: ACAO.CONFLICT,
        matched: null,
        runnerUp: { kind: segundo.r.kind, id: segundo.r.id, score: segundo.p.score },
      };
    }

    let status = statusPorScore(melhor.p.score);
    // Fonte de baixa confiança (foto/print solto) nunca fecha sozinha.
    if (status === "EXACT_MATCH" && c.sourceConfidence === "LOW") status = "STRONG_MATCH";
    if (status === "EXACT_MATCH" && c.sourceConfidence === "MEDIUM" && melhor.p.score < 11)
      status = "STRONG_MATCH";

    if (status === "NEW_ITEM") {
      const data = c.eventDate ?? c.postingDate;
      const overlap = data
        ? covered.find((p) => p.evidenceId !== c.evidenceId && dentro(data, p.inicio, p.fim))
        : null;
      if (overlap) status = "NEW_IN_OVERLAP";
      return {
        candidate: c,
        status,
        score: melhor.p.score,
        reason: `Melhor candidato insuficiente (${melhor.p.motivos.join(" · ")}).`,
        actionPreview: ACAO[status],
        matched: null,
        runnerUp: segundo ? { kind: segundo.r.kind, id: segundo.r.id, score: segundo.p.score } : null,
      };
    }

    consumidos.add(chave(melhor.r));
    return {
      candidate: c,
      status,
      score: melhor.p.score,
      reason: melhor.p.motivos.join(" · "),
      actionPreview: ACAO[status],
      matched: { kind: melhor.r.kind, id: melhor.r.id },
      runnerUp: segundo ? { kind: segundo.r.kind, id: segundo.r.id, score: segundo.p.score } : null,
    };
  });

  const conta = (s: EvidenceMatchStatus) => resolutions.filter((r) => r.status === s).length;
  const summary: ReconciliationSummary = {
    total: resolutions.length,
    exactMatch: conta("EXACT_MATCH"),
    strongMatch: conta("STRONG_MATCH"),
    possibleMatch: conta("POSSIBLE_MATCH"),
    newItem: conta("NEW_ITEM"),
    newInOverlap: conta("NEW_IN_OVERLAP"),
    conflict: conta("CONFLICT"),
    ignored: conta("IGNORED"),
    totalNovo: arred(
      resolutions
        .filter((r) => r.status === "NEW_ITEM" || r.status === "NEW_IN_OVERLAP")
        .reduce((a, r) => a + Math.abs(r.candidate.amount), 0),
    ),
  };

  const blockers: string[] = [];
  if (summary.conflict > 0) blockers.push(`${summary.conflict} lançamento(s) em CONFLICT.`);
  if (summary.possibleMatch > 0) blockers.push(`${summary.possibleMatch} lançamento(s) em POSSIBLE_MATCH.`);
  if (summary.newInOverlap > 0)
    blockers.push(`${summary.newInOverlap} lançamento(s) em período já coberto por outra evidência.`);

  const tudoJaExiste =
    summary.total > 0 && summary.exactMatch === summary.total;

  const status: UnifiedReconciliationResult["status"] = tudoJaExiste
    ? "ALREADY_INGESTED"
    : summary.conflict > 0
      ? "BLOCKED"
      : summary.possibleMatch > 0 || summary.newInOverlap > 0
        ? "REVIEW_REQUIRED"
        : "PASS";

  return { status, resolutions, summary, blockers, overlaps: covered };
}
