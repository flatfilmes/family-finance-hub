/**
 * Visibilidade do Modo diagnóstico PDF.
 *
 * Continua restrito a ADMIN. Além de desenvolvimento e família demo, aceita
 * uma flag interna persistida no navegador — necessária agora que o sistema
 * roda com dados reais e ainda precisamos evoluir os parsers.
 *
 * Para ligar: abrir qualquer página com ?diagnostico=1 (e ?diagnostico=0 desliga).
 */
const CHAVE = "ff.pdf-diagnostico";

export function pdfDiagnosticFlagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("diagnostico");
    if (param === "1") localStorage.setItem(CHAVE, "1");
    if (param === "0") localStorage.removeItem(CHAVE);
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

/** Liga/desliga a flag interna sem precisar da query string. */
export function setPdfDiagnosticFlag(ativo: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (ativo) localStorage.setItem(CHAVE, "1");
    else localStorage.removeItem(CHAVE);
  } catch {
    /* armazenamento indisponível */
  }
}

