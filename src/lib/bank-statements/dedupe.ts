/**
 * DEDUPLICAÇÃO ENTRE EXTRATOS SOBREPOSTOS.
 *
 * Dois PDFs do mesmo banco quase sempre têm um trecho em comum (ex.: 18/05 a
 * 30/06). Cada documento continua existindo como importação independente —
 * apenas os efeitos no ledger e os checkpoints não podem ser criados de novo.
 *
 * REGRA FUNDAMENTAL (pós-parser):
 * depois que o ParsedBankStatement é válido, esta camada NÃO pode reinterpretar
 * a existência econômica de um movimento. Ela só CLASSIFICA.
 *
 * Identidade de linha, em ordem de prioridade:
 *   1. `sourceId` do parser — identidade primária e estável do documento;
 *   2. matching composto (conta + data + valor + sentido + documento/lote +
 *      descrição normalizada) + `occurrenceIndex`.
 *
 * `occurrenceIndex` existe porque movimentos legítimos se repetem: duas saídas
 * de R$ 54,61 no mesmo dia, com a mesma descrição, são DOIS eventos. Uma chave
 * rígida de data+valor+descrição elimina repetição legítima e por isso nunca
 * pode ser usada sozinha.
 *
 * Nada aqui apaga registro: a duplicata apenas nasce com a ação IGNORE — e
 * somente quando existe um ALVO CONCRETO comprovado.
 */
import type { ParsedBankMovement } from "./types";
import { normalizeDescricao } from "@/lib/card-statement-parsers/generic";

export type MovementIdentity = {
  data: string | null;
  valor: number | string | null;
  descricao: string | null;
  documentNumber?: string | null;
  lot?: string | null;
};

/**
 * Chave composta de um movimento — NUNCA é identidade única por si só.
 * A identidade só se fecha com o `occurrenceIndex` (ver `occurrenceKey`).
 */
export function movementKey(m: MovementIdentity) {
  const data = m.data ?? "";
  const valor = Number(m.valor ?? 0).toFixed(2);
  const direcao = Number(m.valor ?? 0) < 0 ? "OUT" : "IN";
  const doc = (m.documentNumber ?? "").trim();
  const lote = (m.lot ?? "").trim();
  const descricao = normalizeDescricao(m.descricao ?? "").slice(0, 40);
  return `${data}|${valor}|${direcao}|${doc}|${lote}|${descricao}`;
}

/** Campos comparados pelo matching composto — exibidos no rastro do dedupe. */
export const DEDUPE_FIELDS = [
  "bank_account_id",
  "postingDate",
  "amount",
  "direction",
  "documentNumber",
  "lot",
  "normalizedDescription",
] as const;

/** Chave completa: composição + ordinal da ocorrência dentro da mesma chave. */
export function occurrenceKey(m: MovementIdentity, occurrenceIndex: number) {
  return `${movementKey(m)}#${occurrenceIndex}`;
}

export type ExistingMovement = {
  id?: string | null;
  data_movimento: string | null;
  valor: number | string;
  descricao_original: string;
  documentNumber?: string | null;
  lot?: string | null;
  source_id?: string | null;
};

export type ExistingIndex = {
  /** occurrenceKey → id do item já existente (alvo concreto do dedupe). */
  porOcorrencia: Map<string, string>;
  /** sourceId do parser → id do item já existente. */
  porSourceId: Map<string, string>;
};

/** Índice das linhas já importadas nesta conta, com ordinal de ocorrência. */
export function buildExistingMovementIndex(existentes: ExistingMovement[]): ExistingIndex {
  const contagem = new Map<string, number>();
  const porOcorrencia = new Map<string, string>();
  const porSourceId = new Map<string, string>();
  existentes.forEach((e, i) => {
    const base = movementKey({
      data: e.data_movimento,
      valor: e.valor,
      descricao: e.descricao_original,
      documentNumber: e.documentNumber ?? null,
      lot: e.lot ?? null,
    });
    const occ = contagem.get(base) ?? 0;
    contagem.set(base, occ + 1);
    porOcorrencia.set(`${base}#${occ}`, e.id ?? `existing-${i}`);
    if (e.source_id) porSourceId.set(e.source_id, e.id ?? `existing-${i}`);
  });
  return { porOcorrencia, porSourceId };
}

