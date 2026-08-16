import { describe, expect, it } from "vitest";
import { friendlyDeleteError, normalizarBloqueios } from "@/lib/purchases";

describe("motivos de bloqueio da exclusão de compra", () => {
  it("mantém a lista como array de strings", () => {
    expect(normalizarBloqueios(["Movimentação bancária vinculada", "Parcela já paga"])).toEqual([
      "Movimentação bancária vinculada",
      "Parcela já paga",
    ]);
  });

  it("nunca quebra quando o banco devolve um motivo único como texto", () => {
    expect(normalizarBloqueios("Movimentação bancária vinculada")).toEqual([
      "Movimentação bancária vinculada",
    ]);
  });

  it("trata ausência de motivos como lista vazia", () => {
    expect(normalizarBloqueios(null)).toEqual([]);
    expect(normalizarBloqueios(undefined)).toEqual([]);
  });

  it("não expõe erro SQL cru na interface", () => {
    const msg = friendlyDeleteError(
      'malformed array literal: "Movimentação bancária vinculada"',
    );
    expect(msg).not.toMatch(/malformed|array literal/i);
    expect(msg).toBe("Não foi possível concluir a operação por um erro interno. Tente novamente.");
  });

  it("preserva o motivo de negócio vindo do banco", () => {
    const msg = friendlyDeleteError(
      "Esta compra não pode ser excluída: Movimentação bancária vinculada",
    );
    expect(msg).toContain("Movimentação bancária vinculada");
  });
});
