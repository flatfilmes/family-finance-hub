/**
 * IDENTIDADE ECONÔMICA DE UM MOVIMENTO — SOMENTE LEITURA.
 *
 * O `sourceId` é identidade DENTRO de um documento: ele muda quando o MESMO
 * PDF é importado de novo (`549c345a#016`, `9e6606cf#016`, `6a6a8cdf#016`
 * descrevem a MESMA linha econômica). Por isso ele não serve para deduplicar
 * snapshots equivalentes do mesmo extrato.
 *
 * Aqui a identidade é composta pelo fato econômico:
 *   data contábil + valor + sentido + descrição normalizada
 * mais a ORDEM DE OCORRÊNCIA dessa mesma chave. A ocorrência preserva
 * repetições legítimas (duas saídas iguais no mesmo dia são dois eventos) e ao
 * mesmo tempo impede que a mesma ocorrência seja contada duas vezes entre
 * imports equivalentes.
 *
 * Nada aqui grava, corrige ou reinterpreta valor, data ou sentido.
 */
import { normalizeDescricao } from "@/lib/card-statement-parsers/generic";

export type EconomicEvent = {
  data: string | null;
  valor: number;
  direcao: "IN" | "OUT";
  descricao: string | null;
};

/** Chave econômica SEM ocorrência — nunca é identidade sozinha. */
export function economicKey(e: EconomicEvent) {
  const data = e.data ?? "";
  const valor = Math.abs(Number(e.valor) || 0).toFixed(2);
  const descricao = normalizeDescricao(e.descricao ?? "").slice(0, 40);
  return `${data}|${valor}|${e.direcao}|${descricao}`;
}

/** Identidade completa: chave econômica + ordinal da ocorrência (0-based). */
export function economicFingerprint(e: EconomicEvent, ocorrencia: number) {
  return `${economicKey(e)}#${ocorrencia}`;
}

/** Contador de ocorrências por chave econômica. */
export function countEconomicOccurrences(eventos: EconomicEvent[]) {
  const counts = new Map<string, number>();
  for (const e of eventos) {
    const k = economicKey(e);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Consumidor de capacidade: dado o que já existe economicamente (ledger), diz
 * se um candidato já está presente — respeitando repetições legítimas.
 */
export function createPresenceLedger(existentes: EconomicEvent[]) {
  const disponiveis = countEconomicOccurrences(existentes);
  return {
    /** true quando o evento já existe e ainda não foi consumido. */
    consume(e: EconomicEvent) {
      const k = economicKey(e);
      const n = disponiveis.get(k) ?? 0;
      if (n <= 0) return false;
      disponiveis.set(k, n - 1);
      return true;
    },
    restante(e: EconomicEvent) {
      return disponiveis.get(economicKey(e)) ?? 0;
    },
  };
}
