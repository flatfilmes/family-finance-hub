/**
 * Diagnóstico do parser bancário aberto a partir de uma conta.
 *
 * Página completa (sem modal), somente leitura: roda o parser real em dry run.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { usePermissions } from "@/hooks/usePermissions";
import { BankParserDiagnosticsPage } from "@/components/pdf-diagnostic/bank-parser-diagnostics-page";

export const Route = createFileRoute("/_authenticated/bancos_/$accountId/diagnostico-parser")({
  head: () => ({
    meta: [
      { title: "Diagnóstico do parser da conta — Família Finance AI" },
      {
        name: "description",
        content:
          "Veja exatamente como o extrato desta conta é interpretado, antes de qualquer gravação no saldo.",
      },
      { property: "og:title", content: "Diagnóstico do parser da conta" },
      {
        property: "og:description",
        content: "Leitura em memória do extrato: itens crus, linhas, parser e validação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountParserDiagnosticsRoute,
});

function AccountParserDiagnosticsRoute() {
  const { accountId } = Route.useParams();
  const { isAdmin, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!isAdmin)
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Área restrita"
        description="O diagnóstico do leitor de extratos está disponível apenas para administradores da família."
      />
    );
  return (
    <BankParserDiagnosticsPage
      source="BANK_STATEMENT"
      backTo={{ to: "/bancos/$accountId", params: { accountId } }}
      backLabel="Voltar para conta"
    />
  );
}
