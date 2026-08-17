/**
 * Verificação LEVE de identidade da instituição no documento.
 *
 * Não escolhe parser: apenas confirma (ou contradiz) a instituição oficial
 * do contexto. Só sinais inequívocos pontuam — "agência", "conta" e
 * "saldo do dia" aparecem em todos os bancos e nunca decidem nada.
 */
import type { InstitutionCode } from "./types";

const semAcentoUpper = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

const SINAIS: Record<InstitutionCode, string[]> = {
  BANCO_DO_BRASIL: ["BANCO DO BRASIL", "BB.COM.BR", "BANCODOBRASIL", "BCO DO BRASIL"],
  ITAU: ["ITAU UNIBANCO", "ITAU.COM.BR", "BANCO ITAU", "ITAUCARD", "ITAU"],
  NUBANK: ["NUBANK", "NU PAGAMENTOS", "NUBANK.COM.BR"],
  SANTANDER: ["SANTANDER", "SANTANDER.COM.BR"],
};

export type InstitutionSignalScore = {
  institution: InstitutionCode;
  score: number;
  matched: string[];
};

export function scoreInstitutionSignals(textos: string[]): InstitutionSignalScore[] {
  const alvo = semAcentoUpper(textos.join(" \n "));
  return (Object.keys(SINAIS) as InstitutionCode[])
    .map((institution) => {
      const matched = SINAIS[institution].filter((s) => alvo.includes(s));
      return { institution, score: matched.length, matched };
    })
    .sort((a, b) => b.score - a.score);
}

/** Instituição detectada no documento, ou null quando não há evidência clara. */
export function detectInstitutionFromDocument(textos: string[]): {
  institution: InstitutionCode | null;
  score: number;
  matched: string[];
} {
  const [vencedor, segundo] = scoreInstitutionSignals(textos);
  if (!vencedor || vencedor.score === 0) return { institution: null, score: 0, matched: [] };
  if (segundo && segundo.score === vencedor.score)
    return { institution: null, score: vencedor.score, matched: vencedor.matched };
  return { institution: vencedor.institution, score: vencedor.score, matched: vencedor.matched };
}
