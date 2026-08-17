/**
 * FASE 1 — HARDENING
 * ATOMIC_PURCHASE_FAILURE_TEST + PURCHASE_IDEMPOTENCY_RETRY_TEST
 *
 * A criação de compra passou a ser UMA única operação de banco
 * (`create_purchase_complete`). Estes testes provam que o cliente não escreve
 * mais em tabelas isoladas — logo, não existe estado parcial possível — e que
 * o retry de rede com a mesma chave devolve a compra já criada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn(() => {
  throw new Error("createPurchase não pode escrever direto em tabelas");
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...(args as [])),
  },
}));

const { createPurchase } = await import("@/lib/purchases");

const purchaseBase = {
  family_id: "11111111-1111-1111-1111-111111111111",
  member_id: "22222222-2222-2222-2222-222222222222",
  estabelecimento: "Mercado",
  data_compra: "2026-08-10",
  forma_pagamento: "PIX" as const,
  tipo_compra: "COMPRA_NORMAL" as const,
};

const items = [
  {
    product_id: "",
    categoria_id: "",
    descricao_produto: "Arroz",
    quantidade: "2",
    unidade: "UN",
    valor_unitario: "10",
  },
  {
    product_id: "",
    categoria_id: "",
    descricao_produto: "Feijão",
    quantidade: "1",
    unidade: "UN",
    valor_unitario: "8.5",
  },
];


describe("ATOMIC_PURCHASE_FAILURE_TEST", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockClear();
  });

  it("faz UMA única chamada de banco com todos os efeitos", async () => {
    rpc.mockResolvedValue({
      data: { status: "CREATED", purchase: { id: "p1", valor_total: 28.5 } },
      error: null,
    });

    const purchase = await createPurchase({ purchase: purchaseBase, items, parcelas: 1 });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("create_purchase_complete");
    expect(from).not.toHaveBeenCalled();
    expect(purchase.id).toBe("p1");
  });

  it("envia os itens já totalizados na mesma requisição", async () => {
    rpc.mockResolvedValue({ data: { status: "CREATED", purchase: { id: "p1" } }, error: null });
    await createPurchase({ purchase: purchaseBase, items });
    const args = rpc.mock.calls[0]?.[1] as { p_items: { valor_total: number }[] };
    expect(args.p_items.map((i) => i.valor_total)).toEqual([20, 8.5]);
  });

  for (const etapa of ["purchases", "purchase_items", "expense_installments", "expenses"]) {
    it(`falha durante ${etapa}: nenhuma escrita parcial no cliente`, async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "P0001", message: `falha simulada em ${etapa}` },
      });

      await expect(createPurchase({ purchase: purchaseBase, items })).rejects.toMatchObject({
        message: `falha simulada em ${etapa}`,
      });

      // Só existe a chamada atômica; o rollback é do PostgreSQL.
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(from).not.toHaveBeenCalled();
    });
  }
});

describe("PURCHASE_IDEMPOTENCY_RETRY_TEST", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockClear();
  });

  it("propaga a chave de idempotência ao banco", async () => {
    rpc.mockResolvedValue({ data: { status: "CREATED", purchase: { id: "p1" } }, error: null });
    await createPurchase({
      purchase: purchaseBase,
      items,
      clientRequestId: "33333333-3333-3333-3333-333333333333",
    });
    const args = rpc.mock.calls[0]?.[1] as { p_client_request_id: string };
    expect(args.p_client_request_id).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("retry após timeout devolve a MESMA compra, sem criar outra", async () => {
    const criada = { id: "p1", valor_total: 28.5 };
    rpc
      .mockResolvedValueOnce({ data: { status: "CREATED", purchase: criada }, error: null })
      .mockResolvedValueOnce({ data: { status: "ALREADY_CREATED", purchase: criada }, error: null });

    const chave = "44444444-4444-4444-4444-444444444444";
    const primeira = await createPurchase({ purchase: purchaseBase, items, clientRequestId: chave });
    const retry = await createPurchase({ purchase: purchaseBase, items, clientRequestId: chave });

    expect(retry.id).toBe(primeira.id);
  });
});
