/**
 * IMPORTAÇÃO DE EXTRATOS EM LOTE.
 *
 * Princípio inegociável: cada arquivo continua sendo um documento independente.
 * Os PDFs NUNCA são concatenados — cada um passa sozinho pelo parser e produz
 * o seu próprio ParsedBankStatement, exatamente igual ao que produziria se
 * fosse importado individualmente.
 *
 * Este módulo só cuida do que acontece DEPOIS do parsing individual:
 * ordenação por período, detecção de sobreposição, deduplicação entre os
 * arquivos do mesmo lote e o resumo do lote. Nada aqui altera parser algum.
 */
import type { ParsedBalanceCheckpoint, ParsedBankStatement } from "./types";
import { movementKey } from "./dedupe";

export type BatchFileStatus = "PENDENTE" | "LENDO" | "OK" | "ERRO";

/** Resultado da leitura de UM arquivo do lote. */
export type BatchFile = {
  id: string;
  nomeArquivo: string;
  status: BatchFileStatus;
  fingerprint: string | null;
  jaImportado: boolean;
  parsed: ParsedBankStatement | null;
  erro: string | null;
};

export type BatchOverlap = {
  aId: string;
  bId: string;
  inicio: string;
  fim: string;
};

/**
 * Lê cada arquivo isoladamente. Um erro em um arquivo nunca interrompe o lote.
 * `parseFile` é exatamente a mesma função usada na importação individual.
 */
export async function parseStatementFilesIndependently<F>(
  files: F[],
  parseFile: (file: F, index: number) => Promise<Omit<BatchFile, "id" | "status">>,
  onProgress?: (feito: number, total: number) => void,
): Promise<BatchFile[]> {
  const resultados: BatchFile[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const r = await parseFile(files[i], i);
      resultados.push({ ...r, id: `${i}`, status: r.parsed ? "OK" : "ERRO" });
    } catch (e) {
      resultados.push({
        id: `${i}`,
        nomeArquivo: `arquivo ${i + 1}`,
        status: "ERRO",
        fingerprint: null,
        jaImportado: false,
        parsed: null,
        erro: e instanceof Error ? e.message : "Não foi possível ler este PDF.",
      });
    }
    onProgress?.(i + 1, files.length);
  }
  return resultados;
}

/** Ordena por período detectado (nunca pela ordem de seleção do usuário). */
export function sortBatchFiles(files: BatchFile[]): BatchFile[] {
  const chave = (f: BatchFile) =>
    `${f.parsed?.periodoInicio ?? "9999-12-31"}|${f.parsed?.periodoFim ?? "9999-12-31"}|${f.nomeArquivo}`;
  return [...files].sort((a, b) => chave(a).localeCompare(chave(b)));
}

/** Períodos sobrepostos entre arquivos — informativo, não é erro. */
export function detectPeriodOverlaps(files: BatchFile[]): BatchOverlap[] {
  const validos = files.filter((f) => f.parsed?.periodoInicio && f.parsed?.periodoFim);
  const out: BatchOverlap[] = [];
  for (let i = 0; i < validos.length; i++) {
    for (let j = i + 1; j < validos.length; j++) {
      const a = validos[i].parsed!;
      const b = validos[j].parsed!;
      const inicio = a.periodoInicio! > b.periodoInicio! ? a.periodoInicio! : b.periodoInicio!;
      const fim = a.periodoFim! < b.periodoFim! ? a.periodoFim! : b.periodoFim!;
      if (inicio <= fim) out.push({ aId: validos[i].id, bId: validos[j].id, inicio, fim });
    }
  }
  return out;
}

/**
 * Deduplicação ENTRE arquivos do mesmo lote.
 *
 * Cada documento mantém todas as suas linhas; apenas marcamos as repetidas
 * para que não produzam efeito financeiro duas vezes. A primeira ocorrência
 * (arquivo mais antigo, na ordem cronológica) é a que vale.
 */
export function markDuplicatesAcrossBatch(
  filesOrdenados: BatchFile[],
  jaNoSistema: Set<string> = new Set(),
): Record<string, boolean[]> {
  const vistos = new Set<string>();
  const mapa: Record<string, boolean[]> = {};
  for (const f of filesOrdenados) {
    const marcas: boolean[] = [];
    for (const m of f.parsed?.movimentos ?? []) {
      const chave = movementKey({
        data: m.data,
        valor: m.valor,
        descricao: m.descricaoOriginal,
      });
      marcas.push(jaNoSistema.has(chave) || vistos.has(chave));
      vistos.add(chave);
    }
    mapa[f.id] = marcas;
  }
  return mapa;
}

/** Checkpoints consolidados do lote: mesma data + mesmo saldo entra uma vez só. */
export function consolidateBatchCheckpoints(filesOrdenados: BatchFile[]) {
  const vistos = new Set<string>();
  const mapa: Record<string, ParsedBalanceCheckpoint[]> = {};
  for (const f of filesOrdenados) {
    const novos: ParsedBalanceCheckpoint[] = [];
    for (const c of f.parsed?.checkpoints ?? []) {
      const k = `${c.data}|${c.saldo.toFixed(2)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      novos.push(c);
    }
    mapa[f.id] = novos;
  }
  return mapa;
}

export type BatchSummary = {
  arquivos: number;
  ok: number;
  comErro: number;
  periodoInicio: string | null;
  periodoFim: string | null;
  movimentos: number;
  duplicados: number;
  novos: number;
  checkpoints: number;
  checkpointsDuplicados: number;
};

export function summarizeBatch(
  filesOrdenados: BatchFile[],
  duplicados: Record<string, boolean[]>,
  checkpoints: Record<string, ParsedBalanceCheckpoint[]>,
): BatchSummary {
  const ok = filesOrdenados.filter((f) => f.status === "OK");
  const periodos = ok
    .flatMap((f) => [f.parsed?.periodoInicio, f.parsed?.periodoFim])
    .filter((d): d is string => !!d)
    .sort();
  let movimentos = 0;
  let dup = 0;
  let checks = 0;
  let checksNovos = 0;
  for (const f of ok) {
    movimentos += f.parsed?.movimentos.length ?? 0;
    dup += (duplicados[f.id] ?? []).filter(Boolean).length;
    checks += f.parsed?.checkpoints?.length ?? 0;
    checksNovos += (checkpoints[f.id] ?? []).length;
  }
  return {
    arquivos: filesOrdenados.length,
    ok: ok.length,
    comErro: filesOrdenados.length - ok.length,
    periodoInicio: periodos[0] ?? null,
    periodoFim: periodos[periodos.length - 1] ?? null,
    movimentos,
    duplicados: dup,
    novos: movimentos - dup,
    checkpoints: checksNovos,
    checkpointsDuplicados: checks - checksNovos,
  };
}
