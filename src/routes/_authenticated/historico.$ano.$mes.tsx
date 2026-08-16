import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, Lock } from "lucide-react";
import { PageHeader, Card, Field, inputClass } from "@/components/page-header";
import { MemberFilter } from "@/components/member-filter";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import { useMonthlySnapshots, useReopenMonth } from "@/hooks/useMonthlySnapshots";
import {
  competenciaLabel,
  formatVariacao,
  previousCompetencia,
  variacao,
  type MonthlySnapshot,
} from "@/lib/monthly-snapshots";
import { HEALTH_CLASSES, HEALTH_LABELS, type HealthStatus } from "@/lib/financial-engine";
import { formatCurrency } from "@/lib/finance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Search = { membro?: string };

export const Route = createFileRoute("/_authenticated/historico/$ano/$mes")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    membro: typeof search.membro === "string" ? search.membro : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Detalhe do mês — Família Finance AI" },
      {
        name: "description",
        content: "Retrato financeiro completo de uma competência fechada da sua família.",
      },
      { property: "og:title", content: "Detalhe do mês — Família Finance AI" },
      {
        property: "og:description",
        content: "Receitas, gastos, faturas e dinheiro livre preservados no fechamento do mês.",
      },
    ],
  }),
  component: DetalheMes,
});

