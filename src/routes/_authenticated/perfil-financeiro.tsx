import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Rota legada. O perfil financeiro da família vive em
 * Configurações → Família e Finanças.
 */
export const Route = createFileRoute("/_authenticated/perfil-financeiro")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", replace: true });
  },
  component: () => null,
});
