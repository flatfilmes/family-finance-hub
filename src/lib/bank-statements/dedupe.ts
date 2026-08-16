/**
 * DEDUPLICAÇÃO ENTRE EXTRATOS SOBREPOSTOS.
 *
 * Dois PDFs do mesmo banco quase sempre têm um trecho em comum (ex.: 18/05 a
 * 30/06). Cada documento continua existindo como importação independente —
 * apenas os efeitos no ledger e os checkpoints não podem ser criados de novo.
 *
 * Chave de identidade de um movimento:
 *   bank_account_id + data contábil + valor + descrição normalizada.
 *
 * Nada aqui apaga registro: a duplicata apenas nasce com a ação IGNORE.
 */
import type { ParsedBalanceCheckpoint, ParsedBankMovement } from "./types";
import { normalizeDescricao } from "@/lib/card-statement-parsers/generic";

export type MovementIdentity = {
  data: string | null;
  valor: number | string | null;
  descricao: string | null;
};

/** Chave determinística usada para reconhecer o mesmo lançamento. */
export function movementKey(m: MovementIdentity) {
  const data = m.data ?? "";
  const valor = Number(m.valor ?? 0).toFixed(2);
  const descricao = normalizeDescricao(m.descricao ?? "").slice(0, 40);
  return `${data}|${valor}|${descricao}`;
}

/** Conjunto de chaves dos lançamentos que já existem em extratos da conta. */
export function buildExistingMovementKeys(
  existentes: Array<{ data_movimento: string | null; valor: number | string; descricao_original: string }>,
) {
  return new Set(
    existentes.map((e) =>
      movementKey({ data: e.data_movimento, valor: e.valor, descricao: e.descricao_original }),
    ),
  );
}

/** Quais movimentos do novo extrato já foram lidos em outro documento. */
export function marcarDuplicados(
  movimentos: ParsedBankMovement[],
  jaExistentes: Set<string>,
): boolean[] {
  const vistosNesteArquivo = new Set<string>();
  return movimentos.map((m) => {
    const chave = movementKey({
      data: m.data,
      valor: m.valor,
      descricao: m.descricaoOriginal,
    });
    const duplicado = jaExistentes.has(chave) || vistosNesteArquivo.has(chave);
    vistosNesteArquivo.add(chave);
    return duplicado;
  });
}

/** Checkpoints inéditos: mesma conta + mesma data + mesmo saldo é reutilizado. */
export function checkpointsInéditos(
  checkpoints: ParsedBalanceCheckpoint[],
  existentes: Array<{ data: string; saldo: number }>,
) {
  const chave = (c: { data: string; saldo: number }) => `${c.data}|${c.saldo.toFixed(2)}`;
  const jaExiste = new Set(existentes.map(chave));
  const novos: ParsedBalanceCheckpoint[] = [];
  for (const c of checkpoints) {
    const k = chave(c);
    if (jaExiste.has(k)) continue;
    jaExiste.add(k);
    novos.push(c);
  }
  return novos;
}
