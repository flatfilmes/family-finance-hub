import { useNavigate } from "@tanstack/react-router";
import { Bug } from "lucide-react";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import { pdfDiagnosticFlagEnabled } from "@/lib/pdf-diagnostic/availability";
import { setDiagnosticFile } from "@/lib/pdf-diagnostic/file-handoff";
import type { DiagnosticSource, ParserDryRun } from "@/lib/pdf-diagnostic";

/**
 * Botão "Modo diagnóstico PDF". Não abre mais modal: leva para a página
 * dedicada de diagnóstico, entregando o arquivo em memória para que o parser
 * real seja executado lá (dry run, sem persistência).
 */
export function PdfDiagnosticButton({
  source,
  file = null,
  accountId,
  // Mantido por compatibilidade: a página usa o dry run real da origem.
  parserDryRun: _parserDryRun,
  className = "",
}: {
  source: DiagnosticSource;
  file?: File | null;
  accountId?: string;
  parserDryRun?: ParserDryRun;
  className?: string;
}) {
  const perms = usePermissions();
  const { data: family } = useFamily();
  const navigate = useNavigate();

  const disponivel =
    perms.isAdmin && (import.meta.env.DEV || !!family?.is_demo || pdfDiagnosticFlagEnabled());
  if (!disponivel) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (file) setDiagnosticFile(file, source);
        if (accountId)
          void navigate({
            to: "/bancos/$accountId/diagnostico-parser",
            params: { accountId },
          });
        else void navigate({
            to: "/dev/bank-parser-diagnostics",
            search: { import: undefined },
          });
      }}
      className={`inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent ${className}`}
    >
      <Bug className="size-4" /> Modo diagnóstico PDF
    </button>
  );
}
