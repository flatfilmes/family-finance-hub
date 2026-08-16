import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Image as ImageIcon } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { PrimaryButton, inputClass } from "@/components/page-header";
import { PdfDiagnosticButton } from "@/components/pdf-diagnostic/pdf-diagnostic-button";
import { useAuth } from "@/hooks/useAuth";
import { usePurchases } from "@/hooks/usePurchases";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardInvoices } from "@/hooks/useCardInvoices";
import { readBankScreenshot } from "@/lib/bank-screenshot.functions";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import { normalizeDescricao } from "@/lib/card-statement-parsers/generic";
import {
  MATCH_LABELS,
  MOVEMENT_KINDS,
  MOVEMENT_KIND_LABELS,
  classificarMovimento,
  confirmBankStatementImport,
  createBankStatementImport,
  readBankStatementPdf,
  reconcileMovement,
  resumoDoExtrato,
  type BankMovementKind,
  type ParsedBankStatement,
  type StatementDraftRow,
} from "@/lib/bank-statements";
import type { BankAccount } from "@/lib/bank-accounts";

type Modo = "PDF" | "IMAGEM";

async function toBase64(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binario = "";
  for (const byte of buffer) binario += String.fromCharCode(byte);
  return btoa(binario);
}

/**
 * Fluxo único de leitura: upload → dry run → diagnóstico → revisão → confirmação.
 * Nenhuma movimentação é persistida antes da revisão do usuário.
 */
