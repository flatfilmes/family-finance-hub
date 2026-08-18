import type { CreditCard } from "@/lib/finance";

/**
 * Read model canônico de CARTÕES.
 *
 * A obrigação aberta de cada cartão vem da engine de ciclo/fatura
 * (obrigacaoAbertaDoCartao) — nenhuma tela soma purchases de novo para
 * descobrir "quanto é a fatura".
 */
export type CardObligationView = {
  cardId: string;
  nome: string;
  banco: string;
  valor: number;
  aberta: boolean;
  oficial: boolean;
};

export type CoverageStatus = "VERDE" | "AMARELO" | "VERMELHO";

export type CardCommitments = {
  obrigacoes: CardObligationView[];
  totalFaturasAbertas: number;
  totalLimite: number;
  saldoContas: number;
  /** saldo em contas - faturas abertas. */
  capacidade: number;
  /** % do total das faturas coberto pelo saldo (100% = cobre exatamente). */
  cobertura: number;
  status: CoverageStatus;
};

/**
 * Regra única de cobertura: abaixo de 100% o saldo não cobre as faturas;
 * abaixo de 120% cobre sem folga.
 */
export function cardCoverageStatus(saldo: number, faturas: number): CoverageStatus {
  // Sem fatura aberta não existe risco de cobertura.
  if (faturas <= 0) return "VERDE";
  const cobertura = (saldo / faturas) * 100;
  if (cobertura < 100) return "VERMELHO";
  if (cobertura < 120) return "AMARELO";
  return "VERDE";
}

export const COVERAGE_MESSAGES: Record<CoverageStatus, string> = {
  VERDE: "Saldo em contas cobre as faturas abertas com folga.",
  AMARELO: "Saldo cobre as faturas, mas com margem pequena.",
  VERMELHO: "Saldo disponível não cobre todas as faturas abertas.",
};

export function buildCardCommitments(input: {
  cards: CreditCard[];
  /** Obrigação aberta canônica por cartão (engine de ciclo/fatura). */
  obrigacaoDe: (cardId: string) => { valor: number; aberta: boolean; oficial: boolean };
  saldoContas: number;
}): CardCommitments {
  const ativos = input.cards.filter((c) => c.ativo);

  const obrigacoes: CardObligationView[] = ativos.map((c) => {
    const o = input.obrigacaoDe(c.id);
    return {
      cardId: c.id,
      nome: c.nome_cartao,
      banco: c.banco,
      valor: Number(o.valor) || 0,
      aberta: o.aberta,
      oficial: o.oficial,
    };
  });

  const totalFaturasAbertas = obrigacoes.reduce((acc, o) => acc + o.valor, 0);
  const totalLimite = ativos.reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const saldoContas = input.saldoContas;

  return {
    obrigacoes,
    totalFaturasAbertas,
    totalLimite,
    saldoContas,
    capacidade: saldoContas - totalFaturasAbertas,
    cobertura: totalFaturasAbertas > 0 ? (saldoContas / totalFaturasAbertas) * 100 : 100,
    status: cardCoverageStatus(saldoContas, totalFaturasAbertas),
  };
}
