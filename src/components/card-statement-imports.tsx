import { useState } from "react";
import { FileText, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { FormDialog } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useDeleteStatementImport,
  useStatementImports,
  useUndoReport,
  useUndoStatementImport,
} from "@/hooks/useCardStatements";
import {
  IMPORT_STATUS_LABELS,
  podeDesfazerImportacao,
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
  { id: "canceladas", label: "Desfeitas/canceladas" },
];

function tone(status: StatementImport["status"]) {
  if (status === "CONFIRMED") return "ok" as const;
  if (status === "CANCELLED" || status === "UNDONE") return "muted" as const;
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
  if (filtro === "canceladas") return status === "CANCELLED" || status === "UNDONE";
  return status !== "CONFIRMED" && status !== "CANCELLED" && status !== "UNDONE";
}

/**
 * Desfazer importação: mostra o impacto ANTES de reverter e só reverte
 * o que pertence exclusivamente àquela importação.
 */
export function UndoStatementImportDialog({
  importacao,
  familyId,
  onClose,
}: {
  importacao: StatementImport | null;
  familyId?: string | undefined;
  onClose: () => void;
}) {
  const { data: relatorio, isLoading } = useUndoReport(importacao?.id, !!importacao);
  const desfazer = useUndoStatementImport(familyId);
  const bloqueios = relatorio?.bloqueios ?? [];

  const linhas: { label: string; valor: number }[] = relatorio
    ? [
        { label: "Compras criadas por esta importação", valor: relatorio.compras_criadas_exclusivas },
        { label: "Compras apenas associadas", valor: relatorio.compras_associadas },
        {
          label: "Compras compartilhadas com outra importação",
          valor: relatorio.compras_compartilhadas,
        },
        { label: "Parcelas criadas", valor: relatorio.parcelas },
        { label: "Taxas", valor: relatorio.taxas },
        { label: "Créditos/estornos", valor: relatorio.creditos },
        { label: "Itens ignorados", valor: relatorio.ignorados },
      ]
    : [];

  return (
    <FormDialog
      open={!!importacao}
      onOpenChange={(aberto) => !aberto && onClose()}
      title="Desfazer importação"
      description={importacao?.nome_arquivo ?? ""}
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Esta ação vai reverter os efeitos criados por esta importação. Compras vindas de nota
          fiscal, compras compartilhadas com outra importação e histórico bancário confirmado são
          preservados.
        </p>

        {isLoading ? (
          <p className="text-muted-foreground">Calculando o impacto...</p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {linhas.map((l) => (
                <li key={l.label} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="text-muted-foreground">{l.label}</span>
                  <span className="font-bold">{l.valor}</span>
                </li>
              ))}
            </ul>

            {bloqueios.length > 0 && (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3">
                <p className="font-semibold text-destructive">
                  Alguns itens possuem histórico posterior e precisarão de revisão manual.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {bloqueios.slice(0, 6).map((b) => (
                    <li key={b.purchase_id}>
                      {b.estabelecimento} · {formatCurrency(Number(b.valor) || 0)} —{" "}
                      {b.motivos.join("; ")}
                    </li>
                  ))}
                  {bloqueios.length > 6 && <li>e mais {bloqueios.length - 6}...</li>}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Ao continuar, esses registros permanecem intactos e apenas o restante é revertido.
                </p>
              </div>
            )}
          </>
        )}

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
            disabled={desfazer.isPending || isLoading || !importacao}
            className="rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            onClick={() =>
              desfazer.mutate(
                { id: importacao!.id, aceitarPendencias: bloqueios.length > 0 },
                {
                  onSuccess: (r) => {
                    toast.success(
                      r.resultado === "ALREADY_UNDONE"
                        ? "Esta importação já estava desfeita."
                        : `Importação desfeita: ${r.compras_removidas ?? 0} compra(s) removida(s), ${
                            r.compras_preservadas ?? 0
                          } preservada(s).`,
                    );
                    onClose();
                  },
                  onError: (e: Error) => toast.error(e.message),
                },
              )
            }
          >
            {desfazer.isPending
              ? "Desfazendo..."
              : bloqueios.length > 0
                ? "Entendi, desfazer mesmo assim"
                : "Desfazer importação"}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}


/** Diálogo de exclusão, reutilizando as regras seguras já existentes. */
export function DeleteStatementImportDialog({
  importacao,
  familyId,
  onClose,
}: {
  importacao: StatementImport | null;
  familyId?: string | undefined;
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
            Use "Desfazer importação" no menu da fatura: os efeitos exclusivos dela são revertidos e
            só então o registro pode ser excluído.
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
  familyId?: string | undefined;
  cardId: string;
  onImportar?: (() => void) | undefined;
}) {
  const perms = usePermissions();
  const { data, isLoading } = useStatementImports(familyId, cardId);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [paraExcluir, setParaExcluir] = useState<StatementImport | null>(null);
  const [paraDesfazer, setParaDesfazer] = useState<StatementImport | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);


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
                <p className="truncate text-[11px] text-muted-foreground">
                  {imp.confirmado_em
                    ? `Confirmada em ${new Date(imp.confirmado_em).toLocaleString("pt-BR")}`
                    : `Enviada em ${new Date(imp.created_at).toLocaleString("pt-BR")}`}{" "}
                  · id {imp.id.slice(0, 8)}
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
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuAberto(menuAberto === imp.id ? null : imp.id)}
                      aria-label={`Ações da fatura ${imp.nome_arquivo}`}
                      aria-expanded={menuAberto === imp.id}
                      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {menuAberto === imp.id && (
                      <>
                        <button
                          type="button"
                          aria-hidden
                          tabIndex={-1}
                          className="fixed inset-0 z-10 cursor-default"
                          onClick={() => setMenuAberto(null)}
                        />
                        <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                          {podeDesfazerImportacao(imp.status) ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-muted"
                              onClick={() => {
                                setMenuAberto(null);
                                setParaDesfazer(imp);
                              }}
                            >
                              <RotateCcw className="size-4" /> Desfazer importação
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={!podeExcluirImportacao(imp.status)}
                            title={
                              podeExcluirImportacao(imp.status)
                                ? "Excluir o registro desta importação"
                                : "Desfaça a importação antes de excluir."
                            }
                            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => {
                              setMenuAberto(null);
                              setParaExcluir(imp);
                            }}
                          >
                            <Trash2 className="size-4" /> Excluir importação
                          </button>
                        </div>
                      </>
                    )}
                  </div>
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
      <UndoStatementImportDialog
        importacao={paraDesfazer}
        familyId={familyId}
        onClose={() => setParaDesfazer(null)}
      />
    </Card>
  );
}