export function BankStatementDialog({
  account,
  familyId,
  modo,
  onClose,
  onUsarSaldo,
}: {
  account: BankAccount | null;
  familyId: string;
  modo: Modo;
  onClose: () => void;
  /** Print que mostra apenas saldo: oferece usar como posição atual. */
  onUsarSaldo: (valor: number) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: purchases } = usePurchases(familyId);
  const { data: accounts } = useBankAccounts(familyId);
  const { data: invoices } = useCardInvoices(familyId);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [resumo, setResumo] = useState<ParsedBankStatement | null>(null);
  const [linhas, setLinhas] = useState<StatementDraftRow[]>([]);
  const [saldoLido, setSaldoLido] = useState<number | null>(null);
  const [textoDetectado, setTextoDetectado] = useState("");

  const reconciliar = (parsed: ParsedBankStatement): StatementDraftRow[] =>
    parsed.movimentos.map((m) => {
      const sugestao = reconcileMovement(m, {
        accountId: account!.id,
        purchases: purchases ?? [],
        invoices: invoices ?? [],
        accounts: accounts ?? [],
      });
      return { ...m, sugestao, incluir: sugestao.matchStatus === "NEW" };
    });

  const ler = useMutation({
    mutationFn: async (file: File) => {
      if (modo === "PDF") {
        const parsed = await readBankStatementPdf(file);
        return { parsed, saldo: parsed.saldoFinal, texto: "" };
      }
      const leitura = await readBankScreenshot({
        data: { imageBase64: await toBase64(file), mimeType: file.type },
      });
      const parsed: ParsedBankStatement = {
        parser: "PRINT_IMAGEM_IA",
        periodoInicio: leitura.movimentos[0]?.data ?? null,
        periodoFim: leitura.movimentos[leitura.movimentos.length - 1]?.data ?? null,
        saldoInicial: null,
        saldoFinal: leitura.saldo,
        movimentos: leitura.movimentos.map((m) => ({
          data: m.data,
          descricaoOriginal: m.descricao,
          descricaoNormalizada: normalizeDescricao(m.descricao),
          valor: m.valor,
          tipo: classificarMovimento(m.descricao, m.valor),
        })),
        aceitos: leitura.movimentos.map((m) => ({ raw: m.descricao, valor: m.valor })),
        rejeitados: [],
      };
      return { parsed, saldo: leitura.saldo, texto: leitura.textoDetectado };
    },
    onSuccess: ({ parsed, saldo, texto }) => {
      setResumo(parsed);
      setLinhas(reconciliar(parsed));
      setSaldoLido(saldo);
      setTextoDetectado(texto);
      if (!parsed.movimentos.length && saldo === null) {
        toast.error("Não conseguimos interpretar este arquivo. Use o modo diagnóstico.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      const imp = await createBankStatementImport({
        familyId,
        bankAccountId: account!.id,
        memberId: account!.member_id,
        nomeArquivo: arquivo?.name ?? "extrato",
        formato: modo,
        parser: resumo!.parser,
        createdBy: user?.id ?? null,
        resumo: resumo!,
        linhas,
      });
      return confirmBankStatementImport(imp.id);
    },
    onSuccess: (r) => {
      toast.success(`${r.criadas} movimentação(ões) criada(s). ${r.ignoradas} já existiam.`);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", familyId] });
      queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", account?.id] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totais = resumoDoExtrato(linhas.filter((l) => l.incluir));

  return (
    <FormDialog
      open={!!account}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={modo === "PDF" ? "Importar extrato" : "Enviar print"}
      description={
        modo === "PDF"
          ? "Envie o extrato em PDF. Nada é lançado antes da sua revisão."
          : "Envie um print do app do banco. Nada é lançado antes da sua revisão."
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center transition-colors hover:bg-muted/50">
          {modo === "PDF" ? (
            <FileUp className="size-6 text-muted-foreground" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold">
            {arquivo ? arquivo.name : modo === "PDF" ? "Escolher PDF do extrato" : "Escolher imagem"}
          </span>
          <span className="text-xs text-muted-foreground">
            {modo === "PDF" ? "PDF hoje · CSV e OFX em breve" : "PNG, JPG ou HEIC"}
          </span>
          <input
            type="file"
            className="hidden"
            accept={modo === "PDF" ? "application/pdf" : "image/*"}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setArquivo(f);
              setResumo(null);
              setLinhas([]);
              if (f) ler.mutate(f);
            }}
          />
        </label>

        {modo === "PDF" && arquivo && (
          <PdfDiagnosticButton
            source="BANK_STATEMENT"
            file={arquivo}
            parserDryRun={async (file) => {
              const parsed = await readBankStatementPdf(file);
              return {
                parser: parsed.parser,
                output: parsed,
                debug: {
                  accepted: parsed.aceitos,
                  rejected: parsed.rejeitados,
                  metadata: [
                    { campo: "Período início", valor: parsed.periodoInicio },
                    { campo: "Período fim", valor: parsed.periodoFim },
                    { campo: "Saldo inicial", valor: parsed.saldoInicial },
                    { campo: "Saldo final", valor: parsed.saldoFinal },
                    { campo: "Movimentações", valor: parsed.movimentos.length },
                  ],
                },
              };
            }}
          />
        )}

        {ler.isPending && <p className="text-sm text-muted-foreground">Lendo o documento...</p>}

        {modo === "IMAGEM" && saldoLido !== null && (
          <div className="rounded-2xl border border-border p-4">
            <p className="text-xs font-semibold text-muted-foreground">Saldo identificado</p>
            <p className="mt-1 text-xl font-bold">{formatCurrency(saldoLido)}</p>
            <PrimaryButton
              type="button"
              className="mt-3"
              onClick={() => {
                onUsarSaldo(saldoLido);
                onClose();
              }}
            >
              Usar este saldo como posição atual
            </PrimaryButton>
          </div>
        )}

        {resumo && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/60 p-4 text-sm sm:grid-cols-4">
              <Resumo label="Saldo inicial" valor={resumo.saldoInicial} />
              <Resumo label="Entradas" valor={totais.entradas} />
              <Resumo label="Saídas" valor={-totais.saidas} />
              <Resumo label="Saldo final" valor={resumo.saldoFinal} />
            </div>

            {linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma movimentação interpretada neste documento.
              </p>
            ) : (
              <div className="max-h-[46vh] overflow-auto rounded-2xl border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Incluir</th>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Situação</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {linhas.map((l, i) => (
                      <tr key={`${l.descricaoOriginal}-${i}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Incluir ${l.descricaoOriginal}`}
                            checked={l.incluir}
                            onChange={(e) =>
                              setLinhas((rows) =>
                                rows.map((r, idx) =>
                                  idx === i ? { ...r, incluir: e.target.checked } : r,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {l.data ? formatDate(l.data) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="block font-semibold">{l.descricaoOriginal}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {l.sugestao.motivo}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Tipo de ${l.descricaoOriginal}`}
                            className={inputClass}
                            value={l.tipo}
                            onChange={(e) =>
                              setLinhas((rows) =>
                                rows.map((r, idx) =>
                                  idx === i
                                    ? { ...r, tipo: e.target.value as BankMovementKind }
                                    : r,
                                ),
                              )
                            }
                          >
                            {MOVEMENT_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {MOVEMENT_KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {MATCH_LABELS[l.sugestao.matchStatus]}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                          {l.valor >= 0 ? "+" : "-"}
                          {formatCurrency(Math.abs(l.valor))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Lançamentos já existentes no sistema (compras, pagamento de fatura, transferências)
              vêm desmarcados para não duplicar valores. O saldo informado anteriormente continua
              sendo apenas o ponto de partida.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <PrimaryButton
                type="button"
                disabled={confirmar.isPending || !linhas.some((l) => l.incluir)}
                onClick={() => confirmar.mutate()}
              >
                {confirmar.isPending
                  ? "Confirmando..."
                  : `Confirmar ${linhas.filter((l) => l.incluir).length} movimentação(ões)`}
              </PrimaryButton>
            </div>
          </div>
        )}

        {modo === "IMAGEM" && textoDetectado && (
          <details className="rounded-2xl border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              Diagnóstico da imagem · texto detectado
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
              {textoDetectado}
            </pre>
          </details>
        )}
      </div>
    </FormDialog>
  );
}

function Resumo({ label, valor }: { label: string; valor: number | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-bold">{valor === null ? "—" : formatCurrency(valor)}</p>
    </div>
  );
}
