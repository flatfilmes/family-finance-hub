/**
 * PERÍODO OFICIAL DE UM EXTRATO.
 *
 * Regra única: o mês de um extrato vem do PERÍODO do documento — nunca da data
 * do "Saldo Anterior", nunca da primeira/última movimentação e nunca do
 * primeiro checkpoint.
 *
 * O "Saldo Anterior" é apenas o OPENING_CHECKPOINT: ele fica FORA do período
 * (é o saldo do último dia anterior ao extrato) e não conta como saldo diário.
 *
 * Importações legadas com metadados inválidos devem ser reparadas nos próprios
 * campos `periodo_inicio`/`periodo_fim`. Checkpoints jamais reconstroem ou
 * substituem a identidade temporal de um extrato.
 */

export type CheckpointInput = {
  importId?: string | null;
  data: string;
  saldo: number;
};

export type StatementPeriodOrigin = "DOCUMENTO" | "INDEFINIDO";

export type ResolvedStatementPeriod = {
  inicio: string | null;
  fim: string | null;
  /** Mês que nomeia o extrato (YYYY-MM). */
  mesReferencia: string | null;
  /** Data do saldo anterior — metadata, fora do período. */
  aberturaData: string | null;
  origem: StatementPeriodOrigin;
  /** "Saldo do dia" DENTRO do período (o de abertura não entra). */
  checkpointsDiarios: { data: string; saldo: number }[];
};

const CONFERE = 0.02;

export function resolveStatementPeriod(
  imp: {
    periodo_inicio: string | null;
    periodo_fim: string | null;
    saldo_inicial: number | string | null;
  },
  checkpoints: { data: string; saldo: number }[],
): ResolvedStatementPeriod {
  const ordenados = [...checkpoints].sort((a, b) => a.data.localeCompare(b.data));
  const saldoInicial = imp.saldo_inicial === null ? null : Number(imp.saldo_inicial);

  const inicioDoc = imp.periodo_inicio;
  const fimDoc = imp.periodo_fim;
  const documentoValido = !!inicioDoc && !!fimDoc && inicioDoc <= fimDoc;

  // OPENING_CHECKPOINT: saldo inicial anterior ao início oficial do statement.
  const abertura = documentoValido
    ? [...ordenados]
        .reverse()
        .find(
          (checkpoint) =>
            checkpoint.data < inicioDoc &&
            (saldoInicial === null || Math.abs(checkpoint.saldo - saldoInicial) <= CONFERE),
        ) ?? null
    : null;
  const aberturaData = abertura?.data ?? null;
  if (documentoValido) {
    return {
      inicio: inicioDoc,
      fim: fimDoc,
      mesReferencia: inicioDoc.slice(0, 7),
      aberturaData,
      origem: "DOCUMENTO",
      checkpointsDiarios: ordenados.filter((c) => c.data >= inicioDoc && c.data <= fimDoc),
    };
  }
  return {
    inicio: null,
    fim: null,
    mesReferencia: null,
    aberturaData: null,
    origem: "INDEFINIDO",
    checkpointsDiarios: [],
  };
}

/** Agrupa checkpoints por importação, preservando a ordem cronológica. */
export function groupCheckpointsByImport(checkpoints: CheckpointInput[]) {
  const mapa = new Map<string, { data: string; saldo: number }[]>();
  for (const c of checkpoints) {
    if (!c.importId) continue;
    mapa.set(c.importId, [...(mapa.get(c.importId) ?? []), { data: c.data, saldo: c.saldo }]);
  }
  for (const [k, v] of mapa) mapa.set(k, v.sort((a, b) => a.data.localeCompare(b.data)));
  return mapa;
}
