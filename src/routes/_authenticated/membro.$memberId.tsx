import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Card, Field, inputClass, PageHeader, PrimaryButton } from "@/components/page-header";
import { AddButton, FormDialog } from "@/components/form-dialog";
import { EmptyState } from "@/components/empty-state";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useMemberProfiles } from "@/hooks/useMemberProfiles";
import { useIncomes, useCreditCards } from "@/hooks/useFinanceData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePermissions } from "@/hooks/usePermissions";
import { IncomeForm } from "@/components/forms/income-form";
import { BankAccountForm } from "@/components/forms/bank-account-form";
import { CreditCardForm } from "@/components/forms/credit-card-form";
import {
  archiveCreditCard,
  deleteCreditCardIfUnused,
  formatCurrency,
  toggleIncome,
  deleteIncome,
  type CreditCard,
  type Income,
} from "@/lib/finance";
import {
  BANK_ACCOUNT_TYPE_LABELS,
  archiveBankAccount,
  deleteBankAccountIfUnused,
  type BankAccount,
} from "@/lib/bank-accounts";
import { ConfirmDialog, RecordActions, type RecordAction } from "@/components/record-actions";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import {
  MEMBER_PROFILE_DESCRIPTIONS,
  MEMBER_PROFILE_LABELS,
  MEMBER_PROFILE_TYPES,
  upsertMemberProfile,
  type MemberProfileType,
} from "@/lib/member-profiles";
import { PERMISSION_DESCRIPTIONS, PERMISSION_LABELS, type FamilyPermission } from "@/lib/family";
import { supabase } from "@/integrations/supabase/client";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/membro/$memberId")({
  head: () => ({
    meta: [
      { title: "Perfil do Membro — Família Finance AI" },
      {
        name: "description",
        content: "Cadastro de dados pessoais, receitas, contas bancárias e cartões do membro.",
      },
      { property: "og:title", content: "Perfil do Membro — Família Finance AI" },
      {
        property: "og:description",
        content: "Área cadastral de cada pessoa da família.",
      },
    ],
  }),
  component: MembroPage,
});

const TABS = ["Dados pessoais", "Receitas", "Contas bancárias", "Cartões"] as const;
type Tab = (typeof TABS)[number];
const PERMISSOES: FamilyPermission[] = ["ADMIN", "MEMBER", "VIEWER"];


function Row({
  title,
  subtitle,
  value,
  actions,
}: {
  title: string;
  subtitle: string;
  value: string;
  actions?: RecordAction[];
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-sm font-semibold">{value}</span>
        {actions ? <RecordActions label={title} actions={actions} /> : null}
      </div>
    </li>
  );
}

