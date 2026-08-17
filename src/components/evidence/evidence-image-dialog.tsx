import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ImageUp, Loader2, ShieldCheck } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import { usePurchases } from "@/hooks/usePurchases";
import { useTransactions } from "@/hooks/useTransactions";
import { useEvidenceItemsByFamily } from "@/hooks/useFinancialEvidence";
import { extractFinancialEvidenceImage } from "@/lib/financial-evidence/extract.functions";
import { imageReadingToCandidates } from "@/lib/financial-evidence/candidates";
import { reconcileFinancialCandidates } from "@/lib/financial-evidence/reconcile";
import {
  evidenceItemsToRecords,
  purchasesToRecords,
  transactionsToRecords,
} from "@/lib/financial-evidence/existing";
import {
  createEvidenceImport,
  findEvidenceByHash,
  hashArquivo,
  saveEvidenceResolutions,
  uploadEvidenceFile,
} from "@/lib/financial-evidence/data";
import { SOURCE_LABELS, type EvidenceSourceType, type UnifiedReconciliationResult } from "@/lib/financial-evidence/types";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";

const ACEITA = "image/jpeg,image/jpg,image/png,image/webp";

const BADGE: Record<string, string> = {
  EXACT_MATCH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  STRONG_MATCH: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  POSSIBLE_MATCH: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  NEW_ITEM: "bg-primary/10 text-primary",
  NEW_IN_OVERLAP: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  CONFLICT: "bg-destructive/15 text-destructive",
  IGNORED: "bg-muted text-muted-foreground",
};

const ROTULO: Record<string, string> = {
  EXACT_MATCH: "Já existe",
  STRONG_MATCH: "Provável duplicidade",
  POSSIBLE_MATCH: "Revisar",
  NEW_ITEM: "Novo",
  NEW_IN_OVERLAP: "Novo em período coberto",
  CONFLICT: "Conflito",
  IGNORED: "Ignorado",
};

