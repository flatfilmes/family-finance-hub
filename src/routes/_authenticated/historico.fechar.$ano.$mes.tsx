import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCloseMonth,
  useMonthClosingPreview,
  useMonthlySnapshots,
} from "@/hooks/useMonthlySnapshots";
import { competenciaLabel } from "@/lib/monthly-snapshots";
import { HEALTH_CLASSES, HEALTH_LABELS } from "@/lib/financial-engine";
import { formatCurrency } from "@/lib/finance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/historico/fechar/$ano/$mes")({
  head: () => ({
    meta: [
      { title: "Fechar mês — Família Finance AI" },
      {
        name: "description",
        content: "Revise receitas, gastos, faturas e dinheiro livre antes de fechar a competência.",
      },
      { property: "og:title", content: "Fechar mês — Família Finance AI" },
      {
        property: "og:description",
        content: "Confirme o retrato financeiro do mês antes de preservá-lo no histórico.",
      },
    ],
  }),
  component: FecharMes,
});

function FecharMes() {
  const { ano, mes } = Route.useParams();
  const navigate = useNavigate();
  const { data: family } = useFamily();
  const perms = usePermissions();
  const competencia = { ano: Number(ano), mes: Number(mes) };

  const preview = useMonthClosingPreview(family?.id, competencia);
  const snapshots = useMonthlySnapshots(family?.id);
  const fechar = useCloseMonth(family?.id);
  const [erro, setErro] = useState("");

  const jaFechado = (snapshots.data ?? []).find(
    (s) => s.ano === competencia.ano && s.mes === competencia.mes && s.member_id === null,
  );

  const d = preview.familiar;

  if (!perms.isLoading && !perms.isAdmin) {
    return (
      <div>
        <PageHeader title="Fechar mês" subtitle="Ação restrita ao administrador familiar." />
        <Card>
          <p className="text-sm text-muted-foreground">
            Somente o administrador familiar pode fechar ou reabrir uma competência.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/historico"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Histórico
      </Link>

      <PageHeader
        title={`Fechar ${competenciaLabel(competencia)}`}
        subtitle="Revise o resumo da competência. Ao confirmar, estes números viram o retrato histórico do período e não mudam mais automaticamente."
      />

      {jaFechado?.fechado && (
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400">
          Este mês já foi fechado em {new Date(jaFechado.fechado_em).toLocaleDateString("pt-BR")}.
          Confirmar novamente substitui o retrato e registra a ação na auditoria.
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Resumo da família</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${HEALTH_CLASSES[d.status_saude_financeira].badge}`}
          >
            {HEALTH_LABELS[d.status_saude_financeira]}
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Row label="Receitas recebidas" value={d.receita_total_real} />
          <Row label="Renda variável prevista" value={d.renda_variavel_prevista} />
          <Row label="Renda variável recebida" value={d.renda_variavel_recebida} />
          <Row label="Gastos realizados" value={d.gastos_realizados} />
          <Row label="Contas recorrentes pagas/devidas" value={d.contas_recorrentes_do_mes} />
          <Row label="Parcelas do mês" value={d.parcelas_do_mes} />
          <Row label="Recorrências" value={d.recorrencias_do_mes} />
          <Row label="Faturas em aberto" value={d.faturas_em_aberto} />
          <Row label="Faturas pagas" value={d.faturas_pagas} />
          <Row label="Saldo bancário final" value={d.saldo_bancario_final} />
          <Row label="Comprometido" value={d.comprometido_final} />
          <Row label="Reserva" value={d.reserva_final} />
          <Row label="Dinheiro livre" value={d.dinheiro_livre_final} destaque />
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-bold">Alertas antes de confirmar</h2>
        {d.alertas.length === 0 ? (
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" /> Nenhum ponto de atenção encontrado.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {d.alertas.map((a) => (
              <li key={a.tipo} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>
                  <strong className="font-semibold">{a.tipo}:</strong>{" "}
                  <span className="text-muted-foreground">{a.descricao}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Os alertas não impedem o fechamento — servem para você decidir com clareza.
        </p>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-bold">Snapshots individuais</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Além do consolidado da família, um retrato é criado para cada pessoa.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-2">Pessoa</th>
                <th className="py-2">Receita</th>
                <th className="py-2">Gastos</th>
                <th className="py-2">Saldo</th>
                <th className="py-2">Dinheiro livre</th>
              </tr>
            </thead>
            <tbody>
              {preview.individuais.map(({ member, draft }) => (
                <tr key={member.id} className="border-t border-border">
                  <td className="py-2 font-medium">{member.nome}</td>
                  <td className="py-2">{formatCurrency(draft.receita_total_real)}</td>
                  <td className="py-2">{formatCurrency(draft.gastos_realizados)}</td>
                  <td className="py-2">{formatCurrency(draft.saldo_bancario_final)}</td>
                  <td className="py-2">{formatCurrency(draft.dinheiro_livre_final)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {erro && <p className="mb-4 text-sm font-semibold text-red-600">{erro}</p>}

      <Dialog>
        <DialogTrigger
          disabled={preview.isLoading || fechar.isPending}
          className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft hover:bg-primary/90 disabled:opacity-60"
        >
          Confirmar fechamento
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar fechamento de {competenciaLabel(competencia)}</DialogTitle>
            <DialogDescription>
              Após o fechamento, os indicadores históricos deste mês serão preservados como retrato
              financeiro do período. Alterações posteriores em compras, cartões ou bancos não mudam
              este histórico automaticamente.
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            disabled={fechar.isPending}
            onClick={() => {
              setErro("");
              fechar.mutate(preview.drafts, {
                onSuccess: () =>
                  navigate({
                    to: "/historico/$ano/$mes",
                    params: { ano, mes },
                    search: { membro: "" },
                  }),
                onError: (e) => setErro((e as Error).message),
              });
            }}
            className="mt-4 w-full rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {fechar.isPending ? "Fechando..." : "Fechar mês agora"}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, destaque = false }: { label: string; value: number; destaque?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold ${destaque ? "text-lg text-primary" : "text-base"}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
