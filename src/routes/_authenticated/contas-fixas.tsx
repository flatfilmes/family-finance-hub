import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada. As contas recorrentes são cadastradas em
 * Configurações → Família e Finanças.
 */
export const Route = createFileRoute("/_authenticated/contas-fixas")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", replace: true });
  },
  component: () => null,
});
