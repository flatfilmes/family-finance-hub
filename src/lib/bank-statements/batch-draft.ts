/**
 * Rascunho do LOTE de extratos.
 *
 * Igual ao rascunho individual: a leitura acontece no navegador e nada é
 * gravado antes da confirmação. Os arquivos originais ficam apenas em memória
 * (para "tentar novamente" e diagnóstico na mesma sessão); os resultados do
 * parser são serializados na sessão para sobreviver ao recarregamento.
 */
import type { BatchFile } from "./batch";

export type StatementBatchDraft = {
  accountId: string;
  criadoEm: string;
  arquivos: BatchFile[];
};

const CHAVE = "ff.extrato-lote";
let memoria: StatementBatchDraft | null = null;
let arquivosEmMemoria = new Map<string, File>();

export function saveStatementBatchDraft(draft: StatementBatchDraft, files?: Map<string, File>) {
  memoria = draft;
  if (files) arquivosEmMemoria = files;
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(draft));
  } catch {
    /* sessão indisponível: o rascunho segue em memória */
  }
}

export function loadStatementBatchDraft(accountId: string): StatementBatchDraft | null {
  if (memoria?.accountId === accountId) return memoria;
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const draft = JSON.parse(bruto) as StatementBatchDraft;
    return draft.accountId === accountId ? draft : null;
  } catch {
    return null;
  }
}

export function getBatchFile(id: string): File | null {
  return arquivosEmMemoria.get(id) ?? null;
}

export function clearStatementBatchDraft() {
  memoria = null;
  arquivosEmMemoria = new Map();
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}
