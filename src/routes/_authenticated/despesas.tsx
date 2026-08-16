import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada. O lançamento de consumo acontece em Compras — a tabela `expenses`
 * deixou de ser fonte de verdade e não recebe mais registros manuais.
 */
export const Route = createFileRoute("/_authenticated/despesas")({
  beforeLoad: () => {
    throw redirect({ to: "/compras", replace: true });
  },
  component: () => null,
});
