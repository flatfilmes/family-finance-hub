import { describe, expect, it } from "vitest";
import {
  consolidateBatchCheckpoints,
  detectPeriodOverlaps,
  markDuplicatesAcrossBatch,
  parseStatementFilesIndependently,
  sortBatchFiles,
  summarizeBatch,
  type BatchFile,
} from "./batch";
import type { ParsedBankStatement } from "./types";

function statement(
  inicio: string,
  fim: string,
  movimentos: Array<[string, string, number]>,
  checkpoints: Array<[string, number]> = [],
): ParsedBankStatement {
  return {
    parser: "TESTE",
    periodoInicio: inicio,
    periodoFim: fim,
    saldoInicial: 0,
    saldoFinal: 0,
    movimentos: movimentos.map(([data, descricao, valor]) => ({
      data,
      descricaoOriginal: descricao,
      descricaoNormalizada: descricao,
      valor,
      tipo: valor > 0 ? ("ENTRADA" as const) : ("SAIDA" as const),
    })),
    checkpoints: checkpoints.map(([data, saldo]) => ({ data, saldo })),
    aceitos: [],
    rejeitados: [],
  };
}

function arquivo(id: string, nome: string, parsed: ParsedBankStatement | null): BatchFile {
  return {
    id,
    nomeArquivo: nome,
    status: parsed ? "OK" : "ERRO",
    fingerprint: nome,
    jaImportado: false,
    parsed,
    erro: parsed ? null : "falhou",
  };
}

describe("lote de extratos", () => {
  it("cada arquivo é parseado isoladamente: sozinho ou em lote dá o mesmo resultado", async () => {
    const parser = (nome: string) =>
      statement("2026-01-01", "2026-01-31", [["2026-01-05", `MOV ${nome}`, 10]]);

    const sozinhos = ["jan.pdf", "fev.pdf", "mar.pdf"].map((n) => parser(n));

    const emLote = await parseStatementFilesIndependently(
      ["jan.pdf", "fev.pdf", "mar.pdf"],
      async (nome) => ({
        nomeArquivo: nome,
        fingerprint: nome,
        jaImportado: false,
        parsed: parser(nome),
        erro: null,
      }),
    );

    expect(emLote.map((f) => f.parsed)).toEqual(sozinhos);
  });

  it("um arquivo com erro não interrompe o lote", async () => {
    const r = await parseStatementFilesIndependently(["a", "b", "c"], async (nome) => {
      if (nome === "b") throw new Error("Parser não conseguiu validar o período");
      return {
        nomeArquivo: nome,
        fingerprint: nome,
        jaImportado: false,
        parsed: statement("2026-01-01", "2026-01-31", []),
        erro: null,
      };
    });
    expect(r.map((f) => f.status)).toEqual(["OK", "ERRO", "OK"]);
    expect(r[1]?.erro).toContain("período");
  });

  it("ordena por período detectado, não pela ordem de seleção", () => {
    const files = [
      arquivo("1", "mar.pdf", statement("2026-03-01", "2026-03-31", [])),
      arquivo("2", "jan.pdf", statement("2026-01-01", "2026-01-31", [])),
      arquivo("3", "fev.pdf", statement("2026-02-01", "2026-02-28", [])),
    ];
    expect(sortBatchFiles(files).map((f) => f.nomeArquivo)).toEqual([
      "jan.pdf",
      "fev.pdf",
      "mar.pdf",
    ]);
  });

  it("detecta sobreposição de períodos entre dois extratos", () => {
    const files = [
      arquivo("a", "jan-jun.pdf", statement("2026-01-01", "2026-06-30", [])),
      arquivo("b", "90dias.pdf", statement("2026-05-18", "2026-08-16", [])),
    ];
    expect(detectPeriodOverlaps(files)).toEqual([
      { aId: "a", bId: "b", inicio: "2026-05-18", fim: "2026-06-30" },
    ]);
  });

  it("marca duplicidade entre arquivos sem apagar linhas do documento", () => {
    const a = arquivo(
      "a",
      "jan-jun.pdf",
      statement("2026-01-01", "2026-06-30", [
        ["2026-06-17", "PIX TRANSF JOAO", -50],
        ["2026-06-18", "TARIFA", -5],
      ]),
    );
    const b = arquivo(
      "b",
      "90dias.pdf",
      statement("2026-05-18", "2026-08-16", [
        ["2026-06-17", "PIX TRANSF JOAO", -50],
        ["2026-07-01", "SALARIO", 1000],
      ]),
    );
    const ordenados = sortBatchFiles([b, a]);
    const dup = markDuplicatesAcrossBatch(ordenados);
    expect(dup["a"]).toEqual([false, false]);
    expect(dup["b"]).toEqual([true, false]);
    expect(b.parsed?.movimentos).toHaveLength(2);
  });

  it("não duplica checkpoints iguais entre arquivos e resume o lote", () => {
    const a = arquivo(
      "a",
      "jan-jun.pdf",
      statement("2026-01-01", "2026-06-30", [["2026-06-17", "PIX", -50]], [["2026-06-17", 120.81]]),
    );
    const b = arquivo(
      "b",
      "90dias.pdf",
      statement(
        "2026-05-18",
        "2026-08-16",
        [["2026-06-17", "PIX", -50]],
        [
          ["2026-06-17", 120.81],
          ["2026-07-01", 300],
        ],
      ),
    );
    const ordenados = sortBatchFiles([a, b]);
    const checkpoints = consolidateBatchCheckpoints(ordenados);
    expect(checkpoints["a"]).toHaveLength(1);
    expect(checkpoints["b"]).toHaveLength(1);

    const resumo = summarizeBatch(ordenados, markDuplicatesAcrossBatch(ordenados), checkpoints);
    expect(resumo).toMatchObject({
      arquivos: 2,
      ok: 2,
      comErro: 0,
      periodoInicio: "2026-01-01",
      periodoFim: "2026-08-16",
      movimentos: 2,
      duplicados: 1,
      novos: 1,
      checkpoints: 2,
      checkpointsDuplicados: 1,
    });
  });
});
