import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { FormDialog } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { usePermissions } from "@/hooks/usePermissions";
import { useDeleteStatementImport, useStatementImports } from "@/hooks/useCardStatements";
import {
  IMPORT_STATUS_LABELS,
  podeExcluirImportacao,
  type StatementImport,
} from "@/lib/card-statements";
import { monthKeyLabel } from "@/lib/card-invoices";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";

type Filtro = "todos" | "revisao" | "confirmadas" | "canceladas";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todas" },
  { id: "revisao", label: "Aguardando revisão" },
  { id: "confirmadas", label: "Confirmadas" },
  { id: "canceladas", label: "Canceladas" },
];

function tone(status: StatementImport["status"]) {
  if (status === "CONFIRMED") return "ok" as const;
  if (status === "CANCELLED") return "muted" as const;
  if (status === "ERROR") return "danger" as const;
  return "warn" as const;
}

/** Competência da fatura importada, priorizando a data de vencimento. */
export function competenciaImportacao(imp: StatementImport) {
  const base = imp.data_vencimento ?? imp.periodo_fim ?? imp.data_fechamento ?? imp.created_at;
  return base ? monthKeyLabel(base.slice(0, 7)) : "Sem competência";
}

function combina(filtro: Filtro, status: StatementImport["status"]) {
  if (filtro === "todos") return true;
  if (filtro === "confirmadas") return status === "CONFIRMED";
  if (filtro === "canceladas") return status === "CANCELLED";
  return status !== "CONFIRMED" && status !== "CANCELLED";
}

/** Diálogo de exclusão, reutilizando as regras seguras já existentes. */
export function DeleteStatementImportDialog({
  importacao,
  familyId,
  onClose,
}: {
  importacao: StatementImport | null;
  familyId?: string;
  onClose: () => void;
}) {
  const excluir = useDeleteStatementImport(familyId);
  return (
    <FormDialog
      open={!!importacao}
      onOpenChange={(aberto) => !aberto && onClose()}
      title="Excluir fatura importada"
      description={importacao?.nome_arquivo ?? ""}
    >
      {importacao && podeExcluirImportacao(importacao.status) ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Serão apagados apenas os dados desta importação: os {importacao.quantidade_lancamentos}{" "}
            lançamento(s) lidos do PDF, a revisão e os metadados da leitura.
          </p>
          <p className="text-muted-foreground">
            Compras, parcelas, recorrências e faturas já registradas no sistema{" "}
            <strong>não são afetadas</strong>.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={excluir.isPending}
              className="rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
              onClick={() =>
                excluir.mutate(importacao.id, {
                  onSuccess: () => {
                    toast.success("Fatura importada excluída.");
                    onClose();
                  },
                  onError: (e: Error) => toast.error(e.message),
                })
              }
            >
              {excluir.isPending ? "Excluindo..." : "Excluir fatura"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-destructive">
            Esta fatura já foi confirmada e teve efeito no sistema.
          </p>
          <p className="text-muted-foreground">
            Para excluir esta fatura processada, primeiro desfaça/cancele a revisão.
          </p>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              className="rounded-full bg-muted px-4 py-2 text-sm font-semibold"
              onClick={onClose}
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

/**
 * Lista completa das faturas importadas de UM cartão.
 * A página do cartão é a fonte principal desta lista — a visão geral só resume.
 */
export function CardStatementImports({
  familyId,
  cardId,
  onImportar,
}: {
  familyId?: string;
  cardId: string;
  onImportar?: () => void;
}) {
  const perms = usePermissions();
  const { data, isLoading } = useStatementImports(familyId, cardId);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [paraExcluir, setParaExcluir] = useState<StatementImport | null>(null);

  const todas = data ?? [];
  const lista = todas.filter((imp) => combina(filtro, imp.status));

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="Faturas importadas"
          hint="Somente as importações deste cartão. Cada arquivo fica vinculado ao cartão escolhido na importação."
        />
        {onImportar && (
          <button
            type="button"
            onClick={onImportar}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Importar fatura
          </button>
        )}
      </div>

      {todas.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                filtro === f.id
                  ? "border-primary bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : lista.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title={
            todas.length === 0
              ? "Nenhuma fatura importada neste cartão"
              : "Nenhuma fatura com esse filtro"
          }
          description={
            todas.length === 0
              ? "Envie o PDF da fatura para conferir os lançamentos com as compras já cadastradas."
              : "Altere o filtro para ver as demais importações."
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {lista.map((imp) => (
            <li key={imp.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  Fatura {competenciaImportacao(imp)} ·{" "}
                  {formatCurrency(Number(imp.valor_total_fatura) || 0)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {imp.quantidade_lancamentos} lançamento(s)
                  {imp.data_vencimento ? ` · vence em ${formatDate(imp.data_vencimento)}` : ""} ·{" "}
                  {imp.nome_arquivo}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={tone(imp.status)}>
                  {IMPORT_STATUS_LABELS[imp.status]}
                </StatusBadge>
                <Link
                  to="/cartoes/faturas/$importId"
                  params={{ importId: imp.id }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {imp.status === "CONFIRMED" ? "Ver detalhes" : "Revisar"}
                </Link>
                {perms.isAdmin && (
                  <button
                    type="button"
                    onClick={() => setParaExcluir(imp)}
                    title={
                      podeExcluirImportacao(imp.status)
                        ? "Excluir fatura importada"
                        : "Para excluir esta fatura processada, primeiro desfaça/cancele a revisão."
                    }
                    aria-label={`Excluir fatura ${imp.nome_arquivo}`}
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <DeleteStatementImportDialog
        importacao={paraExcluir}
        familyId={familyId}
        onClose={() => setParaExcluir(null)}
      />
    </Card>
  );
}
