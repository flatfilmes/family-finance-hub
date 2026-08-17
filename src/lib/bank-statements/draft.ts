/**
 * Rascunho de revisão de extrato.
 *
 * A leitura do PDF acontece no navegador e o resultado fica apenas aqui até o
 * usuário confirmar a revisão na página completa. Nada é gravado no banco
 * antes da confirmação — este rascunho existe só para levar o resultado da
 * leitura do diálogo de upload para a página /bancos/:id/extratos/revisar.
 *
 * PROTEÇÃO CROSS TAB: a chave é escopada por conta e por identidade do
 * documento (`bankStatementDraft:{accountId}:{fingerprint}`). Duas abas com
 * contas — ou documentos — diferentes nunca sobrescrevem o rascunho uma da
 * outra; cada uma lê exatamente o que ela mesma produziu.
 */
import type { ParsedBankStatement } from "./types";

export type StatementDraft = {
  accountId: string;
  nomeArquivo: string;
  formato: "PDF" | "CSV" | "OFX" | "IMAGEM";
  fingerprint: string | null;
  jaImportado: boolean;
  resumo: ParsedBankStatement;
};

const PREFIXO = "bankStatementDraft";

/** Chave do rascunho: conta + identidade do documento. */
export function draftKey(accountId: string, fingerprint: string | null) {
  return `${PREFIXO}:${accountId}:${fingerprint ?? "sem-fingerprint"}`;
}

/** Ponteiro para o último rascunho lido nesta conta (nesta aba). */
function pointerKey(accountId: string) {
  return `${PREFIXO}:last:${accountId}`;
}

let memoria: StatementDraft | null = null;

export function saveStatementDraft(draft: StatementDraft) {
  memoria = draft;
  try {
    sessionStorage.setItem(draftKey(draft.accountId, draft.fingerprint), JSON.stringify(draft));
    sessionStorage.setItem(pointerKey(draft.accountId), draft.fingerprint ?? "sem-fingerprint");
  } catch {
    /* sessão indisponível: o rascunho segue em memória */
  }
}

export function loadStatementDraft(
  accountId: string,
  fingerprint?: string | null,
): StatementDraft | null {
  if (memoria?.accountId === accountId) {
    if (fingerprint === undefined || memoria.fingerprint === fingerprint) return memoria;
  }
  try {
    const fp = fingerprint ?? sessionStorage.getItem(pointerKey(accountId));
    if (fp === null) return null;
    const bruto = sessionStorage.getItem(draftKey(accountId, fp));
    if (!bruto) return null;
    const draft = JSON.parse(bruto) as StatementDraft;
    return draft.accountId === accountId ? draft : null;
  } catch {
    return null;
  }
}

export function clearStatementDraft(accountId?: string, fingerprint?: string | null) {
  const alvoConta = accountId ?? memoria?.accountId ?? null;
  const alvoFp = fingerprint !== undefined ? fingerprint : (memoria?.fingerprint ?? undefined);
  memoria = null;
  if (!alvoConta) return;
  try {
    const fp = alvoFp !== undefined ? alvoFp : sessionStorage.getItem(pointerKey(alvoConta));
    if (fp !== null && fp !== undefined) sessionStorage.removeItem(draftKey(alvoConta, fp));
    sessionStorage.removeItem(pointerKey(alvoConta));
  } catch {
    /* nada a limpar */
  }
}

/** Último rascunho lido nesta sessão, independente da conta (uso: diagnóstico). */
export function loadLatestStatementDraft(): StatementDraft | null {
  return memoria;
}
