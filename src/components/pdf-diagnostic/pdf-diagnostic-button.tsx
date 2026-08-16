import { useState } from "react";
import { Bug } from "lucide-react";
import { PdfDiagnosticDialog } from "@/components/pdf-diagnostic/pdf-diagnostic-dialog";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import type { DiagnosticSource, ParserDryRun } from "@/lib/pdf-diagnostic";

/**
 * Botão discreto "Modo diagnóstico PDF", reutilizável por qualquer fluxo de
 * leitura de PDF. Só aparece para ADMIN em desenvolvimento ou família demo.
 */
export function PdfDiagnosticButton({
  source,
  parserDryRun,
  file = null,
  className = "",
}: {
  source: DiagnosticSource;
  parserDryRun?: ParserDryRun;
  file?: File | null;
  className?: string;
}) {
  const perms = usePermissions();
  const { data: family } = useFamily();
  const [aberto, setAberto] = useState(false);

  const disponivel = perms.isAdmin && (import.meta.env.DEV || !!family?.is_demo);
  if (!disponivel) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={`inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent ${className}`}
      >
        <Bug className="size-4" /> Modo diagnóstico PDF
      </button>
      {aberto && (
        <PdfDiagnosticDialog
          source={source}
          {...(parserDryRun ? { parserDryRun } : {})}
          file={file}
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}
