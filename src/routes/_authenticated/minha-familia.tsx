import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A administração da família passou para Configurações → Família e Finanças.
 * A rota antiga continua existindo apenas para não quebrar links salvos.
 */
export const Route = createFileRoute("/_authenticated/minha-familia")({
  beforeLoad: () => {
    throw redirect({ to: "/configuracoes", replace: true });
  },
  component: () => null,
});
