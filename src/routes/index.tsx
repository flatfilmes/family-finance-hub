import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Users, LineChart, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Família Finance AI — Inteligência financeira para a família" },
      {
        name: "description",
        content:
          "Organize receitas, despesas, contas e metas da família em um só lugar, com uma base pronta para análises inteligentes.",
      },
      { property: "og:title", content: "Família Finance AI" },
      {
        property: "og:description",
        content: "Controle, entenda e melhore a vida financeira da sua família.",
      },
    ],
  }),
  component: Landing,
});

const PILLARS = [
  {
    icon: Users,
    title: "Feito para a família",
    text: "Cada pessoa com seu papel: administrar, contribuir ou apenas acompanhar.",
  },
  {
    icon: LineChart,
    title: "Visão completa",
    text: "Receitas, despesas, cartões, contas e metas em uma estrutura organizada.",
  },
  {
    icon: ShieldCheck,
    title: "Privado por padrão",
    text: "Os dados da sua família só são vistos por quem tem permissão.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-surface-gradient">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground shadow-soft">
            <Sparkles className="size-[18px]" />
          </span>
          <span className="text-[15px] font-bold tracking-tight">Família Finance AI</span>
        </div>
        <Link
          to="/auth"
          className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-soft transition-colors hover:bg-accent"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <section className="pt-10 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Inteligência financeira familiar
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold text-balance-tight sm:text-6xl">
            A vida financeira da sua família, clara e sob controle.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Comece pela fundação: crie sua conta, monte sua família e registre o perfil financeiro.
            A estrutura já nasce preparada para receitas, despesas, metas e futuras análises
            inteligentes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary/90"
            >
              Criar conta gratuita
            </Link>
            <Link
              to="/auth"
              className="rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Já tenho conta
            </Link>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <article key={p.title} className="rounded-3xl border border-border bg-card p-6 shadow-card">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <p.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-bold">{p.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
