/**
 * PRÉ-CONDIÇÃO DO REPARO — DRY RUN, SOMENTE LEITURA.
 *
 * Duas linhas do mesmo dia, mesmo valor e mesma descrição podem ser dois
 * movimentos econômicos legítimos e diferentes (ex.: documentos 40201 e
 * 40202). Por isso a pré-condição NUNCA usa equivalência genérica
 * (data + valor + sentido + descrição) para dizer que o alvo já existe.
 *
 * A existência do alvo é provada apenas por identidade:
 *   1. transaction.source_id          = sourceId do item ausente
 *   2. transaction.statement_item_id  = id do item ausente
 *   3. fallback para imports antigos: conta + ocorrência do documento
 *      (occurrence_index) + data + valor + sentido, sem transação já
 *      atribuída a outra linha do mesmo grupo.
 *
 * Uma transação que pertence a outra ocorrência do mesmo grupo é reportada
 * como SIBLING_EXISTING e nunca bloqueia o reparo do alvo.
 */
import type { Transaction } from "@/lib/transactions";
import type { RepairProof, EvidenceLine } from "./repair-proof";
import type { ValidatedCandidate } from "./repair-validation";

const TOLERANCIA = 0.01;

export type PreconditionLineStatus = "MISSING_TARGET" | "EXISTS_AS_SIBLING" | "UNEXPECTED_TARGET";

export type PreconditionLine = {
  status: PreconditionLineStatus;
  sourceId: string;
  itemId: string;
  occurrenceIndex: number;
  documentNumber: string | null;
  data: string | null;
  valor: number;
  direcao: "IN" | "OUT";
  descricao: string;
  transactionId: string | null;
  papel: "ALVO" | "IRMAO";
  explicacao: string;
};

export type PreconditionCheck = {
  chave: string;
  titulo: string;
  status: "PASS" | "FAIL";
  detalhe: string;
};

export type RepairPrecondition = {
  executadoEm: string;
  dryRun: true;
  accountId: string;
  repairPrecondition: "PASS" | "FAIL";
  target: {
    sourceId: string;
    statementItemId: string;
    occurrenceIndex: number;
    documentNumber: string | null;
    data: string | null;
    valor: number;
    direcao: "IN" | "OUT";
    descricao: string;
  };
  /** Transação do alvo — precisa ser null para o reparo ser legítimo. */
  targetTransaction: string | null;
  /** Ocorrências vizinhas legítimas que já existem no ledger. */
  existingSiblings: { transactionId: string; documentNumber: string | null; sourceId: string }[];
  linhas: PreconditionLine[];
  verificacoes: PreconditionCheck[];
  motivos: string[];
};

