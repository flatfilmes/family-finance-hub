/**
 * FASE 3E — TELA ÚNICA DE REVISÃO DE EVIDÊNCIA.
 *
 * Serve para TODAS as origens (extrato PDF, fatura PDF, print de banco, print
 * de cartão, recibo e foto de compra). Não existe uma reconciliação diferente
 * por tela: existe uma engine, um plano e um executor canônico.
 *
 * Nenhum INSERT econômico acontece aqui: a UI só monta o ConfirmationPlan e
 * chama o executor, que por sua vez usa as operações canônicas do domínio.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Link2, Loader2, ShieldCheck } from "lucide-react";
import { PrimaryButton } from "@/components/page-header";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import {
  STATUS_LABELS,
  autoSelectableKeys,
  buildConfirmationPlan,
  type CandidateDecision,
  type ConfirmationAction,
  type ConfirmationPlan,
  type ReviewContext,
} from "@/lib/financial-evidence/plan";
import {
  batchSummary,
  confirmFinancialCandidates,
  type ConfirmationOutcome,
} from "@/lib/financial-evidence/confirm";
import { createConfirmDeps } from "@/lib/financial-evidence/confirm.data";
import type { CandidateResolution, EvidenceMatchStatus } from "@/lib/financial-evidence/types";

const BADGE: Record<EvidenceMatchStatus, string> = {
  EXACT_MATCH: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  STRONG_MATCH: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  POSSIBLE_MATCH: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  NEW_ITEM: "bg-primary/10 text-primary",
  NEW_IN_OVERLAP: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  CONFLICT: "bg-destructive/15 text-destructive",
  IGNORED: "bg-muted text-muted-foreground",
};

const ACTION_LABELS: Record<ConfirmationAction, string> = {
  LINK_PURCHASE: "Vincular ao existente",
  LINK_TRANSACTION: "Vincular ao lançamento",
  CREATE_PURCHASE: "Criar como novo",
  CREATE_BANK_MOVEMENT: "Criar movimentação",
  IGNORE: "Ignorar esta evidência",
  REVIEW_REQUIRED: "Revisar manualmente",
};

type Filtro = "TODOS" | "NOVOS" | "EXISTENTES" | "REVISAR" | "CONFLITOS" | "SELECIONADOS";

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "TODOS", rotulo: "Todos" },
  { valor: "NOVOS", rotulo: "Novos" },
  { valor: "EXISTENTES", rotulo: "Já cadastrados" },
  { valor: "REVISAR", rotulo: "Revisar" },
  { valor: "CONFLITOS", rotulo: "Conflitos" },
  { valor: "SELECIONADOS", rotulo: "Selecionados" },
];

function passaFiltro(plan: ConfirmationPlan, filtro: Filtro, selecionados: Set<string>) {
  const s = plan.originalStatus;
  switch (filtro) {
    case "NOVOS":
      return s === "NEW_ITEM";
    case "EXISTENTES":
      return s === "EXACT_MATCH" || s === "STRONG_MATCH";
    case "REVISAR":
      return s === "POSSIBLE_MATCH" || s === "NEW_IN_OVERLAP" || plan.action === "REVIEW_REQUIRED";
    case "CONFLITOS":
      return s === "CONFLICT";
    case "SELECIONADOS":
      return selecionados.has(plan.candidateKey);
    default:
      return true;
  }
}

export function FinancialEvidenceReview({
  resolutions,
  context,
  fileName,
  institutionName,
  onFinished,
}: {
  resolutions: CandidateResolution[];
  context: ReviewContext;
  fileName?: string;
  institutionName?: string;
  onFinished?: () => void;
}) {
  const queryClient = useQueryClient();
  const [decisoes, setDecisoes] = useState<Record<string, CandidateDecision>>({});
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [resultados, setResultados] = useState<ConfirmationOutcome[]>([]);

  const plans = useMemo(
    () =>
      resolutions.map((r) =>
        buildConfirmationPlan({
          resolution: r,
          context,
          ...(decisoes[r.candidate.sourceItemKey] ? { decision: decisoes[r.candidate.sourceItemKey]! } : {}),
        }),
      ),
    [resolutions, context, decisoes],
  );

  const conta = (s: EvidenceMatchStatus) => plans.filter((p) => p.originalStatus === s).length;
  const selecionaveis = autoSelectableKeys(plans);
  const selecao = plans.filter((p) => selecionados.has(p.candidateKey) && p.confirmable);
  const totalSelecionado = selecao.reduce(
    (t, p) => t + (p.action === "CREATE_PURCHASE" || p.action === "CREATE_BANK_MOVEMENT" ? p.economicAmount : 0),
    0,
  );
  const pendentes = conta("POSSIBLE_MATCH") + conta("NEW_IN_OVERLAP") + conta("CONFLICT") + conta("STRONG_MATCH");

  const status = (k: string) => resultados.find((r) => r.candidateKey === k)?.status;

  const confirmar = useMutation({
    mutationFn: async (alvo: ConfirmationPlan[]) =>
      confirmFinancialCandidates(alvo, context, createConfirmDeps()),
    onSuccess: (r) => {
      setResultados((antes) => [...antes.filter((a) => !r.some((n) => n.candidateKey === a.candidateKey)), ...r]);
      const s = batchSummary(r);
      const falhas = r.filter((o) => o.status === "FAILED");
      if (falhas.length > 0) toast.error(falhas[0]?.message ?? "Alguns itens falharam.");
      else
        toast.success(
          `Confirmados: ${s.confirmed} · Vinculados: ${s.linked} · Já processados: ${s.alreadyConfirmed}`,
        );
      for (const key of ["purchases", "transactions", "bank-accounts", "card-invoices", "expense-installments", "evidence-items-family"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setSelecionados(new Set());
      if (s.failed === 0 && s.needsReview === 0) onFinished?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visiveis = plans.filter((p) => passaFiltro(p, filtro, selecionados));

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-border bg-background p-4">
        <p className="text-sm font-extrabold">{fileName ?? "Evidência financeira"}</p>
        <p className="text-xs text-muted-foreground">
          {[institutionName, context.contextLabel, context.sourceType].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Detectados", plans.length],
            ["Já existentes", conta("EXACT_MATCH")],
            ["Provavelmente existentes", conta("STRONG_MATCH")],
            ["Revisar", conta("POSSIBLE_MATCH") + conta("NEW_IN_OVERLAP")],
            ["Novos", conta("NEW_ITEM")],
            ["Conflitos", conta("CONFLICT")],
          ].map(([rotulo, valor]) => (
            <div key={String(rotulo)} className="rounded-xl bg-muted/40 p-2">
              <p className="text-[11px] uppercase text-muted-foreground">{rotulo}</p>
              <p className="text-lg font-extrabold">{valor}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Selecionados para criação: <strong>{selecao.length}</strong> · Valor total selecionado:{" "}
          <strong>{formatCurrency(totalSelecionado)}</strong> — apenas prévia, ainda não é efeito
          financeiro.
        </p>
        {pendentes > 0 && (
          <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Revisar {pendentes} {pendentes === 1 ? "item" : "itens"} antes de qualquer confirmação.
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filtro === f.valor ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {visiveis.map((p) => {
          const r = resolutions.find((x) => x.candidate.sourceItemKey === p.candidateKey)!;
          const resultado = status(p.candidateKey);
          const podeSelecionar = selecionaveis.includes(p.candidateKey) || p.confirmable;
          return (
            <li key={p.candidateKey} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {podeSelecionar && (
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={selecionados.has(p.candidateKey)}
                      onChange={(e) =>
                        setSelecionados((s) => {
                          const novo = new Set(s);
                          if (e.target.checked) novo.add(p.candidateKey);
                          else novo.delete(p.candidateKey);
                          return novo;
                        })
                      }
                    />
                  )}
                  <div>
                    <p className="text-sm font-bold">{p.candidate.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.candidate.eventDate ? formatDate(p.candidate.eventDate) : "sem data"} ·{" "}
                      {p.candidate.direction === "OUT" ? "-" : "+"}
                      {formatCurrency(p.economicAmount)}
                      {p.candidate.cardLast4 ? ` · final ${p.candidate.cardLast4}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{r.reason}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${BADGE[p.originalStatus]}`}>
                  {STATUS_LABELS[p.originalStatus]}
                </span>
              </div>

              {p.matched && (
                <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Link2 className="size-3" /> Registro existente correspondente:{" "}
                  {p.matched.kind === "PURCHASE" ? "compra já cadastrada" : "lançamento já cadastrado"} ·{" "}
                  {formatCurrency(p.economicAmount)}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-1">
                {(
                  [
                    "LINK_PURCHASE",
                    "CREATE_PURCHASE",
                    "CREATE_BANK_MOVEMENT",
                    "IGNORE",
                    "REVIEW_REQUIRED",
                  ] as ConfirmationAction[]
                )
                  .filter((a) => {
                    if (p.originalStatus === "EXACT_MATCH") return a === "LINK_PURCHASE" || a === "IGNORE";
                    if (p.originalStatus === "CONFLICT") return a === "REVIEW_REQUIRED" || a === "IGNORE";
                    if (p.originalStatus === "NEW_ITEM" || p.originalStatus === "NEW_IN_OVERLAP")
                      return a !== "LINK_PURCHASE" && a !== "REVIEW_REQUIRED";
                    return a !== "CREATE_BANK_MOVEMENT" && a !== "REVIEW_REQUIRED";
                  })
                  .map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() =>
                        setDecisoes((d) => ({ ...d, [p.candidateKey]: { ...d[p.candidateKey], action: a } }))
                      }
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        p.action === a ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ACTION_LABELS[a]}
                    </button>
                  ))}
              </div>

              <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {p.expectedEffects.map((e) => (
                  <li key={e.description}>• {e.description}</li>
                ))}
              </ul>

              {p.missingFields.length > 0 && (
                <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  Falta: {p.missingFields.join(", ")}
                </p>
              )}
              {p.blockers.map((b) => (
                <p key={b} className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-destructive">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {b}
                </p>
              ))}
              {resultado && (
                <p className="mt-2 text-[11px] font-bold text-primary">Resultado: {resultado}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Cada item é confirmado individualmente e de forma
          idempotente. Nenhum valor é criado sem esta confirmação.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelecionados(new Set(selecionaveis))}
            className="rounded-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Selecionar novos completos ({selecionaveis.length})
          </button>
          <PrimaryButton
            type="button"
            disabled={selecao.length === 0 || confirmar.isPending}
            onClick={() => confirmar.mutate(selecao)}
          >
            {confirmar.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Confirmando…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4" /> Confirmar {selecao.length} lançamento
                {selecao.length === 1 ? "" : "s"}
              </span>
            )}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
