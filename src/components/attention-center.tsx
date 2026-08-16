import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BellRing, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { RegistrarPagamentoDialog } from "@/components/purchase-payment";
import { useAttention } from "@/hooks/useAttention";
import { PRIORIDADE_LABEL, PRIORIDADE_TONE, type AttentionItem } from "@/lib/attention";
import { TONE_BORDERS, TONE_DOTS } from "@/lib/status";
import { formatCurrency } from "@/lib/finance";

/**
 * "Precisa da sua atenção": lista curta e acionável das pendências do dia a dia.
 * Cada ação leva para o fluxo que já existe — nada é decidido automaticamente.
 */
export function AttentionCenter({
  familyId,
  memberId = "",
  podeAgir = true,
}: {
  familyId?: string | undefined;
  memberId?: string;
  podeAgir?: boolean;
}) {
  const { itens, urgentes, comprasPendentes } = useAttention(familyId, memberId);
  const [pagandoId, setPagandoId] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  const compra = comprasPendentes.find((p) => p.id === pagandoId) ?? null;
  const visiveis = verTodos ? itens : itens.slice(0, 5);

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <BellRing className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-bold">Precisa da sua atenção</h2>
            <p className="text-xs text-muted-foreground">
              Pendências reais do período, em ordem de urgência.
            </p>
          </div>
        </div>
        {itens.length > 0 && (
          <StatusBadge tone={urgentes > 0 ? "danger" : "warn"}>
            {itens.length} pendência{itens.length > 1 ? "s" : ""}
          </StatusBadge>
        )}
      </div>

      {itens.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-5" />}
          title="Tudo em dia por aqui"
          description="Nenhuma conta, fatura ou pagamento pendente exige ação agora."
        />
      ) : (
        <ul className="space-y-2.5">
          {visiveis.map((item) => (
            <Linha
              key={item.id}
              item={item}
              podeAgir={podeAgir}
              onRegistrarPagamento={setPagandoId}
            />
          ))}
        </ul>
      )}

      {itens.length > 5 && (
        <button
          type="button"
          onClick={() => setVerTodos((v) => !v)}
          className="mt-3 text-xs font-semibold text-primary"
        >
          {verTodos ? "Mostrar menos" : `Ver todas (${itens.length})`}
        </button>
      )}

      {compra && <RegistrarPagamentoDialog purchase={compra} onClose={() => setPagandoId("")} />}
    </Card>
  );
}

function Linha({
  item,
  podeAgir,
  onRegistrarPagamento,
}: {
  item: AttentionItem;
  podeAgir: boolean;
  onRegistrarPagamento: (id: string) => void;
}) {
  const tone = PRIORIDADE_TONE[item.prioridade];
  const acaoClass =
    "inline-flex min-h-9 items-center rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted";

  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border ${TONE_BORDERS[tone]} bg-card px-4 py-3`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOTS[tone]}`} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.titulo}</p>
          <p className="text-xs text-muted-foreground">
            {item.detalhe}
            {item.valor !== undefined && ` · ${formatCurrency(item.valor)}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone={tone}>{PRIORIDADE_LABEL[item.prioridade]}</StatusBadge>
        {item.acao.purchaseId
          ? podeAgir && (
              <button
                type="button"
                onClick={() => onRegistrarPagamento(item.acao.purchaseId!)}
                className={acaoClass}
              >
                {item.acao.label}
              </button>
            )
          : item.acao.to && (
              <Link
                {...({ to: item.acao.to, params: item.acao.params } as never)}
                className={acaoClass}
              >
                {item.acao.label}
              </Link>
            )}
      </div>
    </li>
  );
}
