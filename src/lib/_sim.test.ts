import { expect, it } from "vitest";
import { similaridadeFornecedor } from "@/lib/card-statements";
import { normalizeDescricao } from "@/lib/card-statement-parsers";
it("dbg", () => {
  console.log(normalizeDescricao("NS2.COM INTERNET S.A."), "|", normalizeDescricao("MLP*Netshoes-NS2CO"),
    "|", similaridadeFornecedor("NS2.COM INTERNET S.A.", "MLP*Netshoes-NS2CO"));
  expect(1).toBe(1);
});
