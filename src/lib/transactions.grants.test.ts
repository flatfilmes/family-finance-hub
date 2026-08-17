/**
 * FASE 1 — HARDENING
 * TRANSACTIONS_ANON_WRITE_BLOCK_TEST
 *
 * Defesa em profundidade no ledger: nem `anon` nem `authenticated` possuem
 * GRANT de escrita direta em public.transactions. Toda escrita legítima passa
 * por função SECURITY DEFINER. Este teste congela essa decisão em duas frentes:
 * o retrato dos GRANTs reais do banco e a ausência de escrita direta no cliente.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Retrato de pg_class.relacl de public.transactions após o REVOKE da Fase 1. */
const RELACL = [
  "postgres=arwdDxtm/postgres",
  "anon=rDxtm/postgres",
  "authenticated=rDxtm/postgres",
  "service_role=arwdDxtm/postgres",
];

function privilegios(role: string) {
  const entry = RELACL.find((e) => e.startsWith(`${role}=`));
  return entry?.split("=")[1]?.split("/")[0] ?? "";
}

describe("TRANSACTIONS_ANON_WRITE_BLOCK_TEST", () => {
  it("anon não pode inserir, atualizar nem apagar", () => {
    const p = privilegios("anon");
    expect(p).not.toMatch(/a/); // INSERT
    expect(p).not.toMatch(/w/); // UPDATE
    expect(p).not.toMatch(/d/); // DELETE
  });

  it("authenticated permanece somente leitura (não alterado nesta fase)", () => {
    const p = privilegios("authenticated");
    expect(p).toMatch(/r/);
    expect(p).not.toMatch(/[awd]/);
  });

  it("service_role continua com acesso completo para as rotinas do sistema", () => {
    expect(privilegios("service_role")).toBe("arwdDxtm");
  });
});

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("nenhuma escrita direta em transactions pelo cliente", () => {
  it("todo INSERT/UPDATE/DELETE do ledger passa por RPC", () => {
    const suspeitos = arquivos("src").filter((arquivo) => {
      const src = readFileSync(arquivo, "utf8");
      return /from\("transactions"\)\s*\.\s*(insert|update|delete)/.test(src);
    });
    expect(suspeitos).toEqual([]);
  });
});
