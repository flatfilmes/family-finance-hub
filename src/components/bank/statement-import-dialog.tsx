import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Image as ImageIcon } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { PrimaryButton, inputClass } from "@/components/page-header";
import { PdfDiagnosticButton } from "@/components/pdf-diagnostic/pdf-diagnostic-button";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import {
  pdfDiagnosticFlagEnabled,
  setPdfDiagnosticFlag,
} from "@/lib/pdf-diagnostic/availability";
import { usePurchases } from "@/hooks/usePurchases";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardInvoices } from "@/hooks/useCardInvoices";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomes } from "@/hooks/useFinanceData";
import { readBankScreenshot } from "@/lib/bank-screenshot.functions";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import { normalizeDescricao } from "@/lib/card-statement-parsers/generic";
import { readBankStatementPdf } from "@/lib/bank-statement-parsers";
import { bankStatementDryRun } from "@/lib/bank-statement-parsers/diagnostic";
import {
  ACOES_SEM_EFEITO,
  MATCH_LABELS,
  REVIEW_ACTIONS,
  REVIEW_ACTION_LABELS,
  classificarMovimento,
  confirmBankStatementImport,
  createBankStatementImport,
  findExistingStatementImport,
  reconcileMovement,
  resumoDoExtrato,
  statementFingerprint,
  type ParsedBankStatement,
  type ReviewAction,
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
 * Fluxo único de leitura: upload → dry run → diagnóstico → revisão →
 * conciliação → confirmação. Nada é persistido antes da revisão do usuário.
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
  const { data: transactions } = useTransactions(familyId);
  const { data: incomes } = useIncomes(familyId);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState(false);
  const [resumo, setResumo] = useState<ParsedBankStatement | null>(null);
  const [linhas, setLinhas] = useState<StatementDraftRow[]>([]);
  const [saldoLido, setSaldoLido] = useState<number | null>(null);
  const [textoDetectado, setTextoDetectado] = useState("");
  const [diagnostico, setDiagnostico] = useState(0);

  const reconciliar = (parsed: ParsedBankStatement): StatementDraftRow[] =>
    parsed.movimentos.map((m) => {
      const sugestao = reconcileMovement(m, {
        accountId: account!.id,
        purchases: purchases ?? [],
        invoices: invoices ?? [],
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        incomes: incomes ?? [],
      });
      return {
        ...m,
        sugestao,
        acao: sugestao.reviewAction,
        incluir: !ACOES_SEM_EFEITO.includes(sugestao.reviewAction),
      };
    });

  const ler = useMutation({
    mutationFn: async (file: File) => {
      const fp = await statementFingerprint(file);
      const jaImportado = await findExistingStatementImport(account!.id, fp);
      if (modo === "PDF") {
        const parsed = await readBankStatementPdf(file);
        return { parsed, saldo: parsed.saldoFinal, texto: "", fp, jaImportado: !!jaImportado };
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
      return {
        parsed,
        saldo: leitura.saldo,
        texto: leitura.textoDetectado,
        fp,
        jaImportado: !!jaImportado,
      };
    },
    onSuccess: ({ parsed, saldo, texto, fp, jaImportado }) => {
      setResumo(parsed);
      setLinhas(reconciliar(parsed));
      setSaldoLido(saldo);
      setTextoDetectado(texto);
      setFingerprint(fp);
      setDuplicado(jaImportado);
      if (jaImportado) toast.warning("Este extrato já foi importado nesta conta.");
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
        fingerprint,
        resumo: resumo!,
        linhas,
      });
      return confirmBankStatementImport(imp.id);
    },
    onSuccess: (r) => {
      toast.success(
        `${r.criadas} lançamento(s) criado(s), ${r.associadas} associado(s), ${r.ignoradas} ignorado(s).`,
      );
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", familyId] });
      queryClient.invalidateQueries({ queryKey: ["purchases", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-invoices", familyId] });
      queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", account?.id] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totais = resumoDoExtrato(linhas);
  const comEfeito = linhas.filter((l) => !ACOES_SEM_EFEITO.includes(l.acao));

  const contagem = useMemo(() => {
    const por = (acao: ReviewAction) => linhas.filter((l) => l.acao === acao).length;
    return {
      total: linhas.length,
      associadas: por("ASSOCIATE_EXISTING"),
      possiveis: linhas.filter((l) => l.sugestao.matchStatus === "POSSIBLE_MATCH").length,
      novas: linhas.filter((l) => l.sugestao.matchStatus === "NEW").length,
      transferencias: por("MATCH_TRANSFER"),
      cartao: por("MATCH_CARD_PAYMENT"),
      receitas: por("MATCH_INCOME"),
      tarifas: por("REGISTER_FEE"),
      estornos: por("REGISTER_REFUND"),
      ignoradas: por("IGNORE"),
    };
  }, [linhas]);

  // Validação do próprio extrato: saldo inicial + entradas - saídas = saldo final?
  const conferencia = useMemo(() => {
    if (!resumo || resumo.saldoInicial === null || resumo.saldoFinal === null) return null;
    const esperado = resumo.saldoInicial + totais.entradas - totais.saidas;
    const diferenca = Number((resumo.saldoFinal - esperado).toFixed(2));
    return { esperado, diferenca, ok: Math.abs(diferenca) <= 0.02 };
  }, [resumo, totais.entradas, totais.saidas]);

  // Confronto com o saldo do sistema (nunca corrigido automaticamente).
  const diferencaSistema =
    resumo?.saldoFinal != null && account
      ? Number((resumo.saldoFinal - Number(account.saldo_atual ?? 0)).toFixed(2))
      : null;

  const setAcao = (i: number, acao: ReviewAction) =>
    setLinhas((rows) =>
      rows.map((r, idx) =>
        idx === i ? { ...r, acao, incluir: !ACOES_SEM_EFEITO.includes(acao) } : r,
      ),
    );

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
            {arquivo ? arquivo.name : modo === "PDF" ? "Selecionar PDF do extrato" : "Escolher imagem"}
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
              setDuplicado(false);
              setFingerprint(null);
              if (f && modo === "IMAGEM") ler.mutate(f);
            }}
          />
        </label>

        {modo === "PDF" && arquivo && (
          <div className="space-y-2 rounded-2xl border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Arquivo selecionado: <strong className="text-foreground">{arquivo.name}</strong>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PdfDiagnosticButton
                source="BANK_STATEMENT"
                file={arquivo}
                parserDryRun={bankStatementDryRun}
              />
              <button
                type="button"
                onClick={() => ler.mutate(arquivo)}
                disabled={ler.isPending}
                className="ml-auto rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {ler.isPending ? "Processando…" : "Revisar extrato"}
              </button>
            </div>
            <DiagnosticoHint onEnable={() => setDiagnostico((n) => n + 1)} key={diagnostico} />
          </div>
        )}


        {ler.isPending && <p className="text-sm text-muted-foreground">Lendo o documento...</p>}

        {duplicado && (
          <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm font-semibold text-warning-foreground">
            Este extrato já foi importado. Confirme novamente apenas se quiser revisar as ações —
            nada é duplicado.
          </p>
        )}

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

            <div className="flex flex-wrap gap-2 text-[11px]">
              <Chip label="Movimentações" valor={contagem.total} />
              <Chip label="Associadas" valor={contagem.associadas} />
              <Chip label="Possíveis" valor={contagem.possiveis} />
              <Chip label="Novas" valor={contagem.novas} />
              <Chip label="Transferências" valor={contagem.transferencias} />
              <Chip label="Pagamentos de cartão" valor={contagem.cartao} />
              <Chip label="Receitas" valor={contagem.receitas} />
              <Chip label="Tarifas" valor={contagem.tarifas} />
              <Chip label="Estornos" valor={contagem.estornos} />
              <Chip label="Ignoradas" valor={contagem.ignoradas} />
            </div>

            {conferencia && (
              <p
                className={`rounded-2xl p-3 text-xs font-semibold ${
                  conferencia.ok
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {conferencia.ok
                  ? "STATEMENT_BALANCE_OK — saldo inicial + entradas − saídas fecha com o saldo final."
                  : `STATEMENT_BALANCE_MISMATCH — diferença de ${formatCurrency(
                      Math.abs(conferencia.diferenca),
                    )} no próprio extrato. Nada é ajustado automaticamente.`}
              </p>
            )}

            {diferencaSistema !== null && Math.abs(diferencaSistema) > 0.02 && (
              <p className="rounded-2xl bg-muted p-3 text-xs text-muted-foreground">
                Saldo do sistema {formatCurrency(Number(account?.saldo_atual ?? 0))} · saldo do
                extrato {formatCurrency(resumo.saldoFinal ?? 0)} · diferença{" "}
                <strong>{formatCurrency(Math.abs(diferencaSistema))}</strong>. Há uma diferença a
                revisar — depois de conciliar, use “Informar saldo” para criar um ajuste auditável.
              </p>
            )}

            {linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma movimentação interpretada neste documento.
              </p>
            ) : (
              <div className="max-h-[46vh] overflow-auto rounded-2xl border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Situação</th>
                      <th className="px-3 py-2">Ação</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => (
                      <tr key={`${l.descricaoOriginal}-${i}`} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {l.data ? formatDate(l.data) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold">{l.descricaoOriginal}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {l.sugestao.motivo}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {MATCH_LABELS[l.sugestao.matchStatus]}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Ação para ${l.descricaoOriginal}`}
                            className={inputClass}
                            value={l.acao}
                            onChange={(e) => setAcao(i, e.target.value as ReviewAction)}
                          >
                            {REVIEW_ACTIONS.map((a) => (
                              <option key={a} value={a}>
                                {REVIEW_ACTION_LABELS[a]}
                              </option>
                            ))}
                          </select>
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
              Compras já lançadas, pagamentos de fatura e transferências vêm como “associar” para
              não duplicar valores. Transferência não vira gasto nem renda e pagamento de fatura não
              vira compra.
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
                disabled={confirmar.isPending || linhas.length === 0}
                onClick={() => confirmar.mutate()}
              >
                {confirmar.isPending
                  ? "Confirmando..."
                  : `Confirmar revisão (${comEfeito.length} com efeito)`}
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

function Chip({ label, valor }: { label: string; valor: number }) {
  return (
    <span className="rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground">
      {label}: <strong className="text-foreground">{valor}</strong>
    </span>
  );
}

/**
 * Atalho para ADMIN ligar a flag interna de diagnóstico sem usar a query string.
 * Não altera dados: apenas revela o botão "Modo diagnóstico PDF".
 */
function DiagnosticoHint({ onEnable }: { onEnable: () => void }) {
  const perms = usePermissions();
  if (!perms.isAdmin || pdfDiagnosticFlagEnabled() || import.meta.env.DEV) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setPdfDiagnosticFlag(true);
        onEnable();
      }}
      className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline"
    >
      Ativar modo diagnóstico PDF
    </button>
  );
}
