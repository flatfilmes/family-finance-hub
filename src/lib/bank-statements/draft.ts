/**
 * Rascunho de revisão de extrato.
 *
 * A leitura do PDF acontece no navegador e o resultado fica apenas aqui até o
 * usuário confirmar a revisão na página completa. Nada é gravado no banco
 * antes da confirmação — este rascunho existe só para levar o resultado da
 * leitura do diálogo de upload para a página /bancos/:id/extratos/revisar.
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

const CHAVE = "ff.extrato-rascunho";
let memoria: StatementDraft | null = null;

export function saveStatementDraft(draft: StatementDraft) {
  memoria = draft;
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(draft));
  } catch {
    /* sessão indisponível: o rascunho segue em memória */
  }
}

export function loadStatementDraft(accountId: string): StatementDraft | null {
  if (memoria?.accountId === accountId) return memoria;
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const draft = JSON.parse(bruto) as StatementDraft;
    return draft.accountId === accountId ? draft : null;
  } catch {
    return null;
  }
}

export function clearStatementDraft() {
  memoria = null;
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}

/** Último rascunho lido nesta sessão, independente da conta (uso: diagnóstico). */
export function loadLatestStatementDraft(): StatementDraft | null {
  if (memoria) return memoria;
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as StatementDraft) : null;
  } catch {
    return null;
  }
}