function MembroPage() {
  const { memberId } = useParams({ from: "/_authenticated/membro/$memberId" });
  const queryClient = useQueryClient();
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: profiles } = useMemberProfiles(family?.id);
  const { isAdmin, isViewer, myMemberId } = usePermissions();
  const podeGerenciar = isAdmin || (!isViewer && myMemberId === memberId);

  const { data: incomes } = useIncomes(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: cards } = useCreditCards(family?.id);

  const [tab, setTab] = useState<Tab>("Dados pessoais");
  const [cadastro, setCadastro] = useState<"receita" | "conta" | "cartao" | null>(null);
  const [editIncome, setEditIncome] = useState<Income | null>(null);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [editCard, setEditCard] = useState<CreditCard | null>(null);
  const [ajusteConta, setAjusteConta] = useState<BankAccount | null>(null);
  const [confirmacao, setConfirmacao] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    blocked?: boolean;
    run?: () => Promise<void>;
  } | null>(null);
  const [nome, setNome] = useState("");
  const [relacionamento, setRelacionamento] = useState("");

  const member = members?.find((m) => m.id === memberId);

  useEffect(() => {
    if (!member) return;
    setNome(member.nome);
    setRelacionamento(member.relacionamento ?? "");
  }, [member?.id, member?.nome, member?.relacionamento]);

  const saveDados = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("family_members")
        .update({ nome: nome.trim(), relacionamento: relacionamento.trim() || null })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados atualizados.");
      queryClient.invalidateQueries({ queryKey: ["members", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateProfile = useMutation({
    mutationFn: (tipo: MemberProfileType) =>
      upsertMemberProfile({
        familyId: family!.id,
        familyMemberId: memberId,
        tipoPerfil: tipo,
        podeLancarDespesas: tipo === "ADMIN_FAMILIAR" || tipo === "MEMBRO",
        podeVerPropriosDados: tipo !== "VISUALIZADOR",
      }),
    onSuccess: () => {
      toast.success("Perfil financeiro atualizado.");
      queryClient.invalidateQueries({ queryKey: ["member-profiles", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePermission = useMutation({
    mutationFn: async (value: FamilyPermission) => {
      const { error } = await supabase
        .from("family_members")
        .update({ permissao: value })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Permissão atualizada.");
      queryClient.invalidateQueries({ queryKey: ["members", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalidarFinancas = () => {
    for (const key of [
      "incomes",
      "bank-accounts",
      "credit-cards",
      "transactions",
      "card-invoices",
      "purchases",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key, family?.id] });
    }
  };

  const executarAcao = useMutation({
    mutationFn: async () => {
      await confirmacao?.run?.();
    },
    onSuccess: () => {
      toast.success("Ação concluída.");
      invalidarFinancas();
      setConfirmacao(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!family) return <NoFamily />;

  if (!member) {
    return (
      <div>
        <PageHeader title="Membro não encontrado" subtitle="Volte para a lista da família." />
        <Link to="/configuracoes" className="text-sm font-semibold text-primary">
          Voltar para Configurações
        </Link>
      </div>
    );
  }

  const perfil = profiles?.find((p) => p.family_member_id === member.id)?.tipo_perfil ?? "MEMBRO";
  const mine = <T extends { member_id: string | null }>(rows?: T[]) =>
    (rows ?? []).filter((r) => r.member_id === member.id);

  const myIncomes = mine(incomes);
  const myAccounts = mine(accounts);
  const myCards = mine(cards);

  const incomeActions = (i: Income): RecordAction[] => [
    { label: "Editar", onSelect: () => setEditIncome(i), disabled: !podeGerenciar },
    {
      label: i.ativo ? "Arquivar" : "Reativar",
      disabled: !podeGerenciar,
      onSelect: () =>
        setConfirmacao({
          title: i.ativo ? "Arquivar receita" : "Reativar receita",
          description: i.ativo
            ? "A receita deixa de entrar nos cálculos, mas o histórico é mantido."
            : "A receita volta a entrar nos cálculos do mês.",
          confirmLabel: i.ativo ? "Arquivar" : "Reativar",
          run: () => toggleIncome(i.id, !i.ativo),
        }),
    },
    {
      label: "Excluir",
      destructive: true,
      disabled: !isAdmin,
      onSelect: () =>
        setConfirmacao({
          title: "Excluir receita",
          description: "A receita será removida definitivamente. Prefira arquivar para manter o histórico.",
          confirmLabel: "Excluir",
          run: () => deleteIncome(i.id),
        }),
    },
  ];

  const accountActions = (a: BankAccount): RecordAction[] => [
    { label: "Editar", onSelect: () => setEditAccount(a), disabled: !podeGerenciar },
    { label: "Ajustar saldo", onSelect: () => setAjusteConta(a), disabled: !podeGerenciar },
    {
      label: a.ativo ? "Arquivar" : "Reativar",
      disabled: !podeGerenciar,
      onSelect: () =>
        setConfirmacao({
          title: a.ativo ? "Arquivar conta" : "Reativar conta",
          description: a.ativo
            ? "A conta some das seleções de pagamento, mas o extrato continua disponível."
            : "A conta volta a ficar disponível para novos lançamentos.",
          confirmLabel: a.ativo ? "Arquivar" : "Reativar",
          run: () => archiveBankAccount(a.id, !a.ativo),
        }),
    },
    {
      label: "Excluir",
      destructive: true,
      disabled: !isAdmin,
      onSelect: () =>
        setConfirmacao({
          title: "Excluir conta bancária",
          description:
            "A conta só pode ser excluída se não tiver nenhuma movimentação vinculada. Caso contrário, arquive-a.",
          confirmLabel: "Excluir",
          run: () => deleteBankAccountIfUnused(a.id),
        }),
    },
  ];

  const cardActions = (c: CreditCard): RecordAction[] => [
    { label: "Editar", onSelect: () => setEditCard(c), disabled: !podeGerenciar },
    {
      label: c.ativo ? "Arquivar" : "Reativar",
      disabled: !podeGerenciar,
      onSelect: () =>
        setConfirmacao({
          title: c.ativo ? "Arquivar cartão" : "Reativar cartão",
          description: c.ativo
            ? "O cartão some das novas compras, mas as faturas e parcelas continuam ativas."
            : "O cartão volta a ficar disponível para novas compras.",
          confirmLabel: c.ativo ? "Arquivar" : "Reativar",
          run: () => archiveCreditCard(c.id, !c.ativo),
        }),
    },
    {
      label: "Excluir",
      destructive: true,
      disabled: !isAdmin,
      onSelect: () =>
        setConfirmacao({
          title: "Excluir cartão",
          description:
            "O cartão só pode ser excluído se não tiver faturas, compras ou parcelas vinculadas. Caso contrário, arquive-o.",
          confirmLabel: "Excluir",
          run: () => deleteCreditCardIfUnused(c.id),
        }),
    },
  ];

  const fixas = myIncomes.filter((i) => i.tipo === "FIXA");
  const variaveis = myIncomes.filter((i) => i.tipo !== "FIXA");

  return (
    <div>
      <Link
        to="/configuracoes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Configurações · Família e Finanças
      </Link>

      <PageHeader
        title={member.nome}
        subtitle={`${MEMBER_PROFILE_LABELS[perfil]} · área cadastral. Análises ficam no Dashboard.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                : "rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Dados pessoais" && (
        <>
          <Card className="max-w-xl">
            <h2 className="text-base font-bold">Dados pessoais</h2>
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveDados.mutate();
              }}
            >
              <Field label="Nome">
                <input
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className={inputClass}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Relacionamento">
                <input
                  value={relacionamento}
                  onChange={(e) => setRelacionamento(e.target.value)}
                  className={inputClass}
                  placeholder="Cônjuge, filho..."
                  disabled={!isAdmin}
                />
              </Field>
              {isAdmin && (
                <PrimaryButton type="submit" disabled={saveDados.isPending}>
                  {saveDados.isPending ? "Salvando..." : "Salvar dados"}
                </PrimaryButton>
              )}
            </form>
          </Card>

          <Card className="mt-4 max-w-xl">
            <h2 className="text-base font-bold">Perfil e permissões</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                  Perfil financeiro
                </span>
                <select
                  aria-label={`Perfil financeiro de ${member.nome}`}
                  value={perfil}
                  disabled={!isAdmin}
                  onChange={(e) => updateProfile.mutate(e.target.value as MemberProfileType)}
                  className={inputClass}
                >
                  {MEMBER_PROFILE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MEMBER_PROFILE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                  Permissão de acesso
                </span>
                <select
                  aria-label={`Permissão de ${member.nome}`}
                  value={member.permissao}
                  disabled={!isAdmin}
                  onChange={(e) => updatePermission.mutate(e.target.value as FamilyPermission)}
                  className={inputClass}
                >
                  {PERMISSOES.map((p) => (
                    <option key={p} value={p}>
                      {PERMISSION_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {MEMBER_PROFILE_DESCRIPTIONS[perfil]}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {PERMISSION_DESCRIPTIONS[member.permissao]}
            </p>
          </Card>
        </>
      )}

      {tab === "Receitas" && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Receitas de {member.nome}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Salário como receita fixa, comissão como variável.
                </p>
              </div>
              <AddButton onClick={() => setCadastro("receita")}>Nova receita</AddButton>
            </div>
          </Card>

          <FormDialog
            open={cadastro === "receita"}
            onOpenChange={(open) => setCadastro(open ? "receita" : null)}
            title={`Nova receita de ${member.nome}`}
            description="Salário como receita fixa, comissão como variável."
          >
            <IncomeForm
              familyId={family.id}
              memberId={member.id}
              onSaved={() => setCadastro(null)}
              onCancel={() => setCadastro(null)}
            />
          </FormDialog>

          <Card className="mt-4">
            <h2 className="text-base font-bold">Receita fixa</h2>
            <p className="mt-1 text-xs text-muted-foreground">Renda garantida todo mês.</p>
            {fixas.length ? (
              <ul className="mt-2 divide-y divide-border">
                {fixas.map((i) => (
                  <Row
                    key={i.id}
                    title={i.descricao}
                    subtitle={`Fixa · ${i.frequencia === "MENSAL" && i.dia_recebimento ? `todo dia ${i.dia_recebimento}` : i.frequencia.toLowerCase()}${i.ativo ? "" : " · inativa"}`}
                    value={formatCurrency(Number(i.valor))}
                    actions={incomeActions(i)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Nenhuma receita fixa cadastrada"
                description="Cadastre o salário ou outra renda garantida para os cálculos do Dashboard."
                action={<AddButton onClick={() => setCadastro("receita")}>Nova receita</AddButton>}
              />
            )}
          </Card>

          <Card className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">Receita variável</h2>
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                Não é renda garantida
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Valores usados apenas como média estimada nos cálculos.
            </p>
            {variaveis.length ? (
              <ul className="mt-2 divide-y divide-border">
                {variaveis.map((i) => (
                  <Row
                    key={i.id}
                    title={i.descricao}
                    subtitle={`Média · ${i.frequencia === "MENSAL" && i.dia_recebimento ? `todo dia ${i.dia_recebimento}` : i.frequencia.toLowerCase()}${i.ativo ? "" : " · inativa"}`}
                    value={formatCurrency(Number(i.valor))}
                    actions={incomeActions(i)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Nenhuma receita variável cadastrada"
                description="Comissões e rendas eventuais entram aqui como média estimada."
                action={<AddButton onClick={() => setCadastro("receita")}>Nova receita</AddButton>}
              />
            )}
          </Card>
        </>
      )}

      {tab === "Contas bancárias" && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Contas bancárias</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  A conta fica registrada com {member.nome} como titular.
                </p>
              </div>
              <AddButton onClick={() => setCadastro("conta")}>Nova conta</AddButton>
            </div>
          </Card>

          <FormDialog
            open={cadastro === "conta"}
            onOpenChange={(open) => setCadastro(open ? "conta" : null)}
            title="Nova conta bancária"
            description={`A conta fica registrada com ${member.nome} como titular.`}
          >
            <BankAccountForm
              familyId={family.id}
              memberId={member.id}
              onSaved={() => setCadastro(null)}
              onCancel={() => setCadastro(null)}
            />
          </FormDialog>
          <Card className="mt-4">
            <h2 className="text-base font-bold">Contas de {member.nome}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Extratos e movimentações ficam na página Bancos.
            </p>
            {myAccounts.length ? (
              <ul className="mt-2 divide-y divide-border">
                {myAccounts.map((a) => (
                  <Row
                    key={a.id}
                    title={`${a.banco} · ${a.nome_conta}`}
                    subtitle={`${BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}${a.ativo ? "" : " · inativa"}`}
                    value={formatCurrency(Number(a.saldo_atual))}
                    actions={accountActions(a)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Nenhuma conta bancária cadastrada"
                description={`Cadastre a conta de ${member.nome} para acompanhar saldo e extrato.`}
                action={<AddButton onClick={() => setCadastro("conta")}>Nova conta</AddButton>}
              />
            )}
            <Link to="/bancos" className="mt-4 inline-block text-sm font-semibold text-primary">
              Ver movimentações em Bancos
            </Link>
          </Card>
        </>
      )}

      {tab === "Cartões" && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Cartões</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  O cartão fica vinculado a {member.nome}.
                </p>
              </div>
              <AddButton onClick={() => setCadastro("cartao")}>Novo cartão</AddButton>
            </div>
          </Card>

          <FormDialog
            open={cadastro === "cartao"}
            onOpenChange={(open) => setCadastro(open ? "cartao" : null)}
            title="Novo cartão de crédito"
            description={`O cartão fica vinculado a ${member.nome}.`}
          >
            <CreditCardForm
              familyId={family.id}
              memberId={member.id}
              onSaved={() => setCadastro(null)}
              onCancel={() => setCadastro(null)}
            />
          </FormDialog>
          <Card className="mt-4">
            <h2 className="text-base font-bold">Cartões de {member.nome}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Faturas, parcelamentos e recorrências ficam na página Cartões.
            </p>
            {myCards.length ? (
              <ul className="mt-2 divide-y divide-border">
                {myCards.map((c) => (
                  <Row
                    key={c.id}
                    title={`${c.banco} · ${c.nome_cartao}`}
                    subtitle={`Fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}${c.ativo ? "" : " · inativo"}`}
                    value={formatCurrency(Number(c.limite))}
                    actions={cardActions(c)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Nenhum cartão cadastrado"
                description={`Cadastre o cartão de ${member.nome} para acompanhar fatura e limite.`}
                action={<AddButton onClick={() => setCadastro("cartao")}>Novo cartão</AddButton>}
              />
            )}
            <Link to="/cartoes" className="mt-4 inline-block text-sm font-semibold text-primary">
              Ver faturas em Cartões
            </Link>
          </Card>
        </>
      )}

      <FormDialog
        open={!!editIncome}
        onOpenChange={(open) => {
          if (!open) setEditIncome(null);
        }}
        title="Editar receita"
        description="Altere valor, tipo ou dia do recebimento."
      >
        {editIncome && (
          <IncomeForm
            familyId={family.id}
            memberId={member.id}
            income={editIncome}
            onSaved={() => setEditIncome(null)}
            onCancel={() => setEditIncome(null)}
          />
        )}
      </FormDialog>

      <FormDialog
        open={!!editAccount}
        onOpenChange={(open) => {
          if (!open) setEditAccount(null);
        }}
        title="Editar conta bancária"
        description="O saldo é corrigido pela ação Ajustar saldo."
      >
        {editAccount && (
          <BankAccountForm
            familyId={family.id}
            memberId={member.id}
            account={editAccount}
            onSaved={() => setEditAccount(null)}
            onCancel={() => setEditAccount(null)}
          />
        )}
      </FormDialog>

      <FormDialog
        open={!!editCard}
        onOpenChange={(open) => {
          if (!open) setEditCard(null);
        }}
        title="Editar cartão"
        description="Alterações valem para os ciclos atuais e futuros."
      >
        {editCard && (
          <CreditCardForm
            familyId={family.id}
            memberId={member.id}
            card={editCard}
            onSaved={() => setEditCard(null)}
            onCancel={() => setEditCard(null)}
          />
        )}
      </FormDialog>

      <AdjustBalanceDialog
        account={ajusteConta}
        familyId={family.id}
        onClose={() => setAjusteConta(null)}
      />

      <ConfirmDialog
        open={!!confirmacao}
        onOpenChange={(open) => {
          if (!open) setConfirmacao(null);
        }}
        title={confirmacao?.title ?? ""}
        description={confirmacao?.description ?? ""}
        {...(confirmacao?.confirmLabel ? { confirmLabel: confirmacao.confirmLabel } : {})}
        {...(confirmacao?.blocked ? { blocked: true } : {})}
        pending={executarAcao.isPending}
        onConfirm={() => executarAcao.mutate()}
      />
    </div>
  );
}
