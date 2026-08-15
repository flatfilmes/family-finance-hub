import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Users, Wallet, Brain } from "lucide-react";
import { PageHeader, Card } from "@/components/page-header";
import { useFamily, useFinancialProfile, useMembers, useProfile } from "@/hooks/useFamilyData";
import { GOAL_LABELS } from "@/lib/family";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Família Finance AI" },
      { name: "description", content: "Visão geral da estrutura financeira da sua família." },
      { property: "og:title", content: "Dashboard — Família Finance AI" },
      { property: "og:description", content: "Visão geral da sua família no Família Finance AI." },
    ],
  }),
  component: Dashboard,
});

const FUTURE_MODULES = [
  "Receitas e despesas",
  "Cartões e contas fixas",
  "Compras e produtos",
  "Metas financeiras",
  "Análises e recomendações de IA",
];

function Dashboard() {
  const { data: profile } = useProfile();
  const { data: family, isLoading } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: financial } = useFinancialProfile(family?.id);

  const primeiroNome = profile?.nome_completo?.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        subtitle="Esta é a fundação do seu sistema financeiro familiar. Complete os passos abaixo para deixar tudo pronto."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Users className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-bold">Minha Família</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "Carregando..."
              : family
                ? `${family.nome_da_familia} · ${members?.length ?? 0} membro(s)`
                : "Nenhuma família criada ainda."}
          </p>
          <Link
            to="/minha-familia"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            {family ? "Gerenciar membros" : "Criar minha família"}
            <ArrowRight className="size-4" />
          </Link>
        </Card>

        <Card>
          <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Wallet className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-bold">Perfil Financeiro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {financial?.objetivo_principal
              ? `Objetivo: ${GOAL_LABELS[financial.objetivo_principal]}`
              : "Ainda não preenchido."}
          </p>
          <Link
            to="/perfil-financeiro"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >
            {financial ? "Atualizar informações" : "Preencher perfil"}
            <ArrowRight className="size-4" />
          </Link>
        </Card>
      </div>

      <Card className="mt-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Brain className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-bold">Próximos módulos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A arquitetura já está preparada para receber estes módulos nas próximas fases.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {FUTURE_MODULES.map((m) => (
            <li
              key={m}
              className="rounded-full border border-border bg-muted px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {m}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