async function paraBase64(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binario = "";
  for (const b of buffer) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * Ingestão de evidência em imagem (print do app, print de fatura, comprovante).
 *
 * A leitura acontece no servidor e o resultado é sempre um DRY RUN: candidatos
 * conciliados pela engine única. Salvar guarda a PROVA e a decisão sugerida —
 * nenhuma compra, movimentação ou saldo é alterado por esta tela.
 */
export function EvidenceImageDialog({
  sourceType,
  bankAccountId = null,
  creditCardId = null,
  institutionId = null,
  onClose,
}: {
  sourceType: EvidenceSourceType;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  institutionId?: string | null;
  onClose: () => void;
}) {
  const { data: family } = useFamily();
  const perms = usePermissions();
  const queryClient = useQueryClient();
  const extrair = useServerFn(extractFinancialEvidenceImage);

  const { data: purchases } = usePurchases(family?.id);
  const { data: transactions } = useTransactions(family?.id);
  const { data: evidenceItems } = useEvidenceItemsByFamily(family?.id);

  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<UnifiedReconciliationResult | null>(null);
  const [meta, setMeta] = useState<{ hash: string; provider: string; version: string } | null>(null);

  const existentes = useMemo(
    () => [
      ...purchasesToRecords(purchases ?? []),
      ...transactionsToRecords(transactions ?? []),
      ...evidenceItemsToRecords(
        (evidenceItems ?? []).map((i) => ({ ...i, amount: Number(i.amount) })),
      ),
    ],
    [purchases, transactions, evidenceItems],
  );

  const ler = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha uma imagem.");
      const hash = await hashArquivo(file);
      const jaEnviada = family
        ? await findEvidenceByHash({
            familyId: family.id,
            sourceType,
            fileHash: hash,
            bankAccountId,
            creditCardId,
          })
        : null;

      const leitura = await extrair({
        data: {
          imageBase64: await paraBase64(file),
          mimeType: file.type,
          contexto: SOURCE_LABELS[sourceType],
        },
      });
      if (leitura.status === "PROVIDER_NOT_CONFIGURED" || leitura.status === "FAILED" || leitura.status === "RATE_LIMITED")
        throw new Error(leitura.mensagem ?? "Não foi possível ler a imagem.");

      const candidatos = imageReadingToCandidates(
        leitura.itens.map((i) => ({ data: i.data, descricao: i.descricao, valor: i.valor, confianca: i.confianca, cardLast4: i.cardLast4 })),
        { evidenceId: jaEnviada?.id ?? hash, bankAccountId, creditCardId, institutionId },
        sourceType,
      );
      const reconciliado = reconcileFinancialCandidates({ candidates: candidatos, existing: existentes });
      return {
        hash,
        jaEnviada: !!jaEnviada,
        provider: leitura.provider,
        version: leitura.version,
        texto: leitura.textoDetectado,
        reconciliado,
      };
    },
    onSuccess: (r) => {
      setErro("");
      setTexto(r.texto);
      setResultado(r.reconciliado);
      setMeta({ hash: r.hash, provider: r.provider, version: r.version });
      setAviso(
        r.jaEnviada
          ? "Esta mesma imagem já havia sido enviada neste contexto — a leitura é idempotente e nada será duplicado."
          : "",
      );
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "Falha na leitura."),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!family || !file || !resultado || !meta) throw new Error("Leia a imagem primeiro.");
      const storagePath = await uploadEvidenceFile({ familyId: family.id, fileHash: meta.hash, file });
      const importado =
        (await findEvidenceByHash({
          familyId: family.id,
          sourceType,
          fileHash: meta.hash,
          bankAccountId,
          creditCardId,
        })) ??
        (await createEvidenceImport({
          familyId: family.id,
          memberId: perms.myMemberId || null,
          sourceType,
          fileHash: meta.hash,
          storagePath,
          mimeType: file.type,
          fileName: file.name,
          bankAccountId,
          creditCardId,
          institutionId,
          provider: meta.provider,
          version: meta.version,
          rawText: texto,
        }));
      await saveEvidenceResolutions({
        familyId: family.id,
        importId: importado.id,
        resolutions: resultado.resolutions,
      });
      return importado;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["evidence-imports"] });
      queryClient.invalidateQueries({ queryKey: ["evidence-items-family"] });
      toast.success("Evidência guardada. Nenhum valor financeiro foi alterado.");
      onClose();
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "Não foi possível guardar a evidência."),
  });

  const s = resultado?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-card sm:rounded-3xl">
        <h2 className="text-xl font-extrabold">Enviar evidência ({SOURCE_LABELS[sourceType]})</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A imagem é apenas prova. Nada é criado automaticamente: você confere os lançamentos antes de
          qualquer decisão financeira.
        </p>

        <div className="mt-4">
          <Field label="Imagem (print ou foto)">
            <input
              type="file"
              accept={ACEITA}
              className={inputClass}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResultado(null);
                setAviso("");
                setErro("");
              }}
            />
          </Field>
        </div>

        {aviso && (
          <p className="mt-3 rounded-2xl bg-amber-500/15 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {aviso}
          </p>
        )}

        {resultado && s && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Lidos", s.total],
                ["Já existem", s.exactMatch + s.strongMatch],
                ["Revisar", s.possibleMatch + s.newInOverlap + s.conflict],
                ["Novos", s.newItem],
              ].map(([rotulo, valor]) => (
                <div key={String(rotulo)} className="rounded-2xl border border-border bg-background p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">{rotulo}</p>
                  <p className="text-lg font-extrabold">{valor}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Data</th>
                    <th className="p-2">Descrição</th>
                    <th className="p-2 text-right">Valor</th>
                    <th className="p-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.resolutions.map((r) => (
                    <tr key={r.candidate.sourceItemKey} className="border-t border-border align-top">
                      <td className="p-2 whitespace-nowrap">
                        {r.candidate.eventDate ? formatDate(r.candidate.eventDate) : "—"}
                      </td>
                      <td className="p-2">
                        <p className="font-semibold">{r.candidate.description}</p>
                        <p className="text-[11px] text-muted-foreground">{r.reason}</p>
                      </td>
                      <td className="p-2 text-right font-semibold whitespace-nowrap">
                        {r.candidate.direction === "OUT" ? "-" : "+"}
                        {formatCurrency(Math.abs(r.candidate.amount))}
                      </td>
                      <td className="p-2">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${BADGE[r.status]}`}>
                          {ROTULO[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {resultado.blockers.length > 0 && (
              <ul className="rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                {resultado.blockers.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            )}

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary" /> Guardar a evidência não cria compras nem
              altera saldos.
            </p>
          </div>
        )}

        {erro && <p className="mt-3 text-sm font-semibold text-destructive">{erro}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          {!resultado ? (
            <PrimaryButton type="button" onClick={() => ler.mutate()} disabled={!file || ler.isPending}>
              {ler.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Lendo imagem…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ImageUp className="size-4" /> Ler imagem
                </span>
              )}
            </PrimaryButton>
          ) : (
            <PrimaryButton type="button" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Guardando…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4" /> Guardar evidência
                </span>
              )}
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}
