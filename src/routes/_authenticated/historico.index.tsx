import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, History, ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { MemberFilter } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { useFamily } from "@/hooks/useFamilyData";
import { useMonthlySnapshots, useClosingLogs } from "@/hooks/useMonthlySnapshots";
import {
  competenciaLabel,
  formatVariacao,
  variacao,
  podeFechar,
  competenciaFromMonth,
} from "@/lib/monthly-snapshots";
import { HEALTH_CLASSES, HEALTH_LABELS, type HealthStatus } from "@/lib/financial-engine";
import { formatCurrency } from "@/lib/finance";
import { currentMonth, previousMonth } from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/historico/")({
  head: () => ({
    meta: [
      { title: "Histórico mensal — Família Finance AI" },
      {
        name: "description",
        content: "Retrato financeiro fechado de cada mês da sua família, preservado no tempo.",
      },
      { property: "og:title", content: "Histórico mensal — Família Finance AI" },
      {
        property: "og:description",
        content: "Consulte os fechamentos mensais da sua família sem recalcular o passado.",
      },
    ],
  }),
  component: HistoricoPage,
});

function HistoricoPage() {
  const { data: family } = useFamily();
  const view = useViewMode();
  const [filtroMembro, setFiltroMembro] = useState("");
  const escopo = view.scoped(filtroMembro);

  const snapshots = useMonthlySnapshots(family?.id);
  const logs = useClosingLogs(family?.id);

  const lista = (snapshots.data ?? []).filter((s) => (s.member_id ?? "") === escopo);

  const atual = competenciaFromMonth(currentMonth());
  const anterior = competenciaFromMonth(previousMonth(currentMonth()));
  const sugerida = podeFechar(atual) ? atual : anterior;
  const jaFechada = (snapshots.data ?? []).some(
    (s) => s.ano === sugerida.ano && s.mes === sugerida.mes && s.member_id === null && s.fechado,
  );

  return (
    <div>
      <PageHeader
        title="Histórico mensal"
        subtitle="Cada mês fechado vira um retrato financeiro preservado — os números do passado não mudam quando você edita registros antigos."
      />

      <section className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <ViewModeSwitch
            mode={view.mode}
            onChange={(m) => {
              view.setMode(m);
              if (m === "minha") setFiltroMembro("");
            }}
            canSwitch={view.canSwitchView}
          />
          {view.canSwitchView && view.mode === "familia" && (
            <div className="w-48">
              <MemberFilter familyId={family?.id} value={filtroMembro} onChange={setFiltroMembro} />
            </div>
          )}
        </div>
        {view.isAdmin && (
          <Link
            to="/historico/fechar/$ano/$mes"
            params={{ ano: String(sugerida.ano), mes: String(sugerida.mes) }}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft hover:bg-primary/90"
          >
            <CalendarCheck className="size-4" />
            {jaFechada ? "Revisar" : "Fechar"} {competenciaLabel(sugerida)}
          </Link>
        )}
      </section>

      {lista.length === 0 ? (
        <Card>
          <div className="flex items-start gap-3">
            <History className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Nenhum mês fechado ainda</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ao fechar uma competência, os indicadores daquele período ficam guardados aqui como
                retrato histórico.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {lista.map((s, index) => {
            const previo = lista[index + 1];
            const status = s.status_saude_financeira as HealthStatus;
            return (
              <Link
                key={s.id}
                to="/historico/$ano/$mes"
                params={{ ano: String(s.ano), mes: String(s.mes) }}
                search={{ membro: escopo }}
                className="rounded-3xl border border-border bg-card p-6 shadow-card transition hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold capitalize">
                      {competenciaLabel({ ano: s.ano, mes: s.mes })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.fechado
                        ? `Fechado em ${new Date(s.fechado_em).toLocaleDateString("pt-BR")}`
                        : "Reaberto — aguardando novo fechamento"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${HEALTH_CLASSES[status]?.badge ?? ""}`}
                  >
                    {HEALTH_LABELS[status] ?? status}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-4">
                  <Metric
                    label="Receita"
                    value={Number(s.receita_total_real)}
                    delta={previo ? variacao(Number(s.receita_total_real), Number(previo.receita_total_real)) : null}
                    positivoBom
                  />
                  <Metric
                    label="Gastos"
                    value={Number(s.gastos_realizados)}
                    delta={previo ? variacao(Number(s.gastos_realizados), Number(previo.gastos_realizados)) : null}
                  />
                  <Metric label="Saldo final" value={Number(s.saldo_bancario_final)} delta={null} positivoBom />
                  <Metric label="Dinheiro livre" value={Number(s.dinheiro_livre_final)} delta={null} positivoBom />
                </div>

                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Ver detalhe do mês <ArrowRight className="size-4" />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {(logs.data ?? []).length > 0 && (
        <Card className="mt-6">
          <h2 className="text-sm font-bold">Auditoria de fechamento</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {(logs.data ?? []).slice(0, 10).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                  {l.acao === "FECHAR_MES" ? "Fechamento" : "Reabertura"}
                </span>
                <span className="capitalize">{competenciaLabel({ ano: l.ano, mes: l.mes })}</span>
                <span>· {new Date(l.created_at).toLocaleString("pt-BR")}</span>
                {l.motivo && <span>· {l.motivo}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  delta,
  positivoBom = false,
}: {
  label: string;
  value: number;
  delta: number | null;
  positivoBom?: boolean;
}) {
  const bom = delta === null ? null : positivoBom ? delta >= 0 : delta <= 0;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{formatCurrency(value)}</p>
      {delta !== null && (
        <p
          className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${
            bom ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {formatVariacao(delta)} vs mês anterior
        </p>
      )}
    </div>
  );
}