/** Roda a pré-condição do reparo sem gravar nada. */
export function buildRepairPrecondition(input: {
  accountId: string;
  candidato: ValidatedCandidate;
  proof: RepairProof;
  transactions: Transaction[];
}): RepairPrecondition {
  const { accountId, candidato } = input;
  const ledger = input.transactions.filter(
    (t) => t.bank_account_id === accountId && t.status !== "CANCELADA",
  );

  const grupo = input.proof.grupos.find((g) =>
    g.linhas.some((l) => l.sourceId === candidato.sourceId),
  );
  const alvoEvidencia = grupo?.linhas.find((l) => l.sourceId === candidato.sourceId) ?? null;
  const p = candidato.preview;
  const direcao: "IN" | "OUT" = p.tipo === "ENTRADA" ? "IN" : "OUT";

  // ---- identidade do alvo -----------------------------------------------
  const porSourceId = ledger.find((t) => t.source_id === candidato.sourceId) ?? null;
  const porItemId = ledger.find((t) => t.statement_item_id === candidato.itemId) ?? null;

  // transações já atribuídas a alguma linha do grupo (irmãs) — nunca são o alvo
  const usadasPorIrmas = new Set(
    (grupo?.linhas ?? [])
      .filter((l) => l.sourceId !== candidato.sourceId && l.ledgerTransactionId)
      .map((l) => l.ledgerTransactionId as string),
  );

  const porOcorrencia =
    porSourceId || porItemId
      ? null
      : (ledger.find(
          (t) =>
            !usadasPorIrmas.has(t.id) &&
            t.data_movimento === p.data_movimento &&
            Math.abs(Number(t.valor) - Math.abs(p.valor)) <= TOLERANCIA &&
            t.tipo === p.tipo &&
            t.occurrence_index === p.occurrence_index &&
            (t.source_id === null || t.source_id === candidato.sourceId),
        ) ?? null);

  const targetTransaction = porSourceId ?? porItemId ?? porOcorrencia;

  // ---- linhas do grupo: alvo x irmãos -----------------------------------
  const linhas: PreconditionLine[] = (grupo?.linhas ?? []).map((l) =>
    l.sourceId === candidato.sourceId
      ? linhaAlvo(l, targetTransaction?.id ?? null, candidato, direcao)
      : linhaIrma(l),
  );
  if (!grupo) {
    linhas.push(
      linhaAlvo(null, targetTransaction?.id ?? null, candidato, direcao),
    );
  }

  const existingSiblings = (grupo?.linhas ?? [])
    .filter((l) => l.sourceId !== candidato.sourceId && l.ledgerTransactionId)
    .map((l) => ({
      transactionId: l.ledgerTransactionId as string,
      documentNumber: l.documentNumber,
      sourceId: l.sourceId,
    }));

  // ---- verificações ------------------------------------------------------
  const verificacoes: PreconditionCheck[] = [];
  const check = (chave: string, titulo: string, ok: boolean, detalhe: string) =>
    verificacoes.push({ chave, titulo, status: ok ? "PASS" : "FAIL", detalhe });

  check(
    "A_SEM_TRANSACTION_POR_SOURCE_ID",
    `Nenhuma transação usa o sourceId ${candidato.sourceId}`,
    !porSourceId,
    porSourceId
      ? `A transação ${porSourceId.id} já carrega este sourceId — o item não está ausente.`
      : "Nenhuma transação do ledger carrega este sourceId.",
  );
  check(
    "B_SEM_TRANSACTION_POR_ITEM",
    `Nenhuma transação está vinculada ao item ${candidato.itemId.slice(0, 8)}…`,
    !porItemId,
    porItemId
      ? `A transação ${porItemId.id} já aponta para esta linha do extrato.`
      : "Nenhuma transação aponta para esta linha do extrato.",
  );
  check(
    "C_SEM_TRANSACTION_POR_OCORRENCIA",
    `Nenhuma transação corresponde à ocorrência ${p.occurrence_index}${
      alvoEvidencia?.documentNumber ? ` (documento ${alvoEvidencia.documentNumber})` : ""
    }`,
    !porOcorrencia,
    porOcorrencia
      ? `A transação ${porOcorrencia.id} ocupa exatamente esta ocorrência do documento.`
      : "O fallback por conta + ocorrência + data + valor + sentido não encontrou nada.",
  );
  check(
    "D_IRMAOS_NAO_BLOQUEIAM",
    "Ocorrências vizinhas existentes não bloqueiam o alvo",
    true,
    existingSiblings.length
      ? `${existingSiblings.length} ocorrência(s) legítima(s) já no ledger: ${existingSiblings
          .map((s) => `${s.documentNumber ?? s.sourceId} → ${s.transactionId.slice(0, 8)}`)
          .join(", ")}. São movimentos econômicos distintos e não provam a existência do alvo.`
      : "Nenhuma ocorrência vizinha existente neste grupo.",
  );

  const repairPrecondition: "PASS" | "FAIL" = verificacoes.every((v) => v.status === "PASS")
    ? "PASS"
    : "FAIL";

  return {
    executadoEm: new Date().toISOString(),
    dryRun: true,
    accountId,
    repairPrecondition,
    target: {
      sourceId: candidato.sourceId,
      statementItemId: candidato.itemId,
      occurrenceIndex: p.occurrence_index,
      documentNumber: alvoEvidencia?.documentNumber ?? candidato.documentNumber,
      data: p.data_movimento,
      valor: Math.abs(p.valor),
      direcao,
      descricao: p.descricao,
    },
    targetTransaction: targetTransaction?.id ?? null,
    existingSiblings,
    linhas,
    verificacoes,
    motivos: verificacoes.filter((v) => v.status === "FAIL").map((v) => v.detalhe),
  };
}

function linhaAlvo(
  l: EvidenceLine | null,
  transactionId: string | null,
  candidato: ValidatedCandidate,
  direcao: "IN" | "OUT",
): PreconditionLine {
  const p = candidato.preview;
  return {
    status: transactionId ? "UNEXPECTED_TARGET" : "MISSING_TARGET",
    sourceId: candidato.sourceId,
    itemId: candidato.itemId,
    occurrenceIndex: p.occurrence_index,
    documentNumber: l?.documentNumber ?? candidato.documentNumber,
    data: p.data_movimento,
    valor: Math.abs(p.valor),
    direcao,
    descricao: p.descricao,
    transactionId,
    papel: "ALVO",
    explicacao: transactionId
      ? "Este item já tem transação própria — não há o que restaurar."
      : "Ausente no ledger: nenhuma transação carrega este sourceId, este item ou esta ocorrência.",
  };
}

function linhaIrma(l: EvidenceLine): PreconditionLine {
  return {
    status: l.ledgerTransactionId ? "EXISTS_AS_SIBLING" : "MISSING_TARGET",
    sourceId: l.sourceId,
    itemId: l.itemId,
    occurrenceIndex: l.ordem,
    documentNumber: l.documentNumber,
    data: l.data,
    valor: Math.abs(l.valor),
    direcao: l.direcao,
    descricao: l.descricao,
    transactionId: l.ledgerTransactionId,
    papel: "IRMAO",
    explicacao: l.ledgerTransactionId
      ? "Ocorrência vizinha legítima, já existente no ledger — não é o item reparado."
      : "Outra ocorrência do grupo, também ausente.",
  };
}
