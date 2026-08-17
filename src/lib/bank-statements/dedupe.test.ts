import { describe, expect, it } from "vitest";

import { buildExistingMovementIndex, classificarDuplicados } from "./dedupe";
import type { ParsedBankMovement } from "./types";

const mov = (data: string, descricao: string, valor: number): ParsedBankMovement =>
  ({
    data,
    descricaoOriginal: descricao,
    descricaoNormalizada: descricao,
    valor,
    tipo: valor < 0 ? "SAIDA" : "ENTRADA",
    ordem: 0,
  }) as ParsedBankMovement;

describe("identidade de linha no dedupe", () => {
  it("preserva repetição legítima do mesmo valor no mesmo dia", () => {
    const decisoes = classificarDuplicados(
      [mov("2026-04-10", "PIX REJEITADO", -54.61), mov("2026-04-10", "PIX REJEITADO", -54.61)],
      buildExistingMovementIndex([]),
    );
    expect(decisoes.map((d) => d.duplicado)).toEqual([false, false]);
    expect(decisoes[1]?.occurrenceIndex).toBe(1);
  });

  it("marca duplicata só quando existe alvo concreto já importado", () => {
    const existentes = buildExistingMovementIndex([
      {
        id: "ledger-1",
        data_movimento: "2026-04-10",
        descricao_original: "PIX REJEITADO",
        valor: -54.61,
      },
    ]);
    const decisoes = classificarDuplicados(
      [mov("2026-04-10", "PIX REJEITADO", -54.61), mov("2026-04-10", "PIX REJEITADO", -54.61)],
      existentes,
    );
    expect(decisoes[0]).toMatchObject({ duplicado: true, matchedTargetId: "ledger-1" });
    expect(decisoes[1]).toMatchObject({ duplicado: false, matchedTargetId: null });
  });

  it("reconhece reimportação do mesmo documento pela identidade da linha", () => {
    const existentes = buildExistingMovementIndex([
      {
        id: "item-9",
        data_movimento: "2026-01-05",
        descricao_original: "OUTRA COISA",
        valor: -10,
        source_id: "src-abc",
      },
    ]);
    const decisoes = classificarDuplicados(
      [mov("2026-01-05", "PAGAMENTO AGUA", -7466.84)],
      existentes,
      ["src-abc"],
    );
    expect(decisoes[0]).toMatchObject({
      duplicado: true,
      matchedTargetId: "item-9",
      fieldsCompared: ["sourceId"],
    });
  });
});
