/**
 * PROVA ANTES DO REPARO — SOMENTE LEITURA, SOMENTE SIMULAÇÃO.
 *
 * Duas perguntas, nenhuma gravação:
 *
 *  1. Nas datas onde o documento repete o mesmo valor, QUAL linha exata existe
 *     no ledger e QUAL está ausente — com documentNumber, sourceId, id do item
 *     e id da transação. Só a linha AUSENTE pode ser candidata a reparo.
 *  2. Como a diferença de um único período se propaga mês a mês até hoje, e o
 *     que aconteceria com cada mês se a linha ausente voltasse.
 */
import type { StatementLineage } from "./lineage";
import { documentEvidenceFor } from "./document-evidence";
import type { PersistenceRepairPlan } from "./persistence-repair";

const round = (n: number) => Math.round(n * 100) / 100;

export type EvidenceLine = {
  sourceId: string;
  itemId: string;
  ordem: number;
  data: string | null;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  documentNumber: string | null;
  rawText: string | null;
  ledgerTransactionId: string | null;
  reviewAction: string;
  matchStatus: string;
  finalStatus: string;
  /** Existe no ledger hoje? */
  presente: boolean;
  /** Efeito no saldo se for restaurada (0 quando já existe). */
  deltaSaldo: number;
};

export type CollisionGroup = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  data: string;
  valorAbsoluto: number;
  linhas: EvidenceLine[];
  presentes: number;
  ausentes: number;
};

export type PropagationRow = {
  rotulo: string;
  periodEnd: string | null;
  saldoDocumento: number | null;
  saldoSistemaAntes: number | null;
  saldoSistemaDepois: number | null;
  diferencaAntes: number | null;
  diferencaDepois: number | null;
  /** Este é o período onde a linha ausente seria restaurada. */
  origemDaDiferenca: boolean;
};

export type RepairProof = {
  grupos: CollisionGroup[];
  propagacao: PropagationRow[];
  /** Saldo com que o próximo período começaria depois do reparo. */
  saldoInicialSeguinte: number | null;
};

/** Agrupa linhas do mesmo dia e mesmo valor absoluto onde alguma está ausente. */
export function buildCollisionGroups(lineages: StatementLineage[]): CollisionGroup[] {
  const grupos: CollisionGroup[] = [];

  for (const lin of lineages) {
    const porChave = new Map<string, typeof lin.rows>();
    for (const r of lin.rows) {
      if (!r.postingDate) continue;
      const chave = `${r.postingDate}|${r.amount.toFixed(2)}`;
      const atual = porChave.get(chave) ?? [];
      atual.push(r);
      porChave.set(chave, atual);
    }

    for (const [chave, linhasDoGrupo] of porChave) {
      const temAusente = linhasDoGrupo.some((r) => !r.ledgerTransactionId);
      if (!temAusente || linhasDoGrupo.length < 2) continue;
      const [data, valor] = chave.split("|");

      const linhas: EvidenceLine[] = linhasDoGrupo
        .slice()
        .sort((a, b) => a.ordem - b.ordem)
        .map((r) => {
          const doc = documentEvidenceFor(lin.periodStart, r.ordem);
          const presente = !!r.ledgerTransactionId;
          return {
            sourceId: r.sourceId,
            itemId: r.itemId,
            ordem: r.ordem,
            data: r.postingDate,
            descricao: r.description,
            valor: r.amount,
            direcao: r.direction,
            documentNumber: doc?.documentNumber ?? null,
            rawText: doc?.rawText ?? null,
            ledgerTransactionId: r.ledgerTransactionId,
            reviewAction: r.reviewAction,
            matchStatus: r.reconciliationStatus,
            finalStatus: r.finalStatus,
            presente,
            deltaSaldo: presente ? 0 : r.direction === "IN" ? r.amount : -r.amount,
          };
        });

      grupos.push({
        importId: lin.importId,
        nomeArquivo: lin.nomeArquivo,
        periodStart: lin.periodStart,
        data: data as string,
        valorAbsoluto: Number(valor),
        linhas,
        presentes: linhas.filter((l) => l.presente).length,
        ausentes: linhas.filter((l) => !l.presente).length,
      });
    }
  }

  return grupos.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Propagação mês a mês: a diferença de um período não morre nele — ela vive em
 * todos os saldos seguintes até hoje.
 */
export function buildPropagation(plan: PersistenceRepairPlan): {
  linhas: PropagationRow[];
  saldoInicialSeguinte: number | null;
} {
  let acumulado = 0;
  const linhas: PropagationRow[] = plan.periodos.map((p) => {
    acumulado = round(acumulado + p.deltaPeriodo);
    const documento = p.saldoDocumento;
    // O sistema está acima do banco exatamente pelo que deixou de sair.
    const antes = documento === null ? null : round(documento - acumulado);
    return {
      rotulo: p.rotulo,
      periodEnd: p.periodEnd,
      saldoDocumento: documento,
      saldoSistemaAntes: antes,
      saldoSistemaDepois: documento,
      diferencaAntes: documento === null || antes === null ? null : round(antes - documento),
      diferencaDepois: documento === null ? null : 0,
      origemDaDiferenca: p.restauradas.length > 0,
    };
  });

  const ultimo = linhas[linhas.length - 1];
  return { linhas, saldoInicialSeguinte: ultimo?.saldoSistemaDepois ?? null };
}

export function buildRepairProof(input: {
  lineages: StatementLineage[];
  plan: PersistenceRepairPlan;
}): RepairProof {
  const { linhas, saldoInicialSeguinte } = buildPropagation(input.plan);
  return {
    grupos: buildCollisionGroups(input.lineages),
    propagacao: linhas,
    saldoInicialSeguinte,
  };
}
