/**
 * TELA DEV — DIAGNÓSTICO DO PARSER BANCÁRIO (página, nunca modal).
 *
 * READ-ONLY por construção: roda o parser real em dry run (memória) e mostra
 * cada etapa do pipeline. Não cria transação, não toca ledger, não concilia.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { usePermissions } from "@/hooks/usePermissions";
import { BankParserDiagnosticsPage } from "@/components/pdf-diagnostic/bank-parser-diagnostics-page";

export const Route = createFileRoute("/_authenticated/dev/bank-parser-diagnostics")({
  validateSearch: (search: Record<string, unknown>) => ({
    import: typeof search["import"] === "string" ? (search["import"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Diagnóstico do parser bancário — Família Finance AI" },
      {
        name: "description",
        content:
          "Ferramenta de desenvolvimento: mostra como cada PDF bancário é lido, linha a linha, antes de qualquer gravação.",
      },
      { property: "og:title", content: "Diagnóstico do parser bancário" },
      {
        property: "og:description",
        content: "PDF → itens crus → detecção → linhas → parser → validação, tudo em memória.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevBankParserDiagnosticsRoute,
});

function DevBankParserDiagnosticsRoute() {
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
    <BankParserDiagnosticsPage source="BANK_STATEMENT" backTo={{ to: "/bancos" }} backLabel="Voltar para bancos" />
  );
}
