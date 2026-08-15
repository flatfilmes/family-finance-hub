import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { NoFamily } from "./receitas";
import {
  createCreditCard,
  deleteCreditCard,
  formatCurrency,
  toggleCreditCard,
} from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões de Crédito — Família Finance AI" },
      {
        name: "description",
        content: "Cadastre os cartões de crédito da família com limite, fechamento e vencimento.",
      },
      { property: "og:title", content: "Cartões de Crédito — Família Finance AI" },
      { property: "og:description", content: "Gerencie os cartões de crédito da sua família." },
    ],
  }),
  component: CartoesPage,
});

function CartoesPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: cards, isLoading } = useCreditCards(family?.id);
  const queryClient = useQueryClient();

  const [banco, setBanco] = useState("");
  const [nomeCartao, setNomeCartao] = useState("");
  const [limite, setLimite] = useState("");
  const [fechamento, setFechamento] = useState("1");
  const [vencimento, setVencimento] = useState("10");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["credit-cards", family?.id] });

  const clampDay = (v: string) => Math.min(31, Math.max(1, Number(v) || 1));

  const create = useMutation({
    mutationFn: () =>
      createCreditCard({
        family_id: family!.id,
        created_by: user?.id ?? null,
        banco,
        nome_cartao: nomeCartao,
        limite: Number(limite.replace(",", ".")) || 0,
        dia_fechamento: clampDay(fechamento),
        dia_vencimento: clampDay(vencimento),
      }),
    onSuccess: () => {
      setBanco("");
      setNomeCartao("");
      setLimite("");
      toast.success("Cartão cadastrado.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCreditCard(id),
    onSuccess: () => {
      toast.success("Cartão removido.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => toggleCreditCard(id, ativo),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const totalLimite = (cards ?? [])
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);

  if (!family) return <NoFamily />;

  return (
    <div>
      <PageHeader
        title="Cartões de Crédito"
        subtitle="Banco, limite, fechamento e vencimento de cada cartão da família."
      />

      <Card>
        <h2 className="text-base font-bold">Novo cartão</h2>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!banco.trim() || !nomeCartao.trim()) {
              toast.error("Informe o banco e o nome do cartão.");
              return;
            }
            create.mutate();
          }}
        >
          <Field label="Banco">
            <input
              className={inputClass}
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
              placeholder="Nubank, Itaú..."
            />
          </Field>
          <Field label="Nome do cartão">
            <input
              className={inputClass}
              value={nomeCartao}
              onChange={(e) => setNomeCartao(e.target.value)}
              placeholder="Cartão principal"
            />
          </Field>
          <Field label="Limite (R$)">
            <input
              className={inputClass}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Dia de fechamento">
              <input
                className={inputClass}
                value={fechamento}
                onChange={(e) => setFechamento(e.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Dia de vencimento">
              <input
                className={inputClass}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                inputMode="numeric"
              />
            </Field>
          </div>
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={create.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Plus className="size-4" />
                {create.isPending ? "Salvando..." : "Adicionar cartão"}
              </span>
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Cartões cadastrados</h2>
          <p className="text-sm text-muted-foreground">
            Limite total ativo:{" "}
            <span className="font-semibold text-foreground">{formatCurrency(totalLimite)}</span>
          </p>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : cards?.length ? (
          <ul className="mt-4 divide-y divide-border">
            {cards.map((c) => {
              const info = overview.porCartao.find((o) => o.card.id === c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {c.nome_cartao} · {c.banco}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fecha dia {c.dia_fechamento} · vence dia {c.dia_vencimento}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Limite:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(Number(c.limite))}
                        </span>
                      </span>
                      <span>
                        Fatura atual:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(info?.valorFaturaAtual ?? 0)}
                        </span>
                      </span>
                      <span>
                        Próximo vencimento:{" "}
                        <span className="font-semibold text-foreground">
                          {info?.proximoVencimento ? formatDate(info.proximoVencimento) : "—"}
                        </span>
                      </span>
                      <span>
                        Parcelas futuras:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(info?.parcelasFuturas ?? 0)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ id: c.id, ativo: !c.ativo })}
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      {c.ativo ? "Ativo" : "Inativo"}
                    </button>
                    <button
                      type="button"
                      aria-label="Remover cartão"
                      onClick={() => remove.mutate(c.id)}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Nenhum cartão cadastrado ainda.</p>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Compromissos futuros</h2>
          <p className="text-sm text-muted-foreground">
            Fatura atual:{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(overview.faturaAtualTotal)}
            </span>
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Parcelas já compromissadas nos próximos meses.
        </p>

        {overview.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : overview.proximosMeses.some((m) => m.total > 0) ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {overview.proximosMeses.map((m) => (
              <li key={m.key} className="rounded-2xl border border-border p-4">
                <p className="text-xs font-medium capitalize text-muted-foreground">{m.label}</p>
                <p className="mt-1 text-lg font-bold">{formatCurrency(m.total)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma parcela futura registrada. Compras parceladas no cartão aparecem aqui
            automaticamente.
          </p>
        )}
      </Card>

    </div>
  );
}