export type DedupeDecision = {
  ordem: number;
  sourceId: string | null;
  occurrenceIndex: number;
  status: "NEW" | "ALREADY_EXISTS";
  duplicado: boolean;
  /** Obrigatório quando duplicado: sem alvo concreto não existe duplicata. */
  matchedTargetId: string | null;
  reason: string;
  fieldsCompared: string[];
  confidence: number;
};

/**
 * Classifica cada linha do extrato contra o que já foi importado nesta conta.
 * Não descarta nada por semântica textual e nunca altera valor, data ou sentido.
 */
export function classificarDuplicados(
  movimentos: ParsedBankMovement[],
  existentes: ExistingIndex,
  sourceIds?: (string | null)[],
): DedupeDecision[] {
  const contagem = new Map<string, number>();
  return movimentos.map((m, i) => {
    const identidade: MovementIdentity = {
      data: m.data,
      valor: m.valor,
      descricao: m.descricaoOriginal,
      documentNumber: m.documentNumber ?? null,
      lot: m.lot ?? null,
    };
    const base = movementKey(identidade);
    const occ = contagem.get(base) ?? 0;
    contagem.set(base, occ + 1);
    const sourceId = sourceIds?.[i] ?? null;

    // 1. IDENTIDADE PRIMÁRIA: o mesmo sourceId já foi importado.
    const porSource = sourceId ? existentes.porSourceId.get(sourceId) ?? null : null;
    if (porSource) {
      return {
        ordem: i,
        sourceId,
        occurrenceIndex: occ,
        status: "ALREADY_EXISTS",
        duplicado: true,
        matchedTargetId: porSource,
        reason: "Mesmo sourceId já importado nesta conta (reimportação do mesmo documento).",
        fieldsCompared: ["sourceId"],
        confidence: 100,
      };
    }

    // 2. MATCHING COMPOSTO + ordinal da ocorrência.
    const alvo = existentes.porOcorrencia.get(`${base}#${occ}`) ?? null;
    if (alvo) {
      return {
        ordem: i,
        sourceId,
        occurrenceIndex: occ,
        status: "ALREADY_EXISTS",
        duplicado: true,
        matchedTargetId: alvo,
        reason: `Movimento já lido em outro extrato desta conta (ocorrência ${occ + 1}).`,
        fieldsCompared: [...DEDUPE_FIELDS],
        confidence: 90,
      };
    }

    return {
      ordem: i,
      sourceId,
      occurrenceIndex: occ,
      status: "NEW",
      duplicado: false,
      matchedTargetId: null,
      reason:
        occ > 0
          ? `Repetição legítima: ${occ + 1}ª ocorrência do mesmo valor/dia/descrição neste documento.`
          : "Sem correspondência em extratos já importados.",
      fieldsCompared: [...DEDUPE_FIELDS],
      confidence: 0,
    };
  });
}

/** Compatibilidade: quais movimentos já foram lidos em outro documento. */
export function marcarDuplicados(
  movimentos: ParsedBankMovement[],
  jaExistentes: ExistingIndex | Set<string>,
  sourceIds?: (string | null)[],
): boolean[] {
  const index: ExistingIndex =
    jaExistentes instanceof Set
      ? {
          porOcorrencia: new Map([...jaExistentes].map((k) => [`${k}#0`, k])),
          porSourceId: new Map(),
        }
      : jaExistentes;
  return classificarDuplicados(movimentos, index, sourceIds).map((d) => d.duplicado);
}

/** Checkpoints inéditos: mesma conta + mesma data + mesmo saldo é reutilizado. */
export function checkpointsInéditos<T extends { data: string; saldo: number }>(
  checkpoints: T[],
  existentes: Array<{ data: string; saldo: number }>,
): T[] {
  const chave = (c: { data: string; saldo: number }) => `${c.data}|${c.saldo.toFixed(2)}`;
  const jaExiste = new Set(existentes.map(chave));
  const novos: T[] = [];
  for (const c of checkpoints) {
    const k = chave(c);
    if (jaExiste.has(k)) continue;
    jaExiste.add(k);
    novos.push(c);
  }
  return novos;
}