function DetalheMes() {
  const { ano, mes } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const perms = usePermissions();
  const snapshots = useMonthlySnapshots(family?.id);
  const reopen = useReopenMonth(family?.id);
  const [motivo, setMotivo] = useState("");

  const competencia = { ano: Number(ano), mes: Number(mes) };
  const escopo = perms.isAdmin ? (search.membro ?? "") : perms.myMemberId;

  const lista = snapshots.data ?? [];
  const snapshot =
    lista.find(
      (s) => s.ano === competencia.ano && s.mes === competencia.mes && (s.member_id ?? "") === escopo,
    ) ?? null;

  const anterior = previousCompetencia(competencia);
  const snapshotAnterior =
    lista.find(
      (s) => s.ano === anterior.ano && s.mes === anterior.mes && (s.member_id ?? "") === escopo,
    ) ?? null;

  const nomeMembro = (members ?? []).find((m) => m.id === escopo)?.nome;

  return (
    <div>
      <Link
        to="/historico"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Histórico
      </Link>

      <PageHeader
        title={competenciaLabel(competencia)}
        subtitle={
          escopo
            ? `Retrato financeiro de ${nomeMembro ?? "membro"} nesta competência.`
            : "Retrato financeiro consolidado da família nesta competência."
        }
      />

      {perms.isAdmin && (
        <div className="mb-6 w-56">
          <MemberFilter
            familyId={family?.id}
            value={escopo}
            onChange={(v) =>
              navigate({
                to: "/historico/$ano/$mes",
                params: { ano, mes },
                search: { membro: v || undefined },
              })
            }
          />
        </div>
      )}

      {!snapshot ? (
        <Card>
          <p className="text-sm font-semibold">Sem fechamento registrado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta competência ainda não foi fechada para o escopo selecionado. O histórico não é
            recalculado com os registros atuais.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <StatusBanner snapshot={snapshot} />

          <Card>
            <h2 className="text-sm font-bold">Receitas</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">
              <Item label="Fixa" value={Number(snapshot.renda_fixa)} />
              <Item label="Variável prevista" value={Number(snapshot.renda_variavel_prevista)} />
              <Item label="Variável recebida" value={Number(snapshot.renda_variavel_recebida)} />
              <Item label="Total real" value={Number(snapshot.receita_total_real)} destaque />
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-bold">Gastos da competência</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Item label="Pix / Débito / Dinheiro" value={Number(snapshot.compras_pix_debito_dinheiro)} />
              <Item label="Cartão à vista" value={Number(snapshot.compras_cartao)} />
              <Item label="Parcelas do mês" value={Number(snapshot.parcelas_do_mes)} />
              <Item label="Recorrências" value={Number(snapshot.recorrencias_do_mes)} />
              <Item label="Contas recorrentes" value={Number(snapshot.contas_recorrentes_do_mes)} />
              <Item label="Total gasto" value={Number(snapshot.gastos_realizados)} destaque />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-sm font-bold">Bancos e cartões</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Item label="Saldo final" value={Number(snapshot.saldo_bancario_final)} />
                <Item label="Faturas em aberto" value={Number(snapshot.faturas_em_aberto)} />
                <Item label="Faturas pagas" value={Number(snapshot.faturas_pagas)} />
              </div>
            </Card>

            <Card>
              <h2 className="text-sm font-bold">Situação final</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Item label="Comprometido" value={Number(snapshot.comprometido_final)} />
                <Item label="Reserva" value={Number(snapshot.reserva_final)} />
                <Item label="Dinheiro livre" value={Number(snapshot.dinheiro_livre_final)} destaque />
              </div>
            </Card>
          </div>

          {snapshotAnterior && (
            <Card>
              <h2 className="text-sm font-bold">
                Comparação com {competenciaLabel(anterior)}
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-4">
                <Compare
                  label="Receita"
                  atual={Number(snapshot.receita_total_real)}
                  anterior={Number(snapshotAnterior.receita_total_real)}
                />
                <Compare
                  label="Gastos"
                  atual={Number(snapshot.gastos_realizados)}
                  anterior={Number(snapshotAnterior.gastos_realizados)}
                />
                <Compare
                  label="Cartão"
                  atual={Number(snapshot.compras_cartao) + Number(snapshot.parcelas_do_mes)}
                  anterior={
                    Number(snapshotAnterior.compras_cartao) + Number(snapshotAnterior.parcelas_do_mes)
                  }
                />
                <Compare
                  label="Dinheiro livre"
                  atual={Number(snapshot.dinheiro_livre_final)}
                  anterior={Number(snapshotAnterior.dinheiro_livre_final)}
                />
              </div>
            </Card>
          )}

          {perms.isAdmin && snapshot.fechado && (
            <Card>
              <h2 className="text-sm font-bold">Reabrir mês</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Somente o administrador familiar pode reabrir uma competência. A reabertura é
                registrada na auditoria e o histórico anterior não é apagado silenciosamente.
              </p>
              <Dialog>
                <DialogTrigger className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted">
                  <RotateCcw className="size-4" /> Reabrir {competenciaLabel(competencia)}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reabrir competência</DialogTitle>
                    <DialogDescription>
                      O mês será marcado como reaberto e poderá ser recalculado e fechado novamente.
                    </DialogDescription>
                  </DialogHeader>
                  <Field label="Motivo (opcional)">
                    <input
                      className={inputClass}
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: correção de compra lançada com valor errado"
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={reopen.isPending}
                    onClick={() =>
                      reopen.mutate({
                        ano: competencia.ano,
                        mes: competencia.mes,
                        motivo: motivo.trim() || undefined,
                      })
                    }
                    className="mt-4 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {reopen.isPending ? "Reabrindo..." : "Confirmar reabertura"}
                  </button>
                </DialogContent>
              </Dialog>
            </Card>
          )}

          {!snapshot.fechado && perms.isAdmin && (
            <Link
              to="/historico/fechar/$ano/$mes"
              params={{ ano, mes }}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Recalcular e fechar novamente
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBanner({ snapshot }: { snapshot: MonthlySnapshot }) {
  const status = snapshot.status_saude_financeira as HealthStatus;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${HEALTH_CLASSES[status]?.badge ?? ""}`}>
        Saúde financeira: {HEALTH_LABELS[status] ?? status}
      </span>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5" />
        {snapshot.fechado
          ? `Fechado em ${new Date(snapshot.fechado_em).toLocaleString("pt-BR")} — alterações posteriores não modificam este retrato.`
          : `Reaberto em ${snapshot.reaberto_em ? new Date(snapshot.reaberto_em).toLocaleString("pt-BR") : "-"}${snapshot.motivo_reabertura ? ` — ${snapshot.motivo_reabertura}` : ""}`}
      </span>
    </div>
  );
}

function Item({ label, value, destaque = false }: { label: string; value: number; destaque?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold ${destaque ? "text-lg text-primary" : "text-base"}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function Compare({ label, atual, anterior }: { label: string; atual: number; anterior: number }) {
  const delta = variacao(atual, anterior);
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-bold">{formatCurrency(atual)}</p>
      <p className="text-xs text-muted-foreground">
        {formatVariacao(delta)} · antes {formatCurrency(anterior)}
      </p>
    </div>
  );
}
