/**
 * Passagem de arquivo entre telas do diagnóstico (somente memória).
 *
 * O diagnóstico deixou de ser modal: quem clica em "Ver diagnóstico" navega
 * para a página dedicada. Para que a página consiga rodar o parser REAL sobre
 * o mesmo PDF, o arquivo fica guardado aqui em memória — nada é persistido,
 * nem em storage, nem no banco.
 */
import type { DiagnosticSource } from "@/lib/pdf-diagnostic/diagnostic-types";

type Handoff = { file: File; source: DiagnosticSource };

let atual: Handoff | null = null;

export function setDiagnosticFile(file: File, source: DiagnosticSource = "BANK_STATEMENT") {
  atual = { file, source };
}

/** Lê o arquivo pendente sem consumi-lo (permite "Rodar novamente"). */
export function peekDiagnosticFile(): Handoff | null {
  return atual;
}

export function clearDiagnosticFile() {
  atual = null;
}
