import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada. As receitas são cadastradas no perfil de cada pessoa,
 * em Configurações → Família e Finanças.
 */
export const Route = createFileRoute("/_authenticated/receitas")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", replace: true });
  },
  component: () => null,
});
